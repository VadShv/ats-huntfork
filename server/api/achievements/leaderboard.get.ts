import { sql } from 'drizzle-orm'
import { getLevel } from '../../../shared/achievements-catalog'

/**
 * GET /api/achievements/leaderboard
 *
 * Team leaderboard — top recruiters by total achievement XP within the org.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId

  const rows = await db.execute<{ user_id: string, name: string, email: string, xp: number }>(sql`
    SELECT
      ua.user_id,
      COALESCE(u.name, u.email) AS name,
      u.email,
      COALESCE(SUM(a.points), 0)::int AS xp
    FROM user_achievement ua
    JOIN achievement a ON a.id = ua.achievement_id
    JOIN "user" u ON u.id = ua.user_id
    WHERE ua.organization_id = ${orgId}
    GROUP BY ua.user_id, u.name, u.email
    ORDER BY xp DESC
    LIMIT 20
  `)

  return {
    leaderboard: rows.map((r, i) => ({
      rank: i + 1,
      userId: r.user_id,
      name: r.name || r.email,
      xp: r.xp,
      level: getLevel(r.xp),
    })),
  }
})
