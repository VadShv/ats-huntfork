import { and, eq } from 'drizzle-orm'
import { application, applicationWatcher } from '../../../../database/schema/app'
import { user } from '../../../../database/schema/auth'
import { applicationIdParamSchema } from '../../../../utils/schemas/application'

/**
 * GET /api/applications/:id/watchers
 * Returns the list of users subscribed to the collaboration thread.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, applicationIdParamSchema.parse)

  const app = await db.query.application.findFirst({
    where: and(eq(application.id, id), eq(application.organizationId, orgId)),
    columns: { id: true },
  })
  if (!app) throw createError({ statusCode: 404, statusMessage: 'Отклик не найден' })

  const rows = await db
    .select({
      userId: applicationWatcher.userId,
      source: applicationWatcher.source,
      createdAt: applicationWatcher.createdAt,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(applicationWatcher)
    .innerJoin(user, eq(user.id, applicationWatcher.userId))
    .where(eq(applicationWatcher.applicationId, id))
    .orderBy(applicationWatcher.createdAt)

  return { data: rows }
})
