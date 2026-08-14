import { eq, sql } from 'drizzle-orm'
import { commsConversation } from '../../database/schema'

/**
 * GET /api/conversations/unread-count — лёгкий счётчик непрочитанных (Спринт 19.5).
 *
 * Одна агрегатная выборка по организации — для бейджа на вкладке «Входящие»
 * в навигации. Опрашивается фоново каждые 30 секунд, поэтому без join'ов.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId

  const [row] = await db
    .select({ unread: sql<number>`coalesce(sum(${commsConversation.unreadCount}), 0)::int` })
    .from(commsConversation)
    .where(eq(commsConversation.organizationId, orgId))

  return { unread: row?.unread ?? 0 }
})
