/**
 * Central, extensible configuration for the gamification module.
 * Single source of truth for all tunable weights, multipliers and thresholds.
 * Adding a new criterion = add a key here (+ a metric in the registry).
 *
 * Later: an optional per-org DB override (gamification_settings jsonb) can
 * shallow-merge over these defaults without a deploy.
 */

export type Grade = 'junior' | 'mid' | 'senior' | 'lead'

export const GAMIFICATION_CONFIG = {
  /** SXP awarded per season-window event (before grade/quality multipliers). */
  sxpWeights: {
    hire: 100,
    offer: 40,
    interview: 20,
    vacancyClosed: 80,
  },

  /** Vacancy grade multiplier — harder roles are worth more. */
  gradeMultipliers: {
    junior: 1.0,
    mid: 1.25,
    senior: 1.5,
    lead: 2.0,
  } as Record<Grade, number>,

  /** Offer-acceptance quality multiplier for hire SXP (needs a min sample). */
  qualityFactor: {
    minOffers: 5,
    high: 1.5, // acceptance >= 0.8
    mid: 1.0, // 0.5..0.8
    low: 0.5, // < 0.5
  },

  /** A candidate is "stuck" after this many days in a working stage. */
  stuckDaysThreshold: 7,

  /** First-response SLA in hours (time from application to first recruiter move). */
  responseSlaHours: 24,

  /**
   * Pipeline stages OUTSIDE the recruiter's responsibility (waiting on the
   * hiring manager). Excluded from recruiter "stuck"/hygiene metrics so the
   * recruiter is never penalised for a slow HM. Matched by pipeline_stage.preset_key.
   */
  excludedPresetKeys: ['hm_review'] as string[],

  /**
   * Rank (stage D) — competitive, quality-forward rating.
   * RP = Σ(result_points × gradeMult) × qualityFactor × speedFactor.
   */
  rank: {
    rpWeights: { hire: 50, offer: 15, interview: 5, vacancyClosed: 40 },
    quality: { minOffers: 5, high: 1.3, mid: 1.0, low: 0.7 },
    speed: { fastHours: 12, okHours: 24, slowHours: 48, fast: 1.2, ok: 1.0, slow: 0.8 },
    /** How many recruiters occupy the relative "Legend" division. */
    legendTopN: 3,
    // ── D2: competitive ladder mechanics ──
    /** Consecutive weekly checks above the next threshold to promote. */
    promoWeeksRequired: 3,
    /** Consecutive inactive weeks before a soft demotion (one subrank). */
    decayGraceWeeks: 2,
    /** New-recruiter / new-season calibration period, in weeks. */
    placementWeeks: 2,
    /** Season soft-reset: next season seeds from peak RP × this factor. */
    softResetFactor: 0.5,
  },

  /** Duels (stage E2) — 1v1 weekly challenges. */
  duel: {
    /** Duel runs for this many days from acceptance. */
    durationDays: 7,
    /** Bonus SXP awarded to the winner (added to HuntPass season). */
    winSxp: 100,
    /** Metrics a duel can be fought on (must exist in the metric registry). */
    metrics: [
      { key: 'hires', label: 'Наймы' },
      { key: 'moves_to_offer', label: 'Офферы' },
      { key: 'moves_to_interview', label: 'Интервью' },
      { key: 'manual_moves', label: 'Продвижения' },
    ] as { key: string, label: string }[],
    /** Max simultaneously active/pending duels per recruiter. */
    maxActivePerUser: 3,
  },

  /** Referrals / assists (stage G1) — cooperative reward for a referred hire. */
  referralReward: { assistSxp: 60, assistCoins: 30 },

  /** Kudos / peer recognition (stage G2). */
  kudos: { weeklyLimit: 5, coinReward: 10 },

  /** Economy (stage F) — coins earned from gameplay, spent in the shop. */
  economy: {
    /** Coins per quest = round(sxpReward × coinRatio). */
    questCoinRatio: 0.25,
    /** Coins awarded to a duel winner. */
    duelWinCoins: 25,
    /** Coins per HuntPass tier reward of type 'coins' use reward.amount directly. */
  },
} as const

/** Rank quality factor from offer acceptance. */
export function rpQualityFactor(hires: number, offers: number): number {
  const q = GAMIFICATION_CONFIG.rank.quality
  if (offers < q.minOffers) return q.mid
  const rate = hires / offers
  if (rate >= 0.8) return q.high
  if (rate >= 0.5) return q.mid
  return q.low
}

/** Rank speed factor from average time-to-first-response (hours). */
export function rpSpeedFactor(avgResponseHours: number | null): number {
  const s = GAMIFICATION_CONFIG.rank.speed
  if (avgResponseHours == null) return s.ok
  if (avgResponseHours <= s.fastHours) return s.fast
  if (avgResponseHours <= s.okHours) return s.ok
  if (avgResponseHours >= s.slowHours) return s.slow
  return s.ok
}

/** Grade multiplier for a job's experience level (null / unknown = 1.0). */
export function gradeMultiplier(level: string | null | undefined): number {
  if (!level) return 1.0
  return GAMIFICATION_CONFIG.gradeMultipliers[level as Grade] ?? 1.0
}

/** SQL CASE fragment returning the grade multiplier for a job alias column. */
export function gradeMultiplierSql(col: string): string {
  const m = GAMIFICATION_CONFIG.gradeMultipliers
  return `CASE ${col} WHEN 'lead' THEN ${m.lead} WHEN 'senior' THEN ${m.senior} WHEN 'mid' THEN ${m.mid} WHEN 'junior' THEN ${m.junior} ELSE 1.0 END`
}

/** Hire quality factor from offer acceptance. */
export function hireQualityFactor(hires: number, offers: number): number {
  const q = GAMIFICATION_CONFIG.qualityFactor
  if (offers < q.minOffers) return q.mid
  const rate = hires / offers
  if (rate >= 0.8) return q.high
  if (rate >= 0.5) return q.mid
  return q.low
}
