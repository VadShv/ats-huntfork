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
} as const

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
