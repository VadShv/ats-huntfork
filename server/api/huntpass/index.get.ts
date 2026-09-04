import { and, eq } from 'drizzle-orm'
import { userSeasonProgress } from '../../database/schema'
import { getOrCreateCurrentSeason } from '../../utils/huntpass/season'
import { computeSeasonSxp } from '../../utils/huntpass/sxp'
import { SEASON_TIERS, tierForSxp, TIER_COUNT } from '../../../shared/season-track'

/**
 * GET /api/huntpass
 *
 * Returns the current season, the recruiter's SXP + tier progress, and the
 * full tier list with rewards and claimed status.
 */
export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const orgId = session.session.activeOrganizationId
  if (!orgId) throw createError({ statusCode: 403, statusMessage: 'Нет активной организации' })
  const userId = session.user.id

  const s = await getOrCreateCurrentSeason()

  // Ensure a progress row exists (for is_premium / claimed_tiers)
  let progress = await db.query.userSeasonProgress.findFirst({
    where: and(
      eq(userSeasonProgress.organizationId, orgId),
      eq(userSeasonProgress.userId, userId),
      eq(userSeasonProgress.seasonId, s.id),
    ),
  })
  if (!progress) {
    const [row] = await db.insert(userSeasonProgress).values({
      userId, organizationId: orgId, seasonId: s.id,
    }).onConflictDoNothing().returning()
    progress = row ?? await db.query.userSeasonProgress.findFirst({
      where: and(
        eq(userSeasonProgress.organizationId, orgId),
        eq(userSeasonProgress.userId, userId),
        eq(userSeasonProgress.seasonId, s.id),
      ),
    })
  }

  const breakdown = await computeSeasonSxp(userId, orgId, s.startsAt, s.endsAt)
  const currentTier = tierForSxp(breakdown.sxp)
  const claimed = new Set(progress?.claimedTiers ?? [])
  const isPremium = progress?.isPremium ?? false

  const nextTierDef = SEASON_TIERS.find(t => t.tier === currentTier + 1) ?? null
  const now = Date.now()
  const daysLeft = Math.max(0, Math.ceil((s.endsAt.getTime() - now) / 86_400_000))

  return {
    season: {
      name: s.name,
      quarter: s.quarter,
      year: s.year,
      theme: s.theme,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      daysLeft,
    },
    sxp: breakdown.sxp,
    breakdown,
    currentTier,
    tierCount: TIER_COUNT,
    isPremium,
    nextTier: nextTierDef
      ? { tier: nextTierDef.tier, requiredSxp: nextTierDef.requiredSxp, remaining: Math.max(0, nextTierDef.requiredSxp - breakdown.sxp) }
      : null,
    tiers: SEASON_TIERS.map(t => ({
      tier: t.tier,
      requiredSxp: t.requiredSxp,
      free: t.free,
      premium: t.premium,
      reached: breakdown.sxp >= t.requiredSxp,
      claimed: claimed.has(t.tier),
    })),
  }
})
