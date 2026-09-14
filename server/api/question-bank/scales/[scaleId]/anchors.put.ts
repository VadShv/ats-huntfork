import { and, eq } from 'drizzle-orm'
import { assessmentScale, barsAnchor } from '../../../../database/schema'
import { scaleIdParamSchema, replaceAnchorsSchema } from '../../../../utils/schemas/bankQuestion'

/**
 * PUT /api/question-bank/scales/:scaleId/anchors — заменить набор BARS-якорей
 * шкалы (bulk). manage_topics.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['manage_topics'] })
  const orgId = session.session.activeOrganizationId
  const { scaleId } = await getValidatedRouterParams(event, scaleIdParamSchema.parse)
  const body = await readValidatedBody(event, replaceAnchorsSchema.parse)

  const scale = await db.query.assessmentScale.findFirst({
    where: and(eq(assessmentScale.id, scaleId), eq(assessmentScale.organizationId, orgId)),
    columns: { id: true },
  })
  if (!scale) throw createError({ statusCode: 404, statusMessage: 'Шкала не найдена' })

  const rows = await db.transaction(async (tx) => {
    await tx.delete(barsAnchor)
      .where(and(eq(barsAnchor.scaleId, scaleId), eq(barsAnchor.organizationId, orgId)))
    if (body.anchors.length === 0) return []
    return tx.insert(barsAnchor).values(
      body.anchors.map((a, i) => ({
        organizationId: orgId,
        scaleId,
        value: a.value,
        anchorText: a.anchorText,
        positiveExamples: a.positiveExamples,
        negativeExamples: a.negativeExamples,
        displayOrder: a.displayOrder ?? i,
      })),
    ).returning()
  })

  return { items: rows }
})
