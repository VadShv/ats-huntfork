/**
 * Duel scoring & resolution. Scores use the shared metric registry, windowed to
 * the duel period. Winner gets bonus SXP (added to the HuntPass season).
 */
import { and, eq, lt, sql } from 'drizzle-orm'
import { duel, userSeasonProgress } from '../../database/schema'
import { GAMIFICATION_CONFIG } from '../../../shared/gamification-config'
import { computeMetric } from '../gamification/metrics-registry'
import { getOrCreateCurrentSeason } from '../huntpass/season'

/** Live scores for an active duel. */
export async function duelScores(d: { organizationId: string, challengerId: string, opponentId: string, metric: string, startsAt: Date | null, endsAt: Date | null }) {
  if (!d.startsAt || !d.endsAt) return { challenger: 0, opponent: 0 }
  const start = d.startsAt.toISOString()
  const end = d.endsAt.toISOString()
  const [c, o] = await Promise.all([
    computeMetric(d.metric, d.challengerId, d.organizationId, start, end),
    computeMetric(d.metric, d.opponentId, d.organizationId, start, end),
  ])
  return { challenger: c, opponent: o }
}

/** Resolve a single active duel that has ended: set winner + award SXP. */
export async function resolveDuel(d: typeof duel.$inferSelect): Promise<void> {
  const { challenger, opponent } = await duelScores(d)
  const winnerId = challenger > opponent ? d.challengerId : opponent > challenger ? d.opponentId : null

  await db.update(duel).set({
    status: 'completed', winnerId, challengerScore: challenger, opponentScore: opponent, resolvedAt: new Date(),
  }).where(eq(duel.id, d.id))

  if (winnerId) {
    const s = await getOrCreateCurrentSeason()
    await db.insert(userSeasonProgress)
      .values({ userId: winnerId, organizationId: d.organizationId, seasonId: s.id, bonusSxp: GAMIFICATION_CONFIG.duel.winSxp })
      .onConflictDoUpdate({
        target: [userSeasonProgress.organizationId, userSeasonProgress.userId, userSeasonProgress.seasonId],
        set: { bonusSxp: sql`${userSeasonProgress.bonusSxp} + ${GAMIFICATION_CONFIG.duel.winSxp}`, updatedAt: new Date() },
      })
  }
}

/** Resolve all active duels in an org whose window has ended. */
export async function resolveExpiredDuels(orgId: string): Promise<number> {
  const expired = await db.query.duel.findMany({
    where: and(eq(duel.organizationId, orgId), eq(duel.status, 'active'), lt(duel.endsAt, new Date())),
  })
  for (const d of expired) await resolveDuel(d)
  return expired.length
}
