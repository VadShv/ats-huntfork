import { z } from 'zod'

// ─────────────────────────────────────────────
// Org Банк вопросов — Zod-схемы (Спринт 1)
// docs/tz-questions-01-org-bank.md · имена enum — cross-cutting §7a/§7c
// ─────────────────────────────────────────────

export const assessmentTopicTypes = [
  'value', 'soft_skill', 'management', 'professional', 'motivation', 'expectations',
  'factcheck', 'achievement_scale', 'career_logic', 'risk_zone', 'culture', 'custom',
] as const

export const topicStatuses = ['draft', 'active', 'archived'] as const

export const scaleTypes = [
  'numeric_5', 'numeric_4', 'numeric_3', 'match_3', 'verify_3', 'level_5', 'custom',
] as const

export const bankQuestionTypes = [
  'behavioral', 'situational', 'motivational', 'factual', 'verification',
  'reflective', 'professional', 'control', 'ai_personal',
] as const

export const bankQuestionStatuses = ['draft', 'published', 'archived'] as const

export const interviewStages = [
  'screening', 'recruiter', 'hiring_manager', 'final', 'expert', 'full_cycle',
] as const

export const bankQuestionComplexities = ['low', 'medium', 'high'] as const

const strArray = z.array(z.string().trim().min(1).max(500)).max(50).default([])

// ── Темы ───────────────────────────────────────
export const createTopicSchema = z.object({
  name: z.string().trim().min(1, 'Название темы обязательно').max(120),
  shortName: z.string().trim().max(24).nullish(),
  type: z.enum(assessmentTopicTypes).default('custom'),
  definition: z.string().max(4000).nullish(),
  goal: z.string().max(2000).nullish(),
  positiveIndicators: strArray,
  negativeIndicators: strArray,
  parentTopicId: z.string().min(1).nullish(),
  targetRoles: strArray,
  tags: strArray,
  displayOrder: z.number().int().min(0).default(0),
})

export const updateTopicSchema = createTopicSchema.partial().extend({
  status: z.enum(topicStatuses).optional(),
})

// ── Шкалы ──────────────────────────────────────
export const createScaleSchema = z.object({
  name: z.string().trim().min(1, 'Название шкалы обязательно').max(120),
  type: z.enum(scaleTypes).default('numeric_5'),
  minValue: z.number().int().nullish(),
  maxValue: z.number().int().nullish(),
  allowInsufficientData: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  displayOrder: z.number().int().min(0).default(0),
})

export const updateScaleSchema = createScaleSchema.partial()

// ── BARS-якоря (bulk) ──────────────────────────
export const anchorSchema = z.object({
  value: z.string().trim().min(1).max(40),
  anchorText: z.string().trim().min(1, 'Текст якоря обязателен').max(2000),
  positiveExamples: strArray,
  negativeExamples: strArray,
  displayOrder: z.number().int().min(0).default(0),
})

export const replaceAnchorsSchema = z.object({
  anchors: z.array(anchorSchema).max(20),
})

// ── Вопросы банка ──────────────────────────────
export const createBankQuestionSchema = z.object({
  primaryTopicId: z.string().min(1, 'Тема обязательна'),
  type: z.enum(bankQuestionTypes).default('behavioral'),
  text: z.string().trim().min(1, 'Текст вопроса обязателен').max(600),
  goal: z.string().max(2000).nullish(),
  assesses: z.string().max(2000).nullish(),
  recommendedStage: z.enum(interviewStages).nullish(),
  expectedSignal: z.string().max(2000).nullish(),
  strongIndicators: strArray,
  weakIndicators: strArray,
  durationMin: z.number().int().min(0).max(240).nullish(),
  complexity: z.enum(bankQuestionComplexities).nullish(),
  secondaryTopicIds: z.array(z.string().min(1)).max(20).default([]),
  scaleIdOverride: z.string().min(1).nullish(),
  targetRoles: strArray,
  tags: strArray,
})

export const updateBankQuestionSchema = createBankQuestionSchema.partial()

// ── AI-генерация вопросов темы ─────────────────
export const generateBankQuestionsSchema = z.object({
  topicId: z.string().min(1, 'Тема обязательна'),
  count: z.number().int().min(1).max(30).default(10),
  extraInstruction: z.string().max(2000).default(''),
  aiConfigId: z.string().min(1).nullable().optional(),
})

// ── Route params ───────────────────────────────
export const topicIdParamSchema = z.object({ topicId: z.string().min(1) })
export const scaleIdParamSchema = z.object({ scaleId: z.string().min(1) })
export const bankQuestionIdParamSchema = z.object({ id: z.string().min(1) })

export type CreateTopicInput = z.infer<typeof createTopicSchema>
export type CreateBankQuestionInput = z.infer<typeof createBankQuestionSchema>
