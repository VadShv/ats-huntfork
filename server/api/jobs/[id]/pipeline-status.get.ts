import { eq, and } from 'drizzle-orm'
import { job, pipeline } from '../../../database/schema'
import { idParamSchema } from '../../../utils/schemas/job'
import { countActiveApplicationsForJob } from '../../../utils/pipeline-helpers'

/**
 * GET /api/jobs/:id/pipeline-status
 *
 * Lightweight endpoint used by the job settings UI to determine whether the
 * pipeline selector should be enabled or locked.
 *
 * Returns:
 *   pipelineId            — current pipeline assigned to the job (null if none)
 *   pipelineName          — human-readable pipeline name (null if no pipeline)
 *   activeApplicationsCount — number of applications that are in non-terminal stages
 *   canChangePipeline     — true iff activeApplicationsCount === 0
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, idParamSchema.parse)

  // Load the job with its pipeline info
  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, id), eq(job.organizationId, orgId)),
    columns: { id: true, pipelineId: true },
    with: {
      pipeline: {
        columns: { id: true, name: true },
      },
    },
  })

  if (!existingJob) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const activeApplicationsCount = await countActiveApplicationsForJob(db, id)

  return {
    pipelineId: existingJob.pipelineId ?? null,
    pipelineName: existingJob.pipeline?.name ?? null,
    activeApplicationsCount,
    canChangePipeline: activeApplicationsCount === 0,
  }
})
