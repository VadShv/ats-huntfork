import { and, eq, asc } from 'drizzle-orm'
import { assessmentTopic, assessmentScale } from '../../../../database/schema'
import { topicIdParamSchema } from '../../../../utils/schemas/bankQuestion'

/** GET /api/question-bank/topics/:topicId/scales — шкалы темы + якоря. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['view'] })
  const orgId = session.session.activeOrganizationId
  const { topicId } = await getValidatedRouterParams(event, topicIdParamSchema.parse)

  const topic = await db.query.assessmentTopic.findFirst({
    where: and(eq(assessmentTopic.id, topicId), eq(assessmentTopic.organizationId, orgId)),
    columns: { id: true },
  })
  if (!topic) throw createError({ statusCode: 404, statusMessage: 'Тема не найдена' })

  const scales = await db.query.assessmentScale.findMany({
    where: and(eq(assessmentScale.topicId, topicId), eq(assessmentScale.organizationId, orgId)),
    orderBy: [asc(assessmentScale.displayOrder)],
    with: { anchors: true },
  })
  return { items: scales }
})
