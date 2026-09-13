import { and, eq } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../../utils/access/scope'
import { application, applicationQuestionSet, applicationQuestionItem } from '../../../../../database/schema'
import { itemParamSchema } from '../../../../../utils/schemas/candidateQuestions'

/**
 * DELETE /api/applications/:id/question-set/items/:itemId
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: applicationId, itemId } = await getValidatedRouterParams(event, itemParamSchema.parse)
  await requireApplicationInScope(event, applicationId as string, orgId as string)

  const app = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  // Constrain deletion to items belonging to this application's set (org-scoped).
  const set = await db.query.applicationQuestionSet.findFirst({
    where: and(eq(applicationQuestionSet.applicationId, applicationId), eq(applicationQuestionSet.organizationId, orgId)),
    columns: { id: true },
  })
  if (!set) throw createError({ statusCode: 404, statusMessage: 'Набор вопросов не найден' })

  const deleted = await db.delete(applicationQuestionItem)
    .where(and(
      eq(applicationQuestionItem.id, itemId),
      eq(applicationQuestionItem.setId, set.id),
      eq(applicationQuestionItem.organizationId, orgId),
    ))
    .returning({ id: applicationQuestionItem.id })

  if (!deleted.length) throw createError({ statusCode: 404, statusMessage: 'Вопрос не найден' })
  return { success: true }
})
