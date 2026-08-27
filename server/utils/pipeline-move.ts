/**
 * Атомарный перенос заявки между этапами воронки.
 *
 * Спринт 22: ЕДИНСТВЕННАЯ реализация перемещения. Все пути обязаны идти через неё:
 *   - PATCH /api/applications/:id/stage  — обычный ход рекрутера (в т.ч. bulk с фронта).
 *   - POST /api/hm/decisions             — решение НМ (системный контекст).
 *   - server/utils/ai/autoReject.ts      — авто-отказ по скору.
 *   - POST /api/applications/:id/transfer — перевод на другую вакансию.
 *
 * Ответственность (всё внутри, вызывающему ничего доделывать не нужно):
 *   - Guard-правила переходов (G1: возврат из терминала — только с комментарием;
 *     G3: на отказной этап с активными подэтапами нельзя — только на подэтап-причину).
 *   - Идемпотентно двигает application.currentStageId.
 *   - Проецирует legacy status из типа этапа (custom-подэтап → тип корневого родителя).
 *   - Пишет applicationStageHistory.
 *   - Пишет recordActivity.
 *   - Fire-and-forget push на hh.ru (pushStageChangeToHh) — если не skipHhPush.
 *   - Fire-and-forget PostHog `application stage_changed` c полем `via`.
 */

import { and, eq } from 'drizzle-orm'
import { application, applicationStageHistory, job, pipelineStage } from '../database/schema/app'
import { useServerPostHog } from './posthog'

type ApplicationStatus = 'new' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected'

/**
 * Маппинг pipeline_stage.type → legacy application_status для back-compat.
 * Единственная копия в кодовой базе (Спринт 22).
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

/** Источник перемещения — для PostHog-аналитики и отладки. */
export type MoveVia = 'manual' | 'bulk' | 'hm_decision' | 'hm_cancel' | 'auto_reject' | 'auto_advance' | 'transfer' | 'system'

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
  /** Источник перемещения (PostHog `via`); по умолчанию 'system'. */
  via?: MoveVia
  /**
   * Не пушить смену этапа на hh.ru. Используется при массовых операциях
   * (батчинг снаружи) и при возврате из отказа (hh не всегда позволяет
   * выход из discard — ре-синк только по явной кнопке).
   */
  skipHhPush?: boolean
}

export interface MoveStageResult {
  applicationId: string
  fromStageId: string | null
  fromStageName: string | null
  toStageId: string
  toStageName: string
  toStageColor: string | null
  toStageType: string
  /** Родительский этап целевого (если целевой — подэтап). Для тостов «Отказ → Не подходит». */
  toParentStageId: string | null
  toParentStageName: string | null
  stageChangedAt: Date | null
  noop: boolean
}

