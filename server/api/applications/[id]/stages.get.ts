import { eq, and, asc } from 'drizzle-orm'
import { application, pipelineStage, job } from '../../../database/schema'
import { applicationIdParamSchema } from '../../../utils/schemas/application'

/**
 * GET /api/applications/:id/stages
 * Returns ALL stages of the application's job's pipeline, ordered by displayOrder.
 * Includes archived stages (flagged). Sets isCurrent=true for the application's current stage.
 * Returns [] if the job has no pipeline.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)

  // Load application to get jobId and currentStageId
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true, jobId: true, currentStageId: true },
  })

  if (!app) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  // Load job to get pipelineId
  const jobRow = await db.query.job.findFirst({
    where: eq(job.id, app.jobId),
    columns: { id: true, pipelineId: true },
  })

  if (!jobRow?.pipelineId) {
    return []
  }

  // Load all stages of the pipeline, ordered by displayOrder
  const stages = await db
    .select({
      id: pipelineStage.id,
      name: pipelineStage.name,
      color: pipelineStage.color,
      type: pipelineStage.type,
      displayOrder: pipelineStage.displayOrder,
      isTerminal: pipelineStage.isTerminal,
      isArchived: pipelineStage.isArchived,
    })
    .from(pipelineStage)
    .where(
      and(
        eq(pipelineStage.pipelineId, jobRow.pipelineId),
        eq(pipelineStage.organizationId, orgId),
      ),
    )
    .orderBy(asc(pipelineStage.displayOrder))

  return stages.map((stage) => ({
    ...stage,
    isCurrent: stage.id === app.currentStageId,
  }))
})
