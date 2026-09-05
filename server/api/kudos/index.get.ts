import { and, eq, sql } from 'drizzle-orm'
import { kudos } from '../../database/schema'
import { GAMIFICATION_CONFIG } from '../../../shared/gamification-config'
import { weeklyPeriod } from '../../utils/quests/period'

/** GET /api/kudos — received kudos, weekly send allowance, colleagues to thank. */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id
  const week = weeklyPeriod().key

  const received = await db.query.kudos.findMany({
    where: and(eq(kudos.organizationId, orgId), eq(kudos.toUserId, userId)),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 10,
  })
  const totalReceived = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM kudos WHERE organization_id = ${orgId} AND to_user_id = ${userId}
  `)
  const sentThisWeek = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM kudos WHERE organization_id = ${orgId} AND from_user_id = ${userId} AND week_key = ${week}
  `)

  const fromIds = [...new Set(received.map(r => r.fromUserId))]
  const names = new Map<string, string>()
  if (fromIds.length) {
    const nr = await db.execute<{ id: string, name: string }>(sql`
      SELECT id, COALESCE(name, email) AS name FROM "user" WHERE id IN (${sql.join(fromIds.map(i => sql`${i}`), sql`, `)})
    `)
    for (const n of nr as any[]) names.set(n.id, n.name)
  }

  // Colleagues to thank (org recruiters except self).
  const people = await db.execute<{ id: string, name: string }>(sql`
    SELECT u.id, COALESCE(u.name, u.email) AS name
    FROM member m JOIN "user" u ON u.id = m.user_id
    WHERE m.organization_id = ${orgId} AND m.user_id <> ${userId}
  `)

  const sent = Number((sentThisWeek as any[])[0]?.n ?? 0)
  return {
    totalReceived: Number((totalReceived as any[])[0]?.n ?? 0),
    remaining: Math.max(0, GAMIFICATION_CONFIG.kudos.weeklyLimit - sent),
    weeklyLimit: GAMIFICATION_CONFIG.kudos.weeklyLimit,
    received: received.map(r => ({ fromName: names.get(r.fromUserId) ?? '—', reason: r.reason, createdAt: r.createdAt })),
    colleagues: (people as any[]).map(p => ({ userId: p.id, name: p.name })),
  }
})
