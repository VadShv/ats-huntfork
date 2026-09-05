/**
 * Rank ladder tick (D2) — sticky competitive state.
 *
 * RP is season-cumulative (from data). The stored division is sticky:
 *  - climbs via a promo series (RP above the next threshold for N weekly checks),
 *  - decays one subrank after N inactive weeks (RP didn't grow),
 *  - new recruiters/seasons go through a placement (calibration) period,
 *  - a new season soft-resets from the previous peak.
 *
 * Idempotent per (user, season, week): safe to run manually or on schedule.
 */
import { and, eq, sql } from 'drizzle-orm'
import { season, userRank, rankHistory } from '../../database/schema'
import { GAMIFICATION_CONFIG } from '../../../shared/gamification-config'
import { DIVISIONS, divisionForRp } from '../../../shared/ranks-catalog'
import { getOrCreateCurrentSeason } from '../huntpass/season'
import { computeOrgRp } from './rp'
import { weeklyPeriod } from '../quests/period'
import { pushMvpToTelegram } from '../gamification/mvp'

const DIV_KEYS = DIVISIONS.map(d => d.key)
function divIndex(key: string): number {
  const i = DIV_KEYS.indexOf(key)
  return i < 0 ? 0 : i
}

/** Run the ladder tick for one organization. */
export async function runRankTickForOrg(orgId: string, now = new Date()): Promise<number> {
  const cfg = GAMIFICATION_CONFIG.rank
  const s = await getOrCreateCurrentSeason(now)
  const week = weeklyPeriod(now).key
  const rpMap = await computeOrgRp(orgId, s.startsAt.toISOString(), s.endsAt.toISOString())

  // Members of the org (recruiters).
  const members = await db.execute<{ user_id: string }>(sql`
    SELECT user_id FROM member WHERE organization_id = ${orgId}
  `)
  let updated = 0

  for (const m of members as any[]) {
    const userId = m.user_id
    const rp = rpMap.get(userId)?.rp ?? 0
    const liveIdx = divIndex(divisionForRp(rp).division)

    let row = await db.query.userRank.findFirst({
      where: and(eq(userRank.organizationId, orgId), eq(userRank.userId, userId), eq(userRank.seasonId, s.id)),
    })

    // Create a fresh season row, soft-resetting from previous season peak.
    if (!row) {
      const prev = await db.query.userRank.findFirst({
        where: and(eq(userRank.organizationId, orgId), eq(userRank.userId, userId)),
        orderBy: (t, { desc }) => [desc(t.updatedAt)],
      })
      const seedRp = prev ? Math.round(prev.peakRp * cfg.softResetFactor) : 0
      const seedDiv = divisionForRp(seedRp)
      const [created] = await db.insert(userRank).values({
        userId, organizationId: orgId, seasonId: s.id,
        division: seedDiv.division, subrank: seedDiv.subrank,
        status: 'placement', placementWeeksLeft: cfg.placementWeeks,
        peakRp: 0, lastRp: 0,
      }).onConflictDoNothing().returning()
      row = created ?? await db.query.userRank.findFirst({
        where: and(eq(userRank.organizationId, orgId), eq(userRank.userId, userId), eq(userRank.seasonId, s.id)),
      })
      if (!row) continue
    }

    // Skip if already ticked this week (idempotent).
    if (row.lastTickWeek === week) continue

    let { division, subrank, status, placementWeeksLeft, promoProgress, inactiveWeeks } = row
    const grew = rp > row.lastRp
    const curIdx = divIndex(division)

    if (status === 'placement') {
      placementWeeksLeft -= 1
      if (placementWeeksLeft <= 0) {
        const placed = divisionForRp(rp)
        division = placed.division
        subrank = placed.subrank
        status = 'ranked'
        promoProgress = 0
        inactiveWeeks = 0
      }
    } else {
      // Promo: RP sustained above the next division threshold.
      if (liveIdx > curIdx) {
        promoProgress += 1
        if (promoProgress >= cfg.promoWeeksRequired) {
          division = DIV_KEYS[Math.min(curIdx + 1, DIV_KEYS.length - 1)]
          promoProgress = 0
        }
      } else {
        promoProgress = 0
      }
      // Decay: inactivity → soft demotion of one subrank after grace.
      if (!grew) {
        inactiveWeeks += 1
        if (inactiveWeeks >= cfg.decayGraceWeeks) {
          if (subrank > 1) subrank -= 1
          else if (curIdx > 0) { division = DIV_KEYS[curIdx - 1]; subrank = 3 }
          inactiveWeeks = 0
        }
      } else {
        inactiveWeeks = 0
        // Refresh subrank from RP within the (sticky) division band.
        subrank = divisionForRp(rp).division === division ? divisionForRp(rp).subrank : subrank
      }
    }

    // Snapshot history (idempotent per week).
    await db.insert(rankHistory).values({
      userId, organizationId: orgId, seasonId: s.id, weekKey: week, rp, division,
    }).onConflictDoNothing()

    await db.update(userRank).set({
      division, subrank, status, placementWeeksLeft, promoProgress, inactiveWeeks,
      peakRp: Math.max(row.peakRp, rp), lastRp: rp, lastTickWeek: week, updatedAt: new Date(),
    }).where(eq(userRank.id, row.id))
    updated++
  }

  // Resolve any duels whose window has ended (award SXP to winners).
  try { const { resolveExpiredDuels } = await import('../duels/resolve'); await resolveExpiredDuels(orgId) } catch { /* best-effort */ }

  // Weekly MVP announcement (best-effort; no-op unless Telegram is configured).
  try { await pushMvpToTelegram(orgId) } catch { /* best-effort */ }

  return updated
}

/** Run the tick for every organization (scheduled weekly task). */
export async function runRankTickAllOrgs(now = new Date()): Promise<{ orgs: number, updated: number }> {
  const orgs = await db.execute<{ id: string }>(sql`SELECT id FROM organization`)
  let updated = 0
  for (const o of orgs as any[]) {
    try {
      updated += await runRankTickForOrg(o.id, now)
    } catch (e) {
      console.warn('[rank:tick] org failed', o.id, (e as Error).message)
    }
  }
  return { orgs: (orgs as any[]).length, updated }
}
