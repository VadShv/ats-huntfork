import { z } from 'zod'

export const reportTemplateKinds = ['standard', 'executive', 'screening', 'technical', 'custom'] as const

export const createReportTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Название обязательно').max(120),
  description: z.string().max(4000).nullish(),
  kind: z.enum(reportTemplateKinds).default('standard'),
  promptText: z.string().trim().min(1).max(16000),
  preferredAiConfigId: z.string().min(1).nullish(),
})

export const updateReportTemplateSchema = createReportTemplateSchema.partial()

export const reportTemplateIdParamSchema = z.object({ id: z.string().min(1) })

export const toggleActiveSchema = z.object({ isActive: z.boolean() })

// ── Генерация отчёта по отклику ──
export const generateInterviewReportSchema = z.object({
  source: z.enum(['mymeet', 'assistant']),
  reportTemplateId: z.string().min(1).nullish(),
  interviewId: z.string().min(1).nullish(),
  externalMeetingId: z.string().min(1).nullish(),
  writeBackAnswers: z.boolean().default(true),
})

export const applicationIdParamSchema = z.object({ id: z.string().min(1) })
