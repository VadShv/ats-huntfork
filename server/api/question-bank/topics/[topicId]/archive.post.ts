import { and, eq } from 'drizzle-orm'
import { assessmentTopic, bankQuestion } from '../../../../database/schema'
import { topicIdParamSchema } from '../../../../utils/schemas/bankQuestion'

/**
 * POST /api/question-bank/topics/:topicId/archive — архивация темы (soft).
 * Блокирует, если есть опубликованные вопросы по теме (422). manage_topics.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['manage_topics'] })
  const orgId = session.session.activeOrganizationId
  const { topicId } = await getValidatedRouterParams(event, topicIdParamSchema.parse)

  const existing = await db.query.assessmentTopic.findFirst({
    where: and(eq(assessmentTopic.id, topicId), eq(assessmentTopic.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Тема не найдена' })

  const published = await db.query.bankQuestion.findFirst({
    where: and(
      eq(bankQuestion.primaryTopicId, topicId),
      eq(bankQuestion.organizationId, orgId),
      eq(bankQuestion.status, 'published'),
    ),
    columns: { id: true },
  })
  if (published) {
    throw createError({ statusCode: 422, statusMessage: 'Нельзя архивировать тему с опубликованными вопросами' })
  }

  const [updated] = await db.update(assessmentTopic)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(and(eq(assessmentTopic.id, topicId), eq(assessmentTopic.organizationId, orgId)))
    .returning()
  return updated
})
