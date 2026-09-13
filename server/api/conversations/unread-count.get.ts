import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { commsConversation } from '../../database/schema'
import { getActorContext } from '../../utils/access/actorContext'
import { getScopeJobIds } from '../../utils/access/scope'

/**
 * GET /api/conversations/unread-count — лёгкий счётчик непрочитанных (Спринт 19.5).
 *
 * Одна агрегатная выборка по организации — для бейджа на вкладке «Входящие»
 * в навигации. §G2: скоупим по видимым вакансиям (счётчик не должен раскрывать
 * непрочитанные чужих юрлиц строгим ролям).
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId

  let where = eq(commsConversation.organizationId, orgId)
  const actor = await getActorContext(event)
  if (actor) {
    const jobIds = await getScopeJobIds(actor)
    if (jobIds !== null) {
      where = jobIds.length === 0
        ? and(eq(commsConversation.organizationId, orgId), isNull(commsConversation.jobId))!
        : and(eq(commsConversation.organizationId, orgId), or(isNull(commsConversation.jobId), inArray(commsConversation.jobId, jobIds)))!
    }
  }

  const [row] = await db
    .select({ unread: sql<number>`coalesce(sum(${commsConversation.unreadCount}), 0)::int` })
    .from(commsConversation)
    .where(where)

  return { unread: row?.unread ?? 0 }
})
