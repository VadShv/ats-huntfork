import { eq, and, asc, desc } from 'drizzle-orm'
import { pipeline, pipelineStage } from '../../database/schema'

/**
 * GET /api/pipelines/stages-summary
 *
 * Returns all non-archived pipelines (system + custom) and their
 * non-archived stages — grouped by pipeline. Intended for populating
 * stage filter dropdowns in the global applications list.
 *
 * requirePermission: { pipeline: ['read'] }
 *
 * Returns: Array<{
 *   pipelineId: string,
 *   pipelineName: string,
 *   stages: Array<{ id, name, color, type, displayOrder }>
 * }>
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { pipeline: ['read'] })
  const orgId = session.session.activeOrganizationId

  // Fetch non-archived pipelines for this org
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

  // Fetch non-archived stages for those pipelines
  const stages = await db
    .select({
      id: pipelineStage.id,
      pipelineId: pipelineStage.pipelineId,
      name: pipelineStage.name,
      color: pipelineStage.color,
      type: pipelineStage.type,
      displayOrder: pipelineStage.displayOrder,
    })
    .from(pipelineStage)
    .where(
      and(
        eq(pipelineStage.organizationId, orgId),
        eq(pipelineStage.isArchived, false),
      ),
    )
    .orderBy(asc(pipelineStage.displayOrder))

  // Group stages by pipeline
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
        displayOrder: s.displayOrder,
      })),
    }))
})
