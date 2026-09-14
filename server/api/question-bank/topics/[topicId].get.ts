import { and, eq } from 'drizzle-orm'
import { assessmentTopic } from '../../../database/schema'
import { topicIdParamSchema } from '../../../utils/schemas/bankQuestion'

/** GET /api/question-bank/topics/:topicId — тема + шкалы + якоря. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['view'] })
  const orgId = session.session.activeOrganizationId
  const { topicId } = await getValidatedRouterParams(event, topicIdParamSchema.parse)

  const topic = await db.query.assessmentTopic.findFirst({
    where: and(eq(assessmentTopic.id, topicId), eq(assessmentTopic.organizationId, orgId)),
    with: { scales: { with: { anchors: true } } },
  })
  if (!topic) throw createError({ statusCode: 404, statusMessage: 'Тема не найдена' })
  return topic
})
