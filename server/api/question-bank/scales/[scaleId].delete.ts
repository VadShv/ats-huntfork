import { and, eq } from 'drizzle-orm'
import { assessmentScale, bankQuestion } from '../../../database/schema'
import { scaleIdParamSchema } from '../../../utils/schemas/bankQuestion'

/**
 * DELETE /api/question-bank/scales/:scaleId — удалить шкалу.
 * Запрет, если шкала используется опубликованным вопросом (scaleIdOverride). manage_topics.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['manage_topics'] })
  const orgId = session.session.activeOrganizationId
  const { scaleId } = await getValidatedRouterParams(event, scaleIdParamSchema.parse)

  const existing = await db.query.assessmentScale.findFirst({
    where: and(eq(assessmentScale.id, scaleId), eq(assessmentScale.organizationId, orgId)),
    columns: { id: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Шкала не найдена' })

  const usedByPublished = await db.query.bankQuestion.findFirst({
    where: and(
      eq(bankQuestion.scaleIdOverride, scaleId),
      eq(bankQuestion.organizationId, orgId),
      eq(bankQuestion.status, 'published'),
    ),
    columns: { id: true },
  })
  if (usedByPublished) {
    throw createError({ statusCode: 422, statusMessage: 'Шкала используется опубликованным вопросом' })
  }

  await db.delete(assessmentScale)
    .where(and(eq(assessmentScale.id, scaleId), eq(assessmentScale.organizationId, orgId)))
  setResponseStatus(event, 204)
  return null
})
