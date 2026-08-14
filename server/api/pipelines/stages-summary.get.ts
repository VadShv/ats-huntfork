import { eq, and, asc, desc } from 'drizzle-orm'
import { pipeline, pipelineStage } from '../../database/schema'

/**
 * GET /api/pipelines/stages-summary
 *
 * Возвращает все не-архивные воронки (системные + пользовательские) и их
 * не-архивные + не-скрытые этапы, сгруппированные по воронкам. Используется
 * для дропдаунов фильтров в глобальном списке заявок.
 *
 * Скрытые этапы (isHidden=true) не возвращаются — они убраны из воронки
 * пользователем и не должны быть выбираемы.
 *
 * requirePermission: { pipeline: ['read'] }
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { pipeline: ['read'] })
  const orgId = session.session.activeOrganizationId

  const pipelines = await db
    .select({
      id: pipeline.id,
      name: pipeline.name,
      isDefault: pipeline.isDefault,
      isSystem: pipeline.isSystem,
    })
    .from(pipeline)
    .where(and(eq(pipeline.organizationId, orgId), eq(pipeline.isArchived, false)))
    .orderBy(desc(pipeline.isDefault), desc(pipeline.isSystem), asc(pipeline.name))

  if (pipelines.length === 0) {
    return []
  }

  const pipelineIds = pipelines.map((p) => p.id)

  const stages = await db
    .select({
      id: pipelineStage.id,
      pipelineId: pipelineStage.pipelineId,
      name: pipelineStage.name,
      color: pipelineStage.color,
      type: pipelineStage.type,
      bucket: pipelineStage.bucket,
      parentStageId: pipelineStage.parentStageId,
      isSystemStage: pipelineStage.isSystemStage,
      displayOrder: pipelineStage.displayOrder,
    })
    .from(pipelineStage)
    .where(
      and(
        eq(pipelineStage.organizationId, orgId),
        eq(pipelineStage.isArchived, false),
        eq(pipelineStage.isHidden, false),
      ),
    )
    .orderBy(asc(pipelineStage.displayOrder))

  const stagesByPipeline = new Map<string, typeof stages>()
  for (const stage of stages) {
    if (!pipelineIds.includes(stage.pipelineId)) continue
    const existing = stagesByPipeline.get(stage.pipelineId) ?? []
    existing.push(stage)
    stagesByPipeline.set(stage.pipelineId, existing)
  }

  return pipelines
    .filter((p) => (stagesByPipeline.get(p.id)?.length ?? 0) > 0)
    .map((p) => ({
      pipelineId: p.id,
      pipelineName: p.name,
      stages: (stagesByPipeline.get(p.id) ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        type: s.type,
        bucket: s.bucket,
        parentStageId: s.parentStageId,
        isSystemStage: s.isSystemStage,
        displayOrder: s.displayOrder,
      })),
    }))
})
