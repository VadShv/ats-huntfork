import { z } from 'zod'

// ─────────────────────────────────────────────
// Candidate validation schemas — shared across API routes
// ─────────────────────────────────────────────

const genderValues = ['male', 'female', 'other', 'prefer_not_to_say'] as const

/** ISO 8601 date string (YYYY-MM-DD), validated to be a real date in a reasonable range */
const dobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format')
  .refine((val) => {
    const d = new Date(val)
    if (isNaN(d.getTime())) return false
    const year = d.getFullYear()
    const now = new Date()
    return year >= 1900 && d <= now
  }, 'Date of birth must be a valid past date')

/** Schema for creating a new candidate */
export const createCandidateSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  displayName: z.string().max(200).optional(),
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address')
    .max(255)
    .transform((v) => v.toLowerCase().trim()),
  phone: z.string().max(50).optional(),
  gender: z.enum(genderValues).optional(),
  dateOfBirth: dobSchema.optional(),
  quickNotes: z.string().max(1000).optional(),
  /** Sprint 3.3 (P2.2): явный город для более точного fuzzy-дедупа. */
  city: z.string().max(100).optional(),
  /** Sprint 3.4 (P2.3): соцсети — используются как identity-сигналы в дедупе. */
  linkedin: z.string().max(255).optional(),
  telegram: z.string().max(100).optional(),
  github: z.string().max(100).optional(),
  /**
   * `force=true` «пробивает» fuzzy-блок (высоковероятный дубль) — recruiter явно подтвердил в модалке.
   * НИКОГДА не обходит жёсткий exact-match по email/phone — там всегда 409.
   */
  force: z.boolean().optional(),
})

/** Schema for updating an existing candidate (all fields optional) */
export const updateCandidateSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100).optional(),
  lastName: z.string().min(1, 'Last name is required').max(100).optional(),
  displayName: z.string().max(200).nullish(),
  email: z
    .string()
    .email('Invalid email address')
    .max(255)
    .transform((v) => v.toLowerCase().trim())
    .optional(),
  phone: z.string().max(50).nullish(),
  gender: z.enum(genderValues).nullish(),
  dateOfBirth: dobSchema.nullish(),
  quickNotes: z.string().max(1000).nullish(),
  /** Sprint 3.3 (P2.2): явный город. */
  city: z.string().max(100).nullish(),
  /** Sprint 3.4 (P2.3): соцсети. */
  linkedin: z.string().max(255).nullish(),
  telegram: z.string().max(100).nullish(),
  github: z.string().max(100).nullish(),
  /** VIP-флаг: к этому кандидату никогда не применяются авто-правила (всё вручную). */
  manualReviewOnly: z.boolean().optional(),
})

/** Schema for candidate list query params */
export const candidateQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Legacy ILIKE-поиск по ФИО/email — оставлен для обратной совместимости */
  search: z.string().trim().max(200).optional(),
  /** Sprint 1A: full-text поиск по search_tsv (websearch_to_tsquery). При наличии перебивает search. */
  q: z.string().trim().max(500).optional(),
  /**
   * Sprint 2 hotfix: scope полнотекстового поиска — ограничивает совпадения по weight-классам tsvector.
   *  - all     → A+B+C+D (default, текущее поведение)
   *  - labels  → только A (имя/email/телефон/labels кастомных меток)
   *  - notes   → только B (aiSummary, quickNotes, city)
   *  - resume  → только C+D (hh_resume_raw + parsed document text)
   * Игнорируется если q пуст.
   */
  scope: z.enum(['all', 'labels', 'notes', 'resume']).optional().default('all'),
  gender: z.enum(genderValues).optional(),
  dobFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dobFrom must be YYYY-MM-DD').optional(),
  dobTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dobTo must be YYYY-MM-DD').optional(),
  /** JSON-encoded array of { propertyDefinitionId, op, value } filters */
  propertyFilters: z.string().optional(),
})

/** Reusable schema for `:id` route params */
export const candidateIdParamSchema = z.object({
  id: z.string().min(1),
})
