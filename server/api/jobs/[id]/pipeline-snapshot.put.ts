import { z } from 'zod'
import { eq, and, asc } from 'drizzle-orm'
import { job, pipelineStage } from '../../../database/schema'
import { idParamSchema } from '../../../utils/schemas/job'
import { validatePipelineStages, ALL_STAGE_TYPES } from '../../../utils/pipeline-validation'

/**
 * PUT /api/jobs/[id]/pipeline-snapshot
 *
 * Сохраняет per-vacancy кастомизацию воронки как snapshot в job.pipelineSnapshotJson.
 * Snapshot содержит полный список этапов с per-job значениями isHidden, displayOrder,
 * и добавленными пользователем кастомными этапами (isSystemStage=false).
 *
 * Первый раз snapshot создаётся автоматически на базе живой воронки.
 * Обновления идут через это же endpoint (PUT — идемпотентная замена).
 *
 * Ограничения:
 * - системные этапы (isSystemStage=true) в snapshot нельзя переименовать/сменить type
 *   (сравнивается с оригинальной воронкой при валидации)
 * - результирующий набор должен пройти validatePipelineStages
 */

const stageSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(50),
  description: z.string().max(500).nullable().optional(),
  type: z.enum(ALL_STAGE_TYPES),
  bucket: z.enum(['working', 'rejected']),
  color: z.string().min(1).max(20),
  displayOrder: z.number().int().min(0),
  isTerminal: z.boolean(),
  isSystemStage: z.boolean(),
  isHidden: z.boolean(),
  parentStageId: z.string().uuid().nullable(),
})

const bodySchema = z.object({
  stages: z.array(stageSchema).min(2).max(100),
})

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)
  const body = await readValidatedBody(event, bodySchema.parse)

  // Verify job
  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: { id: true, pipelineId: true },
  })

  if (!existingJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  if (!existingJob.pipelineId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'У вакансии нет назначенной воронки. Сначала назначьте воронку',
    })
  }

  // ── Валидация: системные этапы в snapshot должны совпадать с оригиналом ──
  const originalStages = await db
    .select({
      id: pipelineStage.id,
      name: pipelineStage.name,
      type: pipelineStage.type,
      bucket: pipelineStage.bucket,
      isSystemStage: pipelineStage.isSystemStage,
    })
    .from(pipelineStage)
    .where(and(
      eq(pipelineStage.pipelineId, existingJob.pipelineId),
      eq(pipelineStage.organizationId, orgId),
    ))

  const originalById = new Map(originalStages.map((s) => [s.id, s]))

  for (const s of body.stages) {
    if (!s.isSystemStage) continue

    const orig = originalById.get(s.id)
    if (!orig) {
      throw createError({
        statusCode: 400,
        statusMessage: `Базовый этап id=${s.id} не найден в исходной воронке`,
      })
    }
    if (orig.name !== s.name) {
      throw createError({
        statusCode: 400,
        statusMessage: `Базовый этап «${orig.name}» нельзя переименовать`,
      })
    }
    if (orig.type !== s.type) {
      throw createError({
        statusCode: 400,
        statusMessage: `Базовый этап «${orig.name}» — тип менять нельзя`,
      })
    }
    if (orig.bucket !== s.bucket) {
      throw createError({
        statusCode: 400,
        statusMessage: `Базовый этап «${orig.name}» — раздел менять нельзя`,
      })
    }
  }

  // Общая валидация набора (bucket, hierarchy, unique names)
  validatePipelineStages(body.stages as never)

  // ── Сохраняем snapshot ────────────────────────────────────────
  await db.update(job)
    .set({
      pipelineSnapshotJson: {
        pipelineId: existingJob.pipelineId,
        stages: body.stages.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description ?? null,
          type: s.type,
          bucket: s.bucket,
          color: s.color,
          displayOrder: s.displayOrder,
          isTerminal: s.isTerminal,
          isSystemStage: s.isSystemStage,
          isHidden: s.isHidden,
          parentStageId: s.parentStageId,
        })),
        savedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(and(eq(job.id, id), eq(job.organizationId, orgId)))

  return { ok: true, source: 'snapshot' as const, stagesCount: body.stages.length }
})
