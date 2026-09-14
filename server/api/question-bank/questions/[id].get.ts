import { and, eq } from 'drizzle-orm'
import { bankQuestion } from '../../../database/schema'
import { bankQuestionIdParamSchema } from '../../../utils/schemas/bankQuestion'

/** GET /api/question-bank/questions/:id — вопрос + probes + тема. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { questionBank: ['view'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, bankQuestionIdParamSchema.parse)

  const question = await db.query.bankQuestion.findFirst({
    where: and(eq(bankQuestion.id, id), eq(bankQuestion.organizationId, orgId)),
    with: { probes: true, primaryTopic: true },
  })
  if (!question) throw createError({ statusCode: 404, statusMessage: 'Вопрос не найден' })
  return question
})
