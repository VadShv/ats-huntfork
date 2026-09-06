import { z } from 'zod'

// ─────────────────────────────────────────────
// Interview-question bank validation schemas (Этап 2)
// ─────────────────────────────────────────────

export const interviewQuestionCategories = [
  'hard_skill', 'soft_skill', 'experience', 'motivation', 'culture', 'logistics', 'risk_probe', 'other',
] as const

/** Create one question manually. */
export const createInterviewQuestionSchema = z.object({
  text: z.string().trim().min(1, 'Текст вопроса обязателен').max(2000),
  category: z.enum(interviewQuestionCategories).default('other'),
  rationale: z.string().max(2000).nullish(),
  goodAnswer: z.string().max(2000).nullish(),
  displayOrder: z.number().int().min(0).default(0),
})

/** Update an existing question (all optional). Editing an AI question flips source→edited server-side. */
export const updateInterviewQuestionSchema = z.object({
  text: z.string().trim().min(1).max(2000).optional(),
  category: z.enum(interviewQuestionCategories).optional(),
  rationale: z.string().max(2000).nullish(),
  goodAnswer: z.string().max(2000).nullish(),
  displayOrder: z.number().int().min(0).optional(),
  isArchived: z.boolean().optional(),
})

/** Generate questions via AI. */
export const generateInterviewQuestionsSchema = z.object({
  promptText: z.string().max(4000).default(''),
  count: z.number().int().min(1).max(30).default(10),
  aiConfigId: z.string().min(1).nullable().optional(),
})

/** Save the generation prompt. */
export const savePromptSchema = z.object({
  promptText: z.string().max(4000).default(''),
})

/** Bulk reorder. */
export const reorderInterviewQuestionsSchema = z.object({
  order: z.array(z.object({
    id: z.string().min(1),
    displayOrder: z.number().int().min(0),
  })).min(1),
})

/** Route params. */
export const jobIdParamSchema = z.object({
  id: z.string().min(1),
})
export const questionIdParamSchema = z.object({
  id: z.string().min(1),
  questionId: z.string().min(1),
})