/**
 * Выполнить переход. Все проверки принадлежности org внутри.
 * Бросает createError() 4xx на бизнес-ошибки:
 *   - 422 { code: 'RETURN_TO_WORK_REQUIRES_COMMENT' } — G1.
 *   - 422 { code: 'CHOOSE_SUBSTAGE', substages: [...] } — G3.
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
      bucket: true,
      isTerminal: true,
      isArchived: true,
      parentStageId: true,
    },
  })
  if (!targetStage || targetStage.isArchived) {
    throw createError({ statusCode: 400, statusMessage: 'Этап не найден или архивирован' })
  }

  // 3a. Родитель целевого этапа (для проекции статуса custom-подэтапов и тостов)
  let targetParent: { id: string; name: string; type: string } | null = null
  if (targetStage.parentStageId) {
    const parentRow = await db.query.pipelineStage.findFirst({
      where: and(
        eq(pipelineStage.id, targetStage.parentStageId),
        eq(pipelineStage.organizationId, organizationId),
      ),
      columns: { id: true, name: true, type: true },
    })
    targetParent = parentRow ?? null
  }

  // 4. Исходный этап — имя для истории + терминальность для guard G1
  let fromStageName: string | null = null
  let fromStageIsTerminal = false
  if (current.currentStageId) {
    const fromStage = await db.query.pipelineStage.findFirst({
      where: eq(pipelineStage.id, current.currentStageId),
      columns: { name: true, isTerminal: true },
    })
    fromStageName = fromStage?.name ?? null
    fromStageIsTerminal = fromStage?.isTerminal ?? false
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
      toParentStageId: targetParent?.id ?? null,
      toParentStageName: targetParent?.name ?? null,
      stageChangedAt: null,
      noop: true,
    }
  }

  // ── Guard G3: на отказной этап с активными подэтапами нельзя —
  //    нужно выбрать конкретную причину (подэтап).
  if (targetStage.bucket === 'rejected' && !targetStage.parentStageId) {
    const children = await db.query.pipelineStage.findMany({
      where: and(
        eq(pipelineStage.parentStageId, targetStage.id),
        eq(pipelineStage.organizationId, organizationId),
        eq(pipelineStage.isArchived, false),
        eq(pipelineStage.isHidden, false),
      ),
      columns: { id: true, name: true, color: true, type: true },
      orderBy: (s, { asc }) => [asc(s.displayOrder)],
    })
    if (children.length > 0) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Выберите причину отказа',
        data: {
          code: 'CHOOSE_SUBSTAGE',
          substages: children.map(c => ({ id: c.id, name: c.name, color: c.color, type: c.type })),
        },
      })
    }
  }

  // ── Guard G1: возврат из терминального этапа в работу — только с комментарием.
  if (fromStageIsTerminal && !targetStage.isTerminal && !opts.comment?.trim()) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Возврат кандидата в работу требует комментария',
      data: { code: 'RETURN_TO_WORK_REQUIRES_COMMENT' },
    })
  }

  // 6. Транзакция: update + history.
  //    Проекция legacy-статуса: custom-подэтап наследует тип корневого родителя.
  const effectiveType = targetStage.type === 'custom' && targetParent
    ? targetParent.type
    : targetStage.type
  const newStatus = stageTypeToLegacyStatus(effectiveType)
  if (newStatus === null && targetStage.type === 'custom') {
    // custom-этап без родителя — статус «замирает». Не должно встречаться
    // в системной воронке; логируем для наблюдаемости (инвариант-чек D4).
    console.warn('[pipeline-move] custom stage without parent — legacy status not projected', {
      applicationId,
      toStageId,
    })
  }
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

  if (!updated) {
    // Гонка: заявка удалена между проверкой и транзакцией
    throw createError({ statusCode: 404, statusMessage: 'Заявка не найдена' })
  }

  // 7. Activity — fire-and-forget через recordActivity (никогда не роняет операцию)
  void recordActivity({
    organizationId,
    actorId: actorUserId,
    action: opts.activityAction ?? 'stage_changed',
    resourceType: 'application',
    resourceId: applicationId,
    metadata: {
      from: fromStageName,
      to: targetParent ? `${targetParent.name} / ${targetStage.name}` : targetStage.name,
      ...(opts.comment ? { comment: opts.comment } : {}),
      ...(opts.activityMetadataExtras ?? {}),
    },
  })

  // 8. hh.ru push — fire-and-forget из ВСЕХ путей (Спринт 22, фикс A2).
  //    Раньше пушил только stage.patch — отказы НМ и авто-отказы «зависали» на hh.
  if (!opts.skipHhPush) {
    void (async () => {
      try {
        const { pushStageChangeToHh } = await import('./hh/sourcing/pushAction')
        await pushStageChangeToHh({
          organizationId,
          applicationId,
          pipelineStageId: toStageId,
          userId: actorUserId,
        })
      }
      catch (err) {
        console.warn('[pipeline-move] hh push-action failed', {
          applicationId,
          via: opts.via ?? 'system',
          err: (err as Error).message,
        })
      }
    })()
  }

  // 9. PostHog — fire-and-forget, работает и вне HTTP-контекста (авто-отказ).
  try {
    const ph = useServerPostHog()
    ph?.capture({
      distinctId: actorUserId ?? 'system',
      event: 'application stage_changed',
      groups: { organization: organizationId },
      properties: {
        application_id: applicationId,
        job_id: current.jobId,
        from_stage_id: current.currentStageId,
        to_stage_id: toStageId,
        to_stage_name: targetStage.name,
        via: opts.via ?? 'system',
      },
    })
  }
  catch { /* tracking never breaks the operation */ }

  return {
    applicationId: updated.id,
    fromStageId: current.currentStageId,
    fromStageName,
    toStageId,
    toStageName: targetStage.name,
    toStageColor: targetStage.color,
    toStageType: targetStage.type,
    toParentStageId: targetParent?.id ?? null,
    toParentStageName: targetParent?.name ?? null,
    stageChangedAt: updated.stageChangedAt,
    noop: false,
  }
}
