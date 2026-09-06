import { eq, and } from 'drizzle-orm'
import { job, jobQuestionPrompt } from '../../../../database/schema'
import { jobIdParamSchema } from '../../../../utils/schemas/interviewQuestion'

/**
 * GET /api/jobs/:id/interview-questions/prompt
 * Returns the saved generation prompt (or null).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id: jobId } = await getValidatedRouterParams(event, jobIdParamSchema.parse)

  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existingJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  const row = await db.query.jobQuestionPrompt.findFirst({
    where: and(eq(jobQuestionPrompt.jobId, jobId), eq(jobQuestionPrompt.organizationId, orgId)),
  })
  return row ?? null
})
