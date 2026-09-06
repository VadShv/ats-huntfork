import { eq, and } from 'drizzle-orm'
import { job, jobBrief } from '../../../../database/schema'
import { jobIdParamSchema } from '../../../../utils/schemas/jobBrief'

/**
 * GET /api/jobs/:id/brief
 *
 * Returns the job brief (internal, never published). `null` when not yet filled.
 * Org-scoped; readable by anyone with job:read (incl. hiring managers, read-only).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id: jobId } = await getValidatedRouterParams(event, jobIdParamSchema.parse)

  // Verify the job belongs to the org
  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existingJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const brief = await db.query.jobBrief.findFirst({
    where: and(eq(jobBrief.jobId, jobId), eq(jobBrief.organizationId, orgId)),
  })

  return brief ?? null
})
