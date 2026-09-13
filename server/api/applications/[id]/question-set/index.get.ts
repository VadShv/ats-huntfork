import { and, eq, asc } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../utils/access/scope'
import { application, applicationQuestionSet, applicationQuestionItem } from '../../../../database/schema'
import { applicationIdParamSchema } from '../../../../utils/schemas/candidateQuestions'

/**
 * GET /api/applications/:id/question-set
 * Returns the active question set + items for an application, or null.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id: applicationId } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  await requireApplicationInScope(event, applicationId as string, orgId)

  const app = await db.query.application.findFirst({
    where: and(eq(application.id, applicationId), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  const set = await db.query.applicationQuestionSet.findFirst({
    where: and(eq(applicationQuestionSet.applicationId, applicationId), eq(applicationQuestionSet.organizationId, orgId)),
  })
  if (!set) return { set: null, items: [] }

  const items = await db.query.applicationQuestionItem.findMany({
    where: and(eq(applicationQuestionItem.setId, set.id), eq(applicationQuestionItem.organizationId, orgId)),
    orderBy: [asc(applicationQuestionItem.displayOrder), asc(applicationQuestionItem.createdAt)],
  })

  return { set, items }
})
