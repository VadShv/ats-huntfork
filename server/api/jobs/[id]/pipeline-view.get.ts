import { eq, and, asc } from 'drizzle-orm'
import { job, pipeline, pipelineStage } from '../../../database/schema'
import { idParamSchema } from '../../../utils/schemas/job'

/**
 * GET /api/jobs/[id]/pipeline-view
 *
 * Возвращает эффективную воронку для вакансии.
 *
 * Логика выбора источника:
 *   1. Если у job есть pipelineSnapshotJson (per-job кастомизация) — используем его
 *   2. Иначе — читаем живые данные из pipeline+pipelineStage
 *
 * Snapshot всегда содержит полный список этапов включая скрытые (для отображения
 * настроек), но с флагом isHidden. Ответ включает флаг `source` = 'snapshot' | 'live'
 * чтобы UI знал, был ли какой-то тюнинг.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: {
      id: true,
      pipelineId: true,
      pipelineSnapshotJson: true,
    },
    with: {
      pipeline: {
        columns: {
          id: true,
          name: true,
          description: true,
          isSystem: true,
          isDefault: true,
        },
      },
    },
  })

  if (!existingJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  if (!existingJob.pipelineId || !existingJob.pipeline) {
    return {
      source: 'none' as const,
      pipeline: null,
      stages: [],
    }
  }

  // ── Snapshot path ────────────────────────────────────────────────
  if (existingJob.pipelineSnapshotJson) {
    const snap = existingJob.pipelineSnapshotJson as {
      pipelineId: string
      stages: Array<{
        id: string
        name: string
        description: string | null
        type: string
        bucket: 'working' | 'rejected'
        color: string
        displayOrder: number
        isTerminal: boolean
        isSystemStage: boolean
        isHidden: boolean
        parentStageId: string | null
      }>
    }

    return {
      source: 'snapshot' as const,
      pipeline: existingJob.pipeline,
      stages: snap.stages
        .sort((a, b) => a.displayOrder - b.displayOrder),
    }
  }

  // ── Live path ────────────────────────────────────────────────────
  const stages = await db
    .select({
      id: pipelineStage.id,
      name: pipelineStage.name,
      description: pipelineStage.description,
      type: pipelineStage.type,
      bucket: pipelineStage.bucket,
      color: pipelineStage.color,
      displayOrder: pipelineStage.displayOrder,
      isTerminal: pipelineStage.isTerminal,
      isSystemStage: pipelineStage.isSystemStage,
      isHidden: pipelineStage.isHidden,
      parentStageId: pipelineStage.parentStageId,
      // ТЗ hm-review-substage: для бейджа «На рассмотрении» в канбане
      presetKey: pipelineStage.presetKey,
    })
    .from(pipelineStage)
    .where(and(
      eq(pipelineStage.pipelineId, existingJob.pipelineId),
      eq(pipelineStage.organizationId, orgId),
      eq(pipelineStage.isArchived, false),
    ))
    .orderBy(asc(pipelineStage.displayOrder))

  return {
    source: 'live' as const,
    pipeline: existingJob.pipeline,
    stages,
  }
})
