import { getOrCreateCurrentSeason } from '../../utils/huntpass/season'
import { computeOrgRp } from '../../utils/ranks/rp'
import { GAMIFICATION_CONFIG } from '../../../shared/gamification-config'
import { divisionForRp, nextDivision, LEGEND } from '../../../shared/ranks-catalog'

/**
 * GET /api/rank
 * The recruiter's competitive rank for the current season: RP, division,
 * sub-rank, position, and a quality/speed breakdown.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id

  const s = await getOrCreateCurrentSeason()
  const map = await computeOrgRp(orgId, s.startsAt.toISOString(), s.endsAt.toISOString())

  const mine = map.get(userId) ?? { rp: 0, hires: 0, offers: 0, interviews: 0, vacanciesClosed: 0, avgResponseHours: null, quality: 1, speed: 1 }

  // Ranked list (RP desc) for position + Legend (top-N).
  const ranked = [...map.entries()].sort((a, b) => b[1].rp - a[1].rp)
  const position = ranked.findIndex(([uid]) => uid === userId) + 1
  const legendIds = new Set(ranked.slice(0, GAMIFICATION_CONFIG.rank.legendTopN).filter(([, r]) => r.rp > 0).map(([uid]) => uid))
  const isLegend = legendIds.has(userId)

  const info = divisionForRp(mine.rp)
  const nxt = nextDivision(info.division)

  return {
    season: { name: s.name, quarter: s.quarter, year: s.year, daysLeft: Math.max(0, Math.ceil((s.endsAt.getTime() - Date.now()) / 86_400_000)) },
    rp: mine.rp,
    division: isLegend
      ? { key: LEGEND.key, name: LEGEND.name, icon: LEGEND.icon, subrank: 0, atCeiling: true, isLegend: true }
      : { ...info, isLegend: false },
    nextDivision: !isLegend && nxt ? { key: nxt.key, name: nxt.name, remainingRp: Math.max(0, nxt.min - mine.rp) } : null,
    position: position || null,
    total: ranked.length,
    breakdown: {
      hires: mine.hires, offers: mine.offers, interviews: mine.interviews,
      vacanciesClosed: mine.vacanciesClosed, quality: mine.quality, speed: mine.speed,
      avgResponseHours: mine.avgResponseHours,
    },
  }
})
