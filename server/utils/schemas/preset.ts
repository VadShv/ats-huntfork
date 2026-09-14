import { z } from 'zod'
import { interviewStages } from './bankQuestion'

// ── Пресеты (org) ──
export const createPresetSchema = z.object({
  name: z.string().trim().min(1, 'Название пресета обязательно').max(120),
  description: z.string().max(4000).nullish(),
  interviewType: z.enum(interviewStages).default('full_cycle'),
  targetRoles: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  seniority: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
})

export const updatePresetSchema = createPresetSchema.partial().extend({
  isDefault: z.boolean().optional(),
})

export const createSectionSchema = z.object({
  topicId: z.string().min(1, 'Тема обязательна'),
  title: z.string().trim().min(1).max(200),
  goal: z.string().max(2000).nullish(),
  weight: z.number().int().min(0).max(100).default(50),
  minQuestions: z.number().int().min(0).max(50).default(0),
  maxQuestions: z.number().int().min(0).max(50).default(0),
  displayOrder: z.number().int().min(0).default(0),
})
export const updateSectionSchema = createSectionSchema.partial()

export const setSectionQuestionsSchema = z.object({
  questions: z.array(z.object({
    bankQuestionId: z.string().min(1),
    isRequired: z.boolean().default(false),
    displayOrder: z.number().int().min(0).default(0),
  })).max(100),
})

// ── Вакансия: импорт / добавление / синхронизация ──
export const importPresetSchema = z.object({
  presetId: z.string().min(1),
  replace: z.boolean().default(false),
  adapt: z.boolean().default(false),
  aiConfigId: z.string().min(1).nullable().optional(),
})

export const addFromBankSchema = z.object({
  bankQuestionIds: z.array(z.string().min(1)).min(1).max(100),
  criterionId: z.string().min(1).nullish(),
})

export const linkCriterionSchema = z.object({
  criterionId: z.string().min(1).nullable(),
})

const syncField = z.enum(['text', 'rationale', 'goodAnswer', 'category'])
export const syncUpdatesSchema = z.object({
  accept: z.array(z.object({
    questionId: z.string().min(1),
    fields: z.array(syncField).min(1),
  })).max(200).default([]),
  keepLocal: z.array(z.object({
    questionId: z.string().min(1),
  })).max(200).default([]),
})

export const presetIdParamSchema = z.object({ presetId: z.string().min(1) })
export const sectionIdParamSchema = z.object({ presetId: z.string().min(1), sectionId: z.string().min(1) })
