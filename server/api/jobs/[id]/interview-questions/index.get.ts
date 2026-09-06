import { eq, and, asc } from 'drizzle-orm'
import { job, jobInterviewQuestion } from '../../../../database/schema'
import { jobIdParamSchema } from '../../../../utils/schemas/interviewQuestion'

/**
 * GET /api/jobs/:id/interview-questions
 * Lists the interview-question bank for a job, ordered by displayOrder.
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

  return db.query.jobInterviewQuestion.findMany({
    where: and(eq(jobInterviewQuestion.jobId, jobId), eq(jobInterviewQuestion.organizationId, orgId)),
    orderBy: [asc(jobInterviewQuestion.displayOrder), asc(jobInterviewQuestion.createdAt)],
  })
})
