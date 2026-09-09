import { eq, and, desc } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { analyticsSavedView } from '../../../database/schema'

/** GET /api/analytics/views — список пресетов текущего пользователя. */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId

  const views = await db.select({
    id: analyticsSavedView.id,
    name: analyticsSavedView.name,
    filters: analyticsSavedView.filters,
    createdAt: analyticsSavedView.createdAt,
  })
    .from(analyticsSavedView)
    .where(and(eq(analyticsSavedView.organizationId, orgId), eq(analyticsSavedView.userId, session.user.id)))
    .orderBy(desc(analyticsSavedView.createdAt))

  return { views }
})
