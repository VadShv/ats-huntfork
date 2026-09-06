import { eq, and } from 'drizzle-orm'
import { jobInterviewQuestion } from '../../../../database/schema'
import { questionIdParamSchema } from '../../../../utils/schemas/interviewQuestion'

/**
 * DELETE /api/jobs/:id/interview-questions/:questionId
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: jobId, questionId } = await getValidatedRouterParams(event, questionIdParamSchema.parse)

  const deleted = await db.delete(jobInterviewQuestion)
    .where(and(
      eq(jobInterviewQuestion.id, questionId),
      eq(jobInterviewQuestion.jobId, jobId),
      eq(jobInterviewQuestion.organizationId, orgId),
    ))
    .returning({ id: jobInterviewQuestion.id })

  if (!deleted.length) {
    throw createError({ statusCode: 404, statusMessage: 'Вопрос не найден' })
  }

  return { success: true }
})
