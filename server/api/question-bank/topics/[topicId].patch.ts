import { and, eq } from 'drizzle-orm'
import { assessmentTopic } from '../../../database/schema'
import { topicIdParamSchema, updateTopicSchema } from '../../../utils/schemas/bankQuestion'

/** PATCH /api/question-bank/topics/:topicId — правка темы. manage_topics. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['manage_topics'] })
  const orgId = session.session.activeOrganizationId
  const { topicId } = await getValidatedRouterParams(event, topicIdParamSchema.parse)
  const body = await readValidatedBody(event, updateTopicSchema.parse)

  const existing = await db.query.assessmentTopic.findFirst({
    where: and(eq(assessmentTopic.id, topicId), eq(assessmentTopic.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Тема не найдена' })

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  for (const k of ['name', 'shortName', 'type', 'definition', 'goal', 'positiveIndicators',
    'negativeIndicators', 'parentTopicId', 'targetRoles', 'tags', 'displayOrder', 'status'] as const) {
    if (body[k] !== undefined) patch[k] = body[k]
  }

  const [updated] = await db.update(assessmentTopic)
    .set(patch)
    .where(and(eq(assessmentTopic.id, topicId), eq(assessmentTopic.organizationId, orgId)))
    .returning()
  return updated
})
