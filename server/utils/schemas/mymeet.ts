import { z } from 'zod'

// ─────────────────────────────────────────────
// MyMeet integration validation schemas (Этап 5)
// ─────────────────────────────────────────────

export const connectMymeetSchema = z.object({
  apiKey: z.string().trim().min(10, 'Слишком короткий ключ').max(500),
})

export const interviewIdParamSchema = z.object({
  id: z.string().min(1),
})

export const importMeetingSchema = z.object({
  externalMeetingId: z.string().trim().min(1).max(300),
  title: z.string().max(500).optional(),
  sourceUrl: z.string().url().max(2000).optional(),
})
