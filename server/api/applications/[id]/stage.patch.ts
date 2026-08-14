import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { application, pipelineStage, job, applicationStageHistory } from '../../../database/schema'
import { applicationIdParamSchema } from '../../../utils/schemas/application'

/**
 * PATCH /api/applications/:id/stage
 * Move application to a different pipeline stage.
 * Records history + syncs legacy status enum for back-compat.
 */

const moveStageBodySchema = z.object({
  stageId: z.string().min(1),
  comment: z.string().max(500).optional(),
})

type ApplicationStatus = 'new' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected'

/**
 * Map pipeline stage type → legacy application status enum value.
 * Спринт 11.5: расширено на все 16 типов этапов новой hh-воронки.
 */
function stageTypeToStatus(type: string): ApplicationStatus | null {
  switch (type) {
    case 'hired': return 'hired'
    case 'offer': return 'offer'
    case 'interview': return 'interview'
    case 'screening': return 'screening'
    case 'applied': return 'new'
    case 'new': return 'new'
    // Промежуточные рабочие этапы → legacy 'screening'
    case 'on_hold':
    case 'contact':
    case 'assessment':
      return 'screening'
    // Все виды отказов → legacy 'rejected'
    case 'rejected':
    case 'not_fit':
    case 'withdrawn':
    case 'no_show':
    case 'job_closed':
    case 'transferred':
      return 'rejected'
    // custom и неизвестные — legacy-статус не трогаем
    default:
      return null
  }
}

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  const body = await readValidatedBody(event, moveStageBodySchema.parse)

  // 1. Load application scoped to org
  const current = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true, currentStageId: true, status: true, jobId: true },
  })

  if (!current) {
    throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })
  }

  // 2. Load job to get pipelineId
  const jobRow = await db.query.job.findFirst({
    where: eq(job.id, current.jobId),
    columns: { id: true, pipelineId: true },
  })

  if (!jobRow?.pipelineId) {
    throw createError({ statusCode: 400, statusMessage: 'У вакансии не задана воронка' })
  }

  // 3. Load target stage — must belong to same pipeline + same org + not archived
  const targetStage = await db.query.pipelineStage.findFirst({
    where: and(
      eq(pipelineStage.id, body.stageId),
      eq(pipelineStage.pipelineId, jobRow.pipelineId),
      eq(pipelineStage.organizationId, orgId),
    ),
    columns: { id: true, name: true, color: true, type: true, isTerminal: true, isArchived: true },
  })

  if (!targetStage || targetStage.isArchived) {
    throw createError({ statusCode: 400, statusMessage: 'Этап не найден или архивирован' })
  }

  // 4. No-op if already on this stage (idempotent)
  if (current.currentStageId === body.stageId) {
    return {
      id: current.id,
      currentStageId: current.currentStageId,
      stageChangedAt: null as Date | null,
      currentStageName: targetStage.name,
      currentStageColor: targetStage.color,
    }
  }

  // Resolve fromStage name for activity log
  let fromStageName: string | null = null
  if (current.currentStageId) {
    const fromStage = await db.query.pipelineStage.findFirst({
      where: eq(pipelineStage.id, current.currentStageId),
      columns: { name: true },
    })
    fromStageName = fromStage?.name ?? null
  }

  // 5. Resolve new legacy status (null = keep untouched for custom stages)
  const newStatus = stageTypeToStatus(targetStage.type)
  const now = new Date()

  // Transaction: update application + insert stage history atomically
  const [updated] = await db.transaction(async (tx) => {
    let rows: Array<{ id: string; currentStageId: string | null; stageChangedAt: Date | null }>

    if (newStatus !== null) {
      rows = await tx
        .update(application)
        .set({ currentStageId: body.stageId, stageChangedAt: now, updatedAt: now, status: newStatus })
        .where(and(eq(application.id, id), eq(application.organizationId, orgId)))
        .returning({
          id: application.id,
          currentStageId: application.currentStageId,
          stageChangedAt: application.stageChangedAt,
        })
    }
    else {
      rows = await tx
        .update(application)
        .set({ currentStageId: body.stageId, stageChangedAt: now, updatedAt: now })
        .where(and(eq(application.id, id), eq(application.organizationId, orgId)))
        .returning({
          id: application.id,
          currentStageId: application.currentStageId,
          stageChangedAt: application.stageChangedAt,
        })
    }

    await tx.insert(applicationStageHistory).values({
      organizationId: orgId,
      applicationId: id,
      fromStageId: current.currentStageId ?? undefined,
      toStageId: body.stageId,
      movedByUserId: session.user.id,
      comment: body.comment,
    })

    return rows
  })

  // Activity log (fire-and-forget — must never break the primary operation)
  void recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'stage_changed',
    resourceType: 'application',
    resourceId: id,
    metadata: {
      from: fromStageName,
      to: targetStage.name,
      ...(body.comment ? { comment: body.comment } : {}),
    },
  })

  // hh.ru push-action (fire-and-forget, никогда не ломаем основную операцию)
  // Если для выбранной стадии есть hh_stage_mapping — перенесём negotiation в нужную коллекцию
  // (и опционально отправим шаблонное сообщение). Ошибки только логируются.
  void (async () => {
    try {
      const { pushStageChangeToHh } = await import('../../../utils/hh/sourcing/pushAction')
      await pushStageChangeToHh({
        organizationId: orgId,
        applicationId: id,
        pipelineStageId: body.stageId,
        userId: session.user.id,
      })
    } catch (err) {
      console.warn('[stage.patch] hh push-action failed', { applicationId: id, err: (err as Error).message })
    }
  })()

  // PostHog event (fire-and-forget)
  trackEvent(event, session, 'application stage_changed', {
    application_id: id,
    job_id: current.jobId,
    from_stage_id: current.currentStageId,
    to_stage_id: body.stageId,
    to_stage_name: targetStage.name,
  })

  return {
    id: updated.id,
    currentStageId: updated.currentStageId,
    stageChangedAt: updated.stageChangedAt,
    currentStageName: targetStage.name,
    currentStageColor: targetStage.color,
  }
})
