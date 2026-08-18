import { z } from 'zod'

export { APPLICATION_STATUS_TRANSITIONS } from '~~/shared/status-transitions'

// ─────────────────────────────────────────────
// Application validation schemas — shared across API routes
// ─────────────────────────────────────────────

/** Schema for creating a new application (recruiter links candidate → job) */
export const createApplicationSchema = z.object({
  candidateId: z.string().min(1, 'Candidate is required'),
  jobId: z.string().min(1, 'Job is required'),
  notes: z.string().max(5000).optional(),
})

/** Schema for updating an existing application (status transitions, notes, score) */
export const updateApplicationSchema = z.object({
  status: z.enum(['new', 'screening', 'interview', 'offer', 'hired', 'rejected']).optional(),
  notes: z.string().max(5000).nullish(),
  score: z.number().int().min(0).max(100).nullish(),
})

/** Schema for application list query params */
export const applicationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(20),
  jobId: z.string().min(1).optional(),
  candidateId: z.string().min(1).optional(),
  status: z.enum(['new', 'screening', 'interview', 'offer', 'hired', 'rejected']).optional(),
  /** JSON-encoded array of { propertyDefinitionId, op, value } filters */
  propertyFilters: z.string().optional(),
  /**
   * Filter by exact pipeline stage id (currentStageId = stageId).
   * Takes precedence over stageType when both are supplied.
   */
  stageId: z.string().min(1).optional(),
  /**
   * Фаза 1 (этап-центричные фильтры): мультиселект корневых этапов —
   * comma-separated список stage id. Каждый id автоматически захватывает
   * свои подэтапы. Имеет приоритет над stageId и stageType.
   */
  stageIds: z.string().min(1).max(4000).optional(),
  /**
   * Filter by stage type — matches all stages across all pipelines whose
   * `type` column equals this value (e.g. 'interview').
   * Ignored when stageId is present.
   */
  stageType: z.string().min(1).optional(),
  /** Отображать только заявки, требующие ручной проверки (AI не уверен в отказе). */
  needsManualReview: z.coerce.boolean().optional(),
  /**
   * Sprint 1B: full-text поиск по кандидату (связанному через candidateId).
   * Используется websearch_to_tsquery('simple', q) по candidate.search_tsv ПЛЮС ILIKE по job.title
   * (поиск по названию вакансии — отдельный столбец без tsv).
   * Max 500 chars — защита от huge regex DOS.
   */
  q: z.string().trim().max(500).optional(),
})

/** Reusable schema for `:id` route params */
export const applicationIdParamSchema = z.object({
  id: z.string().min(1),
})

// Status transition rules are now in shared/status-transitions.ts
// and re-exported above for backward compatibility.
