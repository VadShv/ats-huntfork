import { and, eq } from 'drizzle-orm'
import { requireJobInScope } from '../../../../../utils/access/scope'
import { jobInterviewQuestion, scoringCriterion } from '../../../../../database/schema'
import { linkCriterionSchema } from '../../../../../utils/schemas/preset'
import { z } from 'zod'

const paramSchema = z.object({ id: z.string().min(1), questionId: z.string().min(1) })

/**
 * PUT /api/jobs/:id/interview-questions/:questionId/link-criterion
 * Привязать/отвязать вопрос вакансии к критерию скоринга (матрица покрытия).
 * Критерий должен принадлежать этой вакансии. job:['update'].
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { job: ['update'] })
  const orgId = session.session.activeOrganizationId
  const { id: jobId, questionId } = await getValidatedRouterParams(event, paramSchema.parse)
  await requireJobInScope(event, jobId)
  const body = await readValidatedBody(event, linkCriterionSchema.parse)

  const q = await db.query.jobInterviewQuestion.findFirst({
    where: and(eq(jobInterviewQuestion.id, questionId), eq(jobInterviewQuestion.jobId, jobId), eq(jobInterviewQuestion.organizationId, orgId)),
    columns: { id: true },
  })
  if (!q) throw createError({ statusCode: 404, statusMessage: 'Вопрос не найден' })

  if (body.criterionId) {
    const crit = await db.query.scoringCriterion.findFirst({
      where: and(eq(scoringCriterion.id, body.criterionId), eq(scoringCriterion.jobId, jobId)),
      columns: { id: true },
    })
    if (!crit) throw createError({ statusCode: 422, statusMessage: 'Критерий не принадлежит вакансии' })
  }

  const [updated] = await db.update(jobInterviewQuestion)
    .set({ criterionId: body.criterionId, updatedAt: new Date() })
    .where(and(eq(jobInterviewQuestion.id, questionId), eq(jobInterviewQuestion.organizationId, orgId)))
    .returning()
  return updated
})
