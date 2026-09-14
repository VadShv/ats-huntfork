import { and, eq, desc } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../../utils/access/scope'
import { applicationQuestionSet } from '../../../../database/schema'
import { applicationIdParamSchema } from '../../../../utils/schemas/candidateQuestions'

/** GET /api/applications/:id/question-set/versions — список версий (snapshot + активная). */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId
  const { id: applicationId } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  await requireApplicationInScope(event, applicationId as string, orgId)

  const items = await db.query.applicationQuestionSet.findMany({
    where: and(eq(applicationQuestionSet.applicationId, applicationId), eq(applicationQuestionSet.organizationId, orgId)),
    orderBy: [desc(applicationQuestionSet.version)],
    columns: {
      id: true, version: true, isSnapshot: true, confirmedAt: true,
      personalizedAt: true, isStale: true, generatedAt: true,
    },
  })
  return { items }
})
