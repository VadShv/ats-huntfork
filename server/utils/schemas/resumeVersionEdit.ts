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

export const educationItemSchema = z.object({
  organization: z.string().max(500).optional(),
  name: z.string().max(500).optional(),
  result: z.string().max(500).optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
})

export const languageItemSchema = z.object({
  name: z.string().max(100).optional(),
  level: z.string().max(100).optional(),
})

export const editResumeVersionSchema = z.object({
  // Header
  firstName: z.string().max(200).optional(),
  lastName: z.string().max(200).optional(),
  middleName: z.string().max(200).optional(),
  title: z.string().max(500).optional(),
  area: z.string().max(200).optional(),
  // Blocks
  experience: z.array(experienceItemSchema).optional(),
  education: z.array(educationItemSchema).optional(),
  skills: z.array(z.string().max(200)).optional(),
  about: z.string().max(10_000).optional(),
  languages: z.array(languageItemSchema).optional(),
  // Finance
  salary: salarySchema.nullable().optional(),
})

export const candidateIdParamSchema = z.object({
  id: z.string().min(1),
})
