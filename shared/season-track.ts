/**
 * HuntPass — season track catalog: SXP curve, tiers, rewards, SXP weights.
 * Single source of truth for the seasonal progression.
 */

export const TIER_COUNT = 30

/**
 * Cumulative SXP required to REACH tier N (1..30).
 * Growing curve: threshold(N) = 100*N + 10*N^2.
 * Tier 1 = 110, tier 10 = 2000, tier 30 = 12000.
 */
export function tierThreshold(n: number): number {
  return 100 * n + 10 * n * n
}

/** Highest tier reached for a given SXP (0..TIER_COUNT). */
export function tierForSxp(sxp: number): number {
  let tier = 0
  for (let n = 1; n <= TIER_COUNT; n++) {
    if (sxp >= tierThreshold(n)) tier = n
    else break
  }
  return tier
}

/** SXP weights for season-window events (quality applied to hires separately). */
export const SXP_WEIGHTS = {
  hire: 100,
  offer: 40,
  interview: 20,
  vacancyClosed: 80,
} as const

/**
 * Quality factor applied to hire SXP based on offer acceptance.
 * Needs a minimum number of offers to matter, otherwise neutral.
 */
export function hireQualityFactor(hires: number, offers: number): number {
  if (offers < 5) return 1.0
  const rate = hires / offers
  if (rate >= 0.8) return 1.5
  if (rate >= 0.5) return 1.0
  return 0.5
}

export type RewardType = 'coins' | 'title' | 'badge' | 'frame' | 'xp_boost' | 'reroll' | 'perk'

export interface TierReward {
  type: RewardType
  label: string
  icon: string
  amount?: number
}

export interface SeasonTier {
  tier: number
  requiredSxp: number
  free: TierReward
  premium: TierReward | null
}

/** Deterministic reward for a tier (data-driven, no per-season editing needed). */
function buildTier(n: number): SeasonTier {
  const isMilestone = n % 10 === 0
  const isMid = n % 5 === 0

  let free: TierReward
  if (n === TIER_COUNT) {
    free = { type: 'title', label: 'Рекрутер сезона', icon: '👑' }
  } else if (isMilestone) {
    free = { type: 'badge', label: `Веха ${n}`, icon: '🏅' }
  } else if (isMid) {
    free = { type: 'coins', label: '+50 монет', icon: '🪙', amount: 50 }
  } else {
    free = { type: 'coins', label: '+20 монет', icon: '🪙', amount: 20 }
  }

  let premium: TierReward | null = null
  if (n === TIER_COUNT) {
    premium = { type: 'frame', label: 'Легендарная рамка', icon: '💠' }
  } else if (isMilestone) {
    premium = { type: 'xp_boost', label: 'XP-boost ×2 (1 день)', icon: '⚡' }
  } else if (isMid) {
    premium = { type: 'coins', label: '+100 монет', icon: '🪙', amount: 100 }
  } else {
    premium = { type: 'coins', label: '+40 монет', icon: '🪙', amount: 40 }
  }

  return { tier: n, requiredSxp: tierThreshold(n), free, premium }
}

export const SEASON_TIERS: SeasonTier[] = Array.from({ length: TIER_COUNT }, (_, i) => buildTier(i + 1))

/** Season names by quarter. */
export const SEASON_THEMES: Record<number, { name: string, theme: string }> = {
  1: { name: 'Зимний найм', theme: 'winter' },
  2: { name: 'Весенний поток', theme: 'spring' },
  3: { name: 'Летний марафон', theme: 'summer' },
  4: { name: 'Финишный рывок', theme: 'autumn' },
}
