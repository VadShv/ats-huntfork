import { eq, and } from 'drizzle-orm'
import { db } from '../../../utils/db'
import { analyticsSavedView } from '../../../database/schema'

/** DELETE /api/analytics/views/:id — удалить пресет (только свой). */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { application: ['read'], sourceTracking: ['read'] })
  const orgId = session.session.activeOrganizationId
  const id = getRouterParam(event, 'id')!

  const deleted = await db.delete(analyticsSavedView)
    .where(and(
      eq(analyticsSavedView.id, id),
      eq(analyticsSavedView.organizationId, orgId),
      eq(analyticsSavedView.userId, session.user.id),
    ))
    .returning({ id: analyticsSavedView.id })

  if (!deleted.length) throw createError({ statusCode: 404, statusMessage: 'Пресет не найден' })
  return { ok: true }
})
