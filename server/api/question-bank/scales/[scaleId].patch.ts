import { and, eq } from 'drizzle-orm'
import { assessmentScale } from '../../../database/schema'
import { scaleIdParamSchema, updateScaleSchema } from '../../../utils/schemas/bankQuestion'

/** PATCH /api/question-bank/scales/:scaleId — правка шкалы (в т.ч. isDefault). manage_topics. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['manage_topics'] })
  const orgId = session.session.activeOrganizationId
  const { scaleId } = await getValidatedRouterParams(event, scaleIdParamSchema.parse)
  const body = await readValidatedBody(event, updateScaleSchema.parse)

  const existing = await db.query.assessmentScale.findFirst({
    where: and(eq(assessmentScale.id, scaleId), eq(assessmentScale.organizationId, orgId)),
    columns: { id: true, topicId: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Шкала не найдена' })

  const updated = await db.transaction(async (tx) => {
    if (body.isDefault === true) {
      await tx.update(assessmentScale)
        .set({ isDefault: false })
        .where(and(eq(assessmentScale.topicId, existing.topicId), eq(assessmentScale.organizationId, orgId)))
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    for (const k of ['name', 'type', 'minValue', 'maxValue', 'allowInsufficientData', 'isDefault', 'displayOrder'] as const) {
      if (body[k] !== undefined) patch[k] = body[k]
    }
    const [row] = await tx.update(assessmentScale)
      .set(patch)
      .where(and(eq(assessmentScale.id, scaleId), eq(assessmentScale.organizationId, orgId)))
      .returning()
    return row
  })
  return updated
})
