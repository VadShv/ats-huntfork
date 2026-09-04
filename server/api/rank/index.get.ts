import { and, eq } from 'drizzle-orm'
import { userRank, rankHistory } from '../../database/schema'
import { getOrCreateCurrentSeason } from '../../utils/huntpass/season'
import { computeOrgRp } from '../../utils/ranks/rp'
import { GAMIFICATION_CONFIG } from '../../../shared/gamification-config'
import { divisionForRp, nextDivision, DIVISIONS, LEGEND } from '../../../shared/ranks-catalog'

/**
 * GET /api/rank
 * Competitive rank for the current season: live RP + sticky division (D2 state:
 * promo series, placement), position, quality/speed breakdown, and RP trend.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id

  const s = await getOrCreateCurrentSeason()
  const map = await computeOrgRp(orgId, s.startsAt.toISOString(), s.endsAt.toISOString())
  const mine = map.get(userId) ?? { rp: 0, hires: 0, offers: 0, interviews: 0, vacanciesClosed: 0, avgResponseHours: null, quality: 1, speed: 1 }

  const ranked = [...map.entries()].sort((a, b) => b[1].rp - a[1].rp)
  const position = ranked.findIndex(([uid]) => uid === userId) + 1
  const legendIds = new Set(ranked.slice(0, GAMIFICATION_CONFIG.rank.legendTopN).filter(([, r]) => r.rp > 0).map(([uid]) => uid))
  const isLegend = legendIds.has(userId)

  // Sticky D2 state (populated by the weekly tick / manual tick).
  const state = await db.query.userRank.findFirst({
    where: and(eq(userRank.organizationId, orgId), eq(userRank.userId, userId), eq(userRank.seasonId, s.id)),
  })

  // Division source: sticky state if present, else live from RP.
  const liveInfo = divisionForRp(mine.rp)
  const divKey = state?.status === 'ranked' ? state.division : liveInfo.division
  const divMeta = DIVISIONS.find(d => d.key === divKey) ?? DIVISIONS[0]
  const subrank = state?.status === 'ranked' ? state.subrank : liveInfo.subrank
  const inPlacement = !state || state.status === 'placement'
  const nxt = nextDivision(divKey)

  // Trend: last 8 weekly RP snapshots.
  const history = await db.query.rankHistory.findMany({
    where: and(eq(rankHistory.organizationId, orgId), eq(rankHistory.userId, userId), eq(rankHistory.seasonId, s.id)),
    orderBy: (t, { asc }) => [asc(t.weekKey)],
  })
  const trend = history.slice(-8).map(h => h.rp)

  return {
    season: { name: s.name, quarter: s.quarter, year: s.year, daysLeft: Math.max(0, Math.ceil((s.endsAt.getTime() - Date.now()) / 86_400_000)) },
    rp: mine.rp,
    division: isLegend
      ? { key: LEGEND.key, name: LEGEND.name, icon: LEGEND.icon, subrank: 0, isLegend: true, min: 0, max: 0 }
      : { key: divKey, name: divMeta.name, icon: divMeta.icon, subrank, isLegend: false, min: divMeta.min, max: divMeta.max },
    placement: inPlacement && !isLegend ? { weeksLeft: state?.placementWeeksLeft ?? GAMIFICATION_CONFIG.rank.placementWeeks } : null,
    promo: state?.status === 'ranked' && !isLegend && nxt
      ? { progress: state.promoProgress, required: GAMIFICATION_CONFIG.rank.promoWeeksRequired, toDivision: nxt.name }
      : null,
    nextDivision: !isLegend && nxt ? { key: nxt.key, name: nxt.name, remainingRp: Math.max(0, nxt.min - mine.rp) } : null,
    position: position || null,
    total: ranked.length,
    breakdown: {
      hires: mine.hires, offers: mine.offers, interviews: mine.interviews,
      vacanciesClosed: mine.vacanciesClosed, quality: mine.quality, speed: mine.speed,
      avgResponseHours: mine.avgResponseHours,
    },
    trend,
  }
})
