import { and, eq } from 'drizzle-orm'
import { assessmentTopic, bankQuestion } from '../../../../database/schema'
import { bankQuestionIdParamSchema } from '../../../../utils/schemas/bankQuestion'
import { checkQuestionQuality, canPublish } from '../../../../utils/questions/qualityChecks'

/**
 * POST /api/question-bank/questions/:id/publish — публикация вопроса.
 * Валидация качества (блокирующие → 422). publish (owner/admin).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['publish'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, bankQuestionIdParamSchema.parse)

  const q = await db.query.bankQuestion.findFirst({
    where: and(eq(bankQuestion.id, id), eq(bankQuestion.organizationId, orgId)),
  })
  if (!q) throw createError({ statusCode: 404, statusMessage: 'Вопрос не найден' })
  if (q.status === 'published') return q // идемпотентно

  const topic = await db.query.assessmentTopic.findFirst({
    where: and(eq(assessmentTopic.id, q.primaryTopicId), eq(assessmentTopic.organizationId, orgId)),
    columns: { id: true, status: true },
  })

  const quality = checkQuestionQuality(q.text, {
    hasTopic: !!topic,
    hasGoal: !!(q.goal && q.goal.trim()),
    topicActive: topic?.status === 'active',
    expectedSignal: q.expectedSignal,
  })
  if (!canPublish(quality)) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Вопрос не прошёл проверку качества',
      data: { blocking: quality.blocking, warnings: quality.warnings },
    })
  }

  const [updated] = await db.update(bankQuestion)
    .set({
      status: 'published',
      publishedAt: new Date(),
      publishedById: session.user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(bankQuestion.id, id), eq(bankQuestion.organizationId, orgId)))
    .returning()
  return updated
})
