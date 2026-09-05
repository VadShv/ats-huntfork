/**
 * Referral assist payout. When a referred candidate's application reaches a
 * 'hired' stage, the referrer (fromUser) earns an assist: SXP + coins.
 * Paid at most once per referral (assistPaid guard).
 */
import { and, eq, sql } from 'drizzle-orm'
import { referral, pipelineStage, userSeasonProgress } from '../../database/schema'
import { GAMIFICATION_CONFIG } from '../../../shared/gamification-config'
import { getOrCreateCurrentSeason } from '../huntpass/season'

export async function payReferralAssistOnHire(orgId: string, applicationId: string, toStageId: string): Promise<boolean> {
  // Only when the target stage is a 'hired' stage.
  const stage = await db.query.pipelineStage.findFirst({
    where: eq(pipelineStage.id, toStageId),
    columns: { type: true },
  })
  if (stage?.type !== 'hired') return false

  // Find an unpaid, accepted referral whose result is this application.
  const ref = await db.query.referral.findFirst({
    where: and(
      eq(referral.organizationId, orgId),
      eq(referral.resultApplicationId, applicationId),
      eq(referral.status, 'accepted'),
      eq(referral.assistPaid, false),
    ),
  })
  if (!ref) return false

  await db.update(referral).set({ status: 'hired', assistPaid: true, resolvedAt: new Date() }).where(eq(referral.id, ref.id))

  const R = GAMIFICATION_CONFIG.referralReward
  // SXP → current season bonus
  const s = await getOrCreateCurrentSeason()
  await db.insert(userSeasonProgress)
    .values({ userId: ref.fromUserId, organizationId: orgId, seasonId: s.id, bonusSxp: R.assistSxp })
    .onConflictDoUpdate({
      target: [userSeasonProgress.organizationId, userSeasonProgress.userId, userSeasonProgress.seasonId],
      set: { bonusSxp: sql`${userSeasonProgress.bonusSxp} + ${R.assistSxp}`, updatedAt: new Date() },
    })
  // Coins → wallet
  try {
    const { creditCoins } = await import('../economy/wallet')
    await creditCoins(ref.fromUserId, orgId, R.assistCoins, 'referral', ref.id)
  } catch { /* best-effort */ }

  return true
}
