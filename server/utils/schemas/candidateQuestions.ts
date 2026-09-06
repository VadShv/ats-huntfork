import { z } from 'zod'

// ─────────────────────────────────────────────
// Candidate question set validation schemas (Этап 4)
// ─────────────────────────────────────────────

export const candidateQuestionCategories = [
  'hard_skill', 'soft_skill', 'experience', 'motivation', 'culture', 'logistics', 'risk_probe', 'verification', 'other',
] as const

export const applicationIdParamSchema = z.object({
  id: z.string().min(1),
})

export const itemParamSchema = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
})

/** Generate/regenerate the set. perBankCategory caps how many bank questions per category. */
export const generateSetSchema = z.object({
  perBankCategory: z.number().int().min(0).max(10).default(3),
})

/** Add a manual item. */
export const createItemSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  category: z.enum(candidateQuestionCategories).default('other'),
  listenFor: z.string().max(2000).nullish(),
})

/** Update an item (edit text / mark asked-skipped / answer note / reorder). */
export const updateItemSchema = z.object({
  text: z.string().trim().min(1).max(2000).optional(),
  category: z.enum(candidateQuestionCategories).optional(),
  listenFor: z.string().max(2000).nullish(),
  askStatus: z.enum(['pending', 'asked', 'skipped']).optional(),
  answerNote: z.string().max(4000).nullish(),
  displayOrder: z.number().int().min(0).optional(),
})
