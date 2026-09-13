import { and, eq, desc } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../../utils/access/scope'
import { application, applicationQuestionSet, applicationQuestionItem } from '../../../../../database/schema'
import { applicationIdParamSchema, createItemSchema } from '../../../../../utils/schemas/candidateQuestions'

/**
 * POST /api/applications/:id/question-set/items
 * Add a manual question item (creates the set if missing).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId

  const { id: applicationId } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  await requireApplicationInScope(event, applicationId as string, orgId)
  const body = await readValidatedBody(event, createItemSchema.parse)

  const app = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  let set = await db.query.applicationQuestionSet.findFirst({
    where: and(eq(applicationQuestionSet.applicationId, applicationId), eq(applicationQuestionSet.organizationId, orgId)),
    columns: { id: true },
  })
  if (!set) {
    const [created] = await db.insert(applicationQuestionSet)
      .values({ organizationId: orgId, applicationId, createdById: session.user.id })
      .returning({ id: applicationQuestionSet.id })
    set = created!
  }

  const last = await db.query.applicationQuestionItem.findFirst({
    where: eq(applicationQuestionItem.setId, set.id),
    orderBy: [desc(applicationQuestionItem.displayOrder)],
    columns: { displayOrder: true },
  })

  const [item] = await db.insert(applicationQuestionItem).values({
    organizationId: orgId,
    setId: set.id,
    text: body.text,
    category: body.category,
    listenFor: body.listenFor ?? null,
    origin: 'manual',
    displayOrder: (last?.displayOrder ?? -1) + 1,
  }).returning()

  setResponseStatus(event, 201)
  return item
})
