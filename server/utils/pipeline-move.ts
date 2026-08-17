/**
 * Атомарный перенос заявки между этапами воронки.
 *
 * Выделен из server/api/applications/[id]/stage.patch.ts,
 * чтобы одинаково использовать в:
 *   - PATCH /api/applications/:id/stage  — обычный ход рекрутёра.
 *   - POST /api/hm/decisions             — решение НМ (в системном контексте).
 *   - DELETE /api/hm/decisions/:id/cancel — откат решения НМ.
 *
 * Ответственность:
 *   - Идемпотентно двигает application.currentStageId и legacy status.
 *   - Пишет applicationStageHistory.
 *   - Пишет recordActivity.
 *   - Никаких external side-effects (hh.ru push, PostHog) — их вызывающий делает сам.
 */

import { and, eq } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import { application, applicationStageHistory, job, pipelineStage } from '../database/schema/app'

type ApplicationStatus = 'new' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected'

/**
 * Маппинг pipeline_stage.type → legacy application_status для back-compat.
 * Держим одну копию, чтобы `stage.patch.ts` и HM оставались синхронны.
 */
export function stageTypeToLegacyStatus(type: string): ApplicationStatus | null {
  switch (type) {
    case 'hired': return 'hired'
    case 'offer': return 'offer'
    case 'interview': return 'interview'
    case 'screening': return 'screening'
    case 'applied':
    case 'new':
      return 'new'
    case 'on_hold':
    case 'contact':
    case 'assessment':
      return 'screening'
    case 'rejected':
    case 'not_fit':
    case 'withdrawn':
    case 'no_show':
    case 'job_closed':
    case 'transferred':
      return 'rejected'
    default:
      return null
  }
}

export interface MoveStageOptions {
  organizationId: string
  applicationId: string
  toStageId: string
  /**
   * Кто выполняет действие. null — системный контекст (НМ через /api/hm/*,
   * автоматические переносы, миграции). В журнале отображается как «Система».
   */
  actorUserId: string | null
  comment?: string
  /** Опциональный «предмет действия» для metadata активности. */
  activityMetadataExtras?: Record<string, unknown>
  /** Тип активности; по умолчанию 'stage_changed'. */
  activityAction?: 'stage_changed' | 'hm_approved' | 'hm_rejected' | 'hm_cancelled'
}

export interface MoveStageResult {
  applicationId: string
  fromStageId: string | null
  fromStageName: string | null
  toStageId: string
  toStageName: string
  toStageColor: string | null
  toStageType: string
  stageChangedAt: Date | null
  noop: boolean
}

/**
 * Выполнить переход. Все проверки принадлежности org внутри.
 * Бросает createError() 4xx на бизнес-ошибки.
 */
export async function moveApplicationStage(opts: MoveStageOptions): Promise<MoveStageResult> {
  const { organizationId, applicationId, toStageId, actorUserId } = opts

  // 1. Заявка есть и принадлежит org
  const current = await db.query.application.findFirst({
    where: and(
      eq(application.id, applicationId),
      eq(application.organizationId, organizationId),
    ),
    columns: { id: true, currentStageId: true, jobId: true },
  })
  if (!current) {
    throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  }

  // 2. Job → pipelineId
  const jobRow = await db.query.job.findFirst({
    where: eq(job.id, current.jobId),
    columns: { id: true, pipelineId: true },
  })
  if (!jobRow?.pipelineId) {
    throw createError({ statusCode: 400, statusMessage: 'У вакансии не задана воронка' })
  }

  // 3. Целевой этап принадлежит той же воронке и org, не архивирован
  const targetStage = await db.query.pipelineStage.findFirst({
    where: and(
      eq(pipelineStage.id, toStageId),
      eq(pipelineStage.pipelineId, jobRow.pipelineId),
      eq(pipelineStage.organizationId, organizationId),
    ),
    columns: {
      id: true,
      name: true,
      color: true,
      type: true,
      isTerminal: true,
      isArchived: true,
    },
  })
  if (!targetStage || targetStage.isArchived) {
    throw createError({ statusCode: 400, statusMessage: 'Этап не найден или архивирован' })
  }

  // 4. Резолвим fromStageName для истории/аудита
  let fromStageName: string | null = null
  if (current.currentStageId) {
    const fromStage = await db.query.pipelineStage.findFirst({
      where: eq(pipelineStage.id, current.currentStageId),
      columns: { name: true },
    })
    fromStageName = fromStage?.name ?? null
  }

  // 5. No-op: уже на нужном этапе
  if (current.currentStageId === toStageId) {
    return {
      applicationId: current.id,
      fromStageId: current.currentStageId,
      fromStageName,
      toStageId,
      toStageName: targetStage.name,
      toStageColor: targetStage.color,
      toStageType: targetStage.type,
      stageChangedAt: null,
      noop: true,
    }
  }

  // 6. Транзакция: update + history
  const newStatus = stageTypeToLegacyStatus(targetStage.type)
  const now = new Date()

  const [updated] = await db.transaction(async (tx) => {
    let rows: Array<{ id: string; currentStageId: string | null; stageChangedAt: Date | null }>

    if (newStatus !== null) {
      rows = await tx
        .update(application)
        .set({
          currentStageId: toStageId,
          stageChangedAt: now,
          updatedAt: now,
          status: newStatus,
        })
        .where(and(eq(application.id, applicationId), eq(application.organizationId, organizationId)))
        .returning({
          id: application.id,
          currentStageId: application.currentStageId,
          stageChangedAt: application.stageChangedAt,
        })
    }
    else {
      rows = await tx
        .update(application)
        .set({
          currentStageId: toStageId,
          stageChangedAt: now,
          updatedAt: now,
        })
        .where(and(eq(application.id, applicationId), eq(application.organizationId, organizationId)))
        .returning({
          id: application.id,
          currentStageId: application.currentStageId,
          stageChangedAt: application.stageChangedAt,
        })
    }

    await tx.insert(applicationStageHistory).values({
      organizationId,
      applicationId,
      fromStageId: current.currentStageId ?? undefined,
      toStageId,
      movedByUserId: actorUserId ?? undefined,
      comment: opts.comment,
    })

    return rows
  })

  // 7. Activity — fire-and-forget через recordActivity (никогда не роняет операцию)
  void recordActivity({
    organizationId,
    actorId: actorUserId,
    action: opts.activityAction ?? 'stage_changed',
    resourceType: 'application',
    resourceId: applicationId,
    metadata: {
      from: fromStageName,
      to: targetStage.name,
      ...(opts.comment ? { comment: opts.comment } : {}),
      ...(opts.activityMetadataExtras ?? {}),
    },
  })

  return {
    applicationId: updated.id,
    fromStageId: current.currentStageId,
    fromStageName,
    toStageId,
    toStageName: targetStage.name,
    toStageColor: targetStage.color,
    toStageType: targetStage.type,
    stageChangedAt: updated.stageChangedAt,
    noop: false,
  }
}
