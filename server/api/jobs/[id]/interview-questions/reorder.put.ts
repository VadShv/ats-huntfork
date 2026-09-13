import { eq, and } from 'drizzle-orm'
import { requireJobInScope } from '../../../../utils/access/scope'
import { job, jobInterviewQuestion } from '../../../../database/schema'
import { jobIdParamSchema, reorderInterviewQuestionsSchema } from '../../../../utils/schemas/interviewQuestion'

/**
 * PUT /api/jobs/:id/interview-questions/reorder
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: jobId } = await getValidatedRouterParams(event, jobIdParamSchema.parse)
  await requireJobInScope(event, jobId as string)
  const body = await readValidatedBody(event, reorderInterviewQuestionsSchema.parse)

  const existingJob = await db.query.job.findFirst({
    where: and(eq(job.id, jobId), eq(job.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existingJob) {
    throw createError({ statusCode: 404, statusMessage: 'Вакансия не найдена' })
  }

  await db.transaction(async (tx) => {
    for (const { id, displayOrder } of body.order) {
      await tx.update(jobInterviewQuestion)
        .set({ displayOrder, updatedAt: new Date() })
        .where(and(
          eq(jobInterviewQuestion.id, id),
          eq(jobInterviewQuestion.jobId, jobId),
          eq(jobInterviewQuestion.organizationId, orgId),
        ))
    }
  })

  return { success: true }
})
