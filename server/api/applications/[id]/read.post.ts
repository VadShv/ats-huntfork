import { and, eq } from 'drizzle-orm'
import { requireApplicationInScope } from '../../../utils/access/scope'
import { threadReadState } from '../../../database/schema/app'
import { applicationIdParamSchema } from '../../../utils/schemas/application'

/**
 * POST /api/applications/:id/read
 * Upsert current user's read state: state for the thread.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const userId = session.user.id
  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)
  await requireApplicationInScope(event, id as string, session.session.activeOrganizationId as string)

  await db.insert(threadReadState)
    .values({ applicationId: id, userId, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: [threadReadState.applicationId, threadReadState.userId],
      set: { lastReadAt: new Date() },
    })

  return { ok: true }
})
