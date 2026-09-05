import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { userSeasonProgress } from '../../database/schema'
import { getOrCreateCurrentSeason } from '../../utils/huntpass/season'
import { computeSeasonSxp } from '../../utils/huntpass/sxp'
import { tierForSxp, SEASON_TIERS } from '../../../shared/season-track'

const bodySchema = z.object({ tier: z.number().int().min(1).max(30) })

/**
 * POST /api/huntpass/claim
 * Claims the reward for a reached, unclaimed tier of the current season.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id
  const { tier } = await readValidatedBody(event, bodySchema.parse)

  const s = await getOrCreateCurrentSeason()
  const breakdown = await computeSeasonSxp(userId, orgId, s.startsAt, s.endsAt)
  const existingProgress = await db.query.userSeasonProgress.findFirst({
    where: and(
      eq(userSeasonProgress.organizationId, orgId),
      eq(userSeasonProgress.userId, userId),
      eq(userSeasonProgress.seasonId, s.id),
    ),
  })
  const reachedTier = tierForSxp(breakdown.sxp + (existingProgress?.bonusSxp ?? 0))

  if (tier > reachedTier) {
    throw createError({ statusCode: 400, statusMessage: 'Тир ещё не достигнут' })
  }
  const tierDef = SEASON_TIERS.find(t => t.tier === tier)
  if (!tierDef) throw createError({ statusCode: 404, statusMessage: 'Тир не найден' })

  const progress = await db.query.userSeasonProgress.findFirst({
    where: and(
      eq(userSeasonProgress.organizationId, orgId),
      eq(userSeasonProgress.userId, userId),
      eq(userSeasonProgress.seasonId, s.id),
    ),
  })
  const claimed = new Set(progress?.claimedTiers ?? [])
  if (claimed.has(tier)) {
    throw createError({ statusCode: 409, statusMessage: 'Награда уже получена' })
  }
  claimed.add(tier)

  await db.insert(userSeasonProgress)
    .values({ userId, organizationId: orgId, seasonId: s.id, claimedTiers: [...claimed] })
    .onConflictDoUpdate({
      target: [userSeasonProgress.organizationId, userSeasonProgress.userId, userSeasonProgress.seasonId],
      set: { claimedTiers: [...claimed], updatedAt: new Date() },
    })

  const rewards = [tierDef.free, ...(progress?.isPremium && tierDef.premium ? [tierDef.premium] : [])]

  // Credit coin-type rewards to the wallet (economy stage F).
  const coins = rewards.filter(r => r.type === 'coins').reduce((sum, r) => sum + (r.amount ?? 0), 0)
  if (coins > 0) {
    try {
      const { creditCoins } = await import('../../utils/economy/wallet')
      await creditCoins(userId, orgId, coins, 'tier', `${s.id}:${tier}`)
    } catch { /* best-effort */ }
  }

  return { success: true, tier, rewards, coinsAwarded: coins }
})
