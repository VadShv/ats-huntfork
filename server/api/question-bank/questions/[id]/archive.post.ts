import { and, eq } from 'drizzle-orm'
import { bankQuestion } from '../../../../database/schema'
import { bankQuestionIdParamSchema } from '../../../../utils/schemas/bankQuestion'

/** POST /api/question-bank/questions/:id/archive — soft-архивация вопроса. archive. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['archive'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, bankQuestionIdParamSchema.parse)

  const q = await db.query.bankQuestion.findFirst({
    where: and(eq(bankQuestion.id, id), eq(bankQuestion.organizationId, orgId)),
    columns: { id: true },
  })
  if (!q) throw createError({ statusCode: 404, statusMessage: 'Вопрос не найден' })

  const [updated] = await db.update(bankQuestion)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(and(eq(bankQuestion.id, id), eq(bankQuestion.organizationId, orgId)))
    .returning()
  return updated
})
