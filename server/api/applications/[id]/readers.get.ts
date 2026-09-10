import { and, eq, desc } from 'drizzle-orm'
import { application, threadReadState } from '../../../database/schema/app'
import { user } from '../../../database/schema/auth'
import { applicationIdParamSchema } from '../../../utils/schemas/application'

/**
 * GET /api/applications/:id/readers
 * Returns users who have read the thread + their lastReadAt.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId
  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)

  const readers = await db
    .select({
      userId: threadReadState.userId,
      lastReadAt: threadReadState.lastReadAt,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(threadReadState)
    .innerJoin(user, eq(user.id, threadReadState.userId))
    .where(eq(threadReadState.applicationId, id))
    .orderBy(desc(threadReadState.lastReadAt))

  return readers
})
