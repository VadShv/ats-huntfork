import { and, eq } from 'drizzle-orm'
import { application, applicationWatcher } from '../../../../database/schema/app'
import { watcherIdParamSchema } from '../../../../utils/schemas/applicationComment'

/**
 * DELETE /api/applications/:id/watchers/:userId
 * Unsubscribe the user from thread notifications.
 * Allowed for self-unsubscribe or by admin/owner (will be enforced via
 * application:update permission already in route guard).
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['update'] })
  const orgId = session.session.activeOrganizationId
  const actorId = session.user.id

  const { id, userId } = await getValidatedRouterParams(event, watcherIdParamSchema.parse)

  // Confirm app belongs to org
  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  await db
    .delete(applicationWatcher)
    .where(and(eq(applicationWatcher.applicationId, id), eq(applicationWatcher.userId, userId)))

  setResponseStatus(event, 204)
  return null
})
