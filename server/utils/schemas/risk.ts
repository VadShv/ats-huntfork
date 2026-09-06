import { z } from 'zod'

// ─────────────────────────────────────────────
// Resume risk validation schemas (Этап 3)
// ─────────────────────────────────────────────

/** Route param for candidate id. */
export const candidateIdParamSchema = z.object({
  id: z.string().min(1),
})

/** Route param for candidate id + resume version id. */
export const versionRiskParamSchema = z.object({
  id: z.string().min(1),
  versionId: z.string().min(1),
})

/** Trigger a risk run (optional force to bypass the contentHash cache). */
export const triggerRiskSchema = z.object({
  force: z.boolean().default(false),
})

/** Org-level risk policy upsert (all optional / bounded). */
export const updateRiskPolicySchema = z.object({
  shortStintMonths: z.number().int().min(1).max(60).optional(),
  jobHoppingMediumScore: z.number().int().min(0).max(100).optional(),
  jobHoppingHighScore: z.number().int().min(0).max(100).optional(),
  capLinguisticToMedium: z.boolean().optional(),
  extraInstructions: z.string().max(2000).nullish(),
})
