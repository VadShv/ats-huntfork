import { sql } from 'drizzle-orm'
import { getOrCreateCurrentSeason } from '../../utils/huntpass/season'
import { computeOrgRp } from '../../utils/ranks/rp'
import { GAMIFICATION_CONFIG } from '../../../shared/gamification-config'
import { divisionForRp, LEGEND } from '../../../shared/ranks-catalog'

/**
 * GET /api/rank/leaderboard
 * Seasonal division ladder — recruiters ranked by RP. Top-N = Legend.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })

  const s = await getOrCreateCurrentSeason()
  const rpMap = await computeOrgRp(orgId, s.startsAt.toISOString(), s.endsAt.toISOString())

  // Names for users with RP
  const ids = [...rpMap.keys()]
  const names = new Map<string, string>()
  if (ids.length) {
    const rows = await db.execute<{ id: string, name: string }>(sql`
      SELECT id, COALESCE(name, email) AS name FROM "user"
      WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
    `)
    for (const r of rows as any[]) names.set(r.id, r.name)
  }

  const ranked = [...rpMap.entries()]
    .sort((a, b) => b[1].rp - a[1].rp)
    .slice(0, 20)

  const legendN = GAMIFICATION_CONFIG.rank.legendTopN

  return {
    season: { name: s.name, quarter: s.quarter, year: s.year },
    leaderboard: ranked.map(([uid, r], i) => {
      const isLegend = i < legendN && r.rp > 0
      const info = divisionForRp(r.rp)
      return {
        rank: i + 1,
        userId: uid,
        name: names.get(uid) ?? '—',
        rp: r.rp,
        division: isLegend ? LEGEND.key : info.division,
        divisionName: isLegend ? LEGEND.name : info.name,
        icon: isLegend ? LEGEND.icon : info.icon,
        subrank: isLegend ? 0 : info.subrank,
      }
    }),
  }
})
