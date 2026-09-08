import { z } from 'zod'

// ─────────────────────────────────────────────
// Resume version edit schemas
// ─────────────────────────────────────────────

export const experienceItemSchema = z.object({
  company: z.string().max(500).optional(),
  position: z.string().max(500).optional(),
  start: z.string().max(20).optional(),
  end: z.string().max(20).optional(),
  description: z.string().max(10_000).optional(),
})

export const salarySchema = z.object({
  amount: z.number().int().min(0).nullable(),
  currency: z.string().max(10).optional(),
})

export const editResumeVersionSchema = z.object({
  experience: z.array(experienceItemSchema).optional(),
  salary: salarySchema.nullable().optional(),
})

export const candidateIdParamSchema = z.object({
  id: z.string().min(1),
})
