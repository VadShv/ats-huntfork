import { z } from 'zod'
import { eq, and, count, inArray } from 'drizzle-orm'
import { pipeline, pipelineStage, application } from '../../../../database/schema'
import { validatePipelineStages } from '../../../../utils/pipeline-validation'

const paramsSchema = z.object({
  id: z.string().min(1),
  stageId: z.string().min(1),
})

/**
 * DELETE /api/pipelines/[id]/stages/[stageId]
 *
 * Мягкое удаление (isArchived=true) — только для пользовательских этапов.
 * Системные этапы (isSystemStage=true) удалить НЕЛЬЗЯ — их можно только скрыть
 * через PATCH { isHidden: true }.
 *
 * Если у этапа есть подстатусы — они архивируются каскадно.
 * Если на этом этапе есть активные заявки — 409 Conflict с count.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { pipeline: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: pipelineId, stageId } = await getValidatedRouterParams(event, paramsSchema.parse)

  // Verify pipeline
  const parentPipeline = await db.query.pipeline.findFirst({
    where: and(eq(pipeline.id, pipelineId), eq(pipeline.organizationId, orgId)),
    columns: { id: true },
  })
  if (!parentPipeline) {
    throw createError({ statusCode: 404, statusMessage: 'Воронка не найдена' })
  }

  // Verify stage
  const existingStage = await db.query.pipelineStage.findFirst({
    where: and(
      eq(pipelineStage.id, stageId),
      eq(pipelineStage.pipelineId, pipelineId),
      eq(pipelineStage.organizationId, orgId),
    ),
  })

  if (!existingStage) {
    throw createError({ statusCode: 404, statusMessage: 'Этап не найден' })
  }

  // ── Системные этапы удалять нельзя ────────────────────────────
  if (existingStage.isSystemStage) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Базовый этап нельзя удалить. Используйте «Скрыть» для того чтобы убрать его из воронки',
    })
  }

  // ── Проверка активных заявок ──────────────────────────────────
  // Собираем сам этап и его подстатусы
  const relatedStages = await db.query.pipelineStage.findMany({
    where: and(
      eq(pipelineStage.pipelineId, pipelineId),
      eq(pipelineStage.organizationId, orgId),
    ),
    columns: { id: true, parentStageId: true },
  })

  const affectedStageIds = [
    stageId,
    ...relatedStages.filter((s) => s.parentStageId === stageId).map((s) => s.id),
  ]

  const [appCountRow] = await db
    .select({ count: count() })
    .from(application)
    .where(and(
      eq(application.organizationId, orgId),
      inArray(application.currentStageId, affectedStageIds),
    ))

  const appsCount = appCountRow?.count ?? 0
  if (appsCount > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `На этом этапе ${appsCount} активных заявок. Сначала переместите их на другой этап`,
    })
  }

  // ── Валидация: после удаления воронка должна остаться корректной ──
  const allStages = await db.query.pipelineStage.findMany({
    where: and(
      eq(pipelineStage.pipelineId, pipelineId),
      eq(pipelineStage.organizationId, orgId),
    ),
  })
  const afterDelete = allStages.map((s) =>
    affectedStageIds.includes(s.id) ? { ...s, isArchived: true } : s,
  )
  validatePipelineStages(afterDelete as never)

  // ── Каскадное архивирование этапа и его подстатусов ──────────
  await db.update(pipelineStage)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(and(
      inArray(pipelineStage.id, affectedStageIds),
      eq(pipelineStage.organizationId, orgId),
    ))

  setResponseStatus(event, 204)
  return null
})
