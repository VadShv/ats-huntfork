import { and, eq } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../../utils/access/scope'
import { application, applicationQuestionSet, applicationQuestionItem } from '../../../../../database/schema'
import { itemParamSchema, updateItemSchema } from '../../../../../utils/schemas/candidateQuestions'

/**
 * PATCH /api/applications/:id/question-set/items/:itemId
 * Edit text/category/listenFor, mark asked/skipped, set answer note, reorder.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: applicationId, itemId } = await getValidatedRouterParams(event, itemParamSchema.parse)
  await requireApplicationInScope(event, applicationId as string, orgId as string)
  const body = await readValidatedBody(event, updateItemSchema.parse)

  // Ensure application ∈ org and item ∈ its set.
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  const set = await db.query.applicationQuestionSet.findFirst({
    where: and(eq(applicationQuestionSet.applicationId, applicationId), eq(applicationQuestionSet.organizationId, orgId)),
    columns: { id: true },
  })
  if (!set) throw createError({ statusCode: 404, statusMessage: 'Набор вопросов не найден' })

  const existing = await db.query.applicationQuestionItem.findFirst({
    where: and(eq(applicationQuestionItem.id, itemId), eq(applicationQuestionItem.setId, set.id)),
    columns: { id: true },
  })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Вопрос не найден' })

  const [updated] = await db.update(applicationQuestionItem)
    .set({
      ...(body.text !== undefined ? { text: body.text } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.listenFor !== undefined ? { listenFor: body.listenFor ?? null } : {}),
      ...(body.askStatus !== undefined ? { askStatus: body.askStatus } : {}),
      ...(body.answerNote !== undefined ? { answerNote: body.answerNote ?? null } : {}),
      ...(body.displayOrder !== undefined ? { displayOrder: body.displayOrder } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(applicationQuestionItem.id, itemId), eq(applicationQuestionItem.organizationId, orgId)))
    .returning()

  return updated
})
