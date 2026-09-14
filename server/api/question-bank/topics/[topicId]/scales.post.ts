import { and, eq } from 'drizzle-orm'
import { assessmentTopic, assessmentScale } from '../../../../database/schema'
import { topicIdParamSchema, createScaleSchema } from '../../../../utils/schemas/bankQuestion'

/**
 * POST /api/question-bank/topics/:topicId/scales — создать шкалу.
 * Если isDefault=true — снимает флаг с прочих шкал темы. manage_topics.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['manage_topics'] })
  const orgId = session.session.activeOrganizationId
  const { topicId } = await getValidatedRouterParams(event, topicIdParamSchema.parse)
  const body = await readValidatedBody(event, createScaleSchema.parse)

  const topic = await db.query.assessmentTopic.findFirst({
    where: and(eq(assessmentTopic.id, topicId), eq(assessmentTopic.organizationId, orgId)),
    columns: { id: true },
  })
  if (!topic) throw createError({ statusCode: 404, statusMessage: 'Тема не найдена' })

  const created = await db.transaction(async (tx) => {
    if (body.isDefault) {
      await tx.update(assessmentScale)
        .set({ isDefault: false })
        .where(and(eq(assessmentScale.topicId, topicId), eq(assessmentScale.organizationId, orgId)))
    }
    const [row] = await tx.insert(assessmentScale).values({
      organizationId: orgId,
      topicId,
      name: body.name,
      type: body.type,
      minValue: body.minValue ?? null,
      maxValue: body.maxValue ?? null,
      allowInsufficientData: body.allowInsufficientData,
      isDefault: body.isDefault,
      displayOrder: body.displayOrder,
    }).returning()
    return row
  })

  setResponseStatus(event, 201)
  return created
})
