import { z } from 'zod'

// ── Методика CARE ──
const careElements = ['context', 'action', 'result', 'evaluate'] as const

const sufficiencyEntry = z.object({
  sufficientSignal: z.string().max(1000).default(''),
  evasionSignal: z.string().max(1000).default(''),
  minEvidence: z.number().int().min(0).max(10).optional(),
})

export const updateMethodologySchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(8000).nullish(),
  interviewerInstruction: z.string().max(8000).nullish(),
  sufficiencyCriteria: z.record(z.enum(careElements), sufficiencyEntry).optional(),
  probeLimitPerElement: z.number().int().min(1).max(10).optional(),
  probeLimitPerQuestion: z.number().int().min(1).max(30).optional(),
  changeNote: z.string().max(1000).nullish(),
})

// ── Промпты CARE ──
export const carePromptKinds = ['structure_question', 'personalize_questionnaire', 'generate_report'] as const

export const carePromptVariable = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).default(''),
  required: z.boolean().default(false),
  example: z.string().max(2000).optional(),
})

export const updateCarePromptSchema = z.object({
  promptText: z.string().trim().min(1).max(16000),
  variables: z.array(carePromptVariable).max(50).default([]),
  changeNote: z.string().max(1000).nullish(),
})

export const carePromptKindParamSchema = z.object({ kind: z.enum(carePromptKinds) })

// ── Триггеры ──
export const triggerSchema = z.object({
  id: z.string().min(1).optional(),
  trigger: z.string().trim().min(1).max(500),
  recommendedProbe: z.string().trim().min(1).max(500),
  careElement: z.enum(careElements).nullish(),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().min(0).default(0),
})

export const replaceTriggersSchema = z.object({
  triggers: z.array(triggerSchema).max(100),
})

// ── structure-care ──
export const structureCareSchema = z.object({
  scaleType: z.string().max(40).optional(),
  aiConfigId: z.string().min(1).nullable().optional(),
})

export const versionParamSchema = z.object({ version: z.coerce.number().int().min(1) })
