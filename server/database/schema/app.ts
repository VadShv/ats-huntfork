import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  numeric,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { organization, user } from './auth'

// ─────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────

export const jobStatusEnum = pgEnum('job_status', ['draft', 'open', 'closed', 'archived'])
export const jobTypeEnum = pgEnum('job_type', ['full_time', 'part_time', 'contract', 'internship'])
export const applicationStatusEnum = pgEnum('application_status', [
  'new', 'screening', 'interview', 'offer', 'hired', 'rejected',
])
export const documentTypeEnum = pgEnum('document_type', ['resume', 'cover_letter', 'other'])
export const questionTypeEnum = pgEnum('question_type', [
  'short_text', 'long_text', 'single_select', 'multi_select',
  'number', 'date', 'url', 'checkbox', 'file_upload',
])
export const propertyEntityTypeEnum = pgEnum('property_entity_type', ['candidate', 'application'])
export const propertyTypeEnum = pgEnum('property_type', [
  'text', 'long_text', 'number', 'select', 'multi_select',
  'date', 'checkbox', 'url', 'email', 'person', 'file',
])
export const genderEnum = pgEnum('gender', ['male', 'female', 'other', 'prefer_not_to_say'])
export const experienceLevelEnum = pgEnum('experience_level', ['junior', 'mid', 'senior', 'lead'])
export const nameDisplayFormatEnum = pgEnum('name_display_format', ['first_last', 'last_first'])
export const dateFormatEnum = pgEnum('date_format', ['mdy', 'dmy', 'ymd'])
export const pipelineStageTypeEnum = pgEnum('pipeline_stage_type', [
  'applied',     // entry point
  'screening',   // CV / phone screen
  'interview',   // any interview round
  'offer',       // offer extended
  'hired',       // success terminal
  'rejected',    // reject terminal
  'custom',      // anything else
])

// ─────────────────────────────────────────────
// ATS Domain Tables — ALL scoped by organizationId
// ─────────────────────────────────────────────

/**
 * Jobs / Positions within an organization.
 */
export const job = pgTable('job', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  location: text('location'),
  type: jobTypeEnum('type').notNull().default('full_time'),
  status: jobStatusEnum('status').notNull().default('draft'),
  // ── SEO / Rich Results fields ──
  salaryMin: integer('salary_min'),
  salaryMax: integer('salary_max'),
  salaryCurrency: text('salary_currency'),
  salaryUnit: text('salary_unit'),
  salaryNegotiable: boolean('salary_negotiable').notNull().default(false),
  remoteStatus: text('remote_status'),
  validThrough: timestamp('valid_through'),
  /** Experience level required for this role */
  experienceLevel: experienceLevelEnum('experience_level'),
  /** Optional pipeline assigned to this job. Null = use org default pipeline. */
  pipelineId: text('pipeline_id').references(() => pipeline.id, { onDelete: 'set null' }),
  // ── Application form settings ──
  requireResume: boolean('require_resume').notNull().default(false),
  requireCoverLetter: boolean('require_cover_letter').notNull().default(false),
  // ── AI scoring settings ──
  autoScoreOnApply: boolean('auto_score_on_apply').notNull().default(false),
  // ── Timestamps ──
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('job_organization_id_idx').on(t.organizationId),
]))

/**
 * Candidates (applicants) belonging to a specific tenant.
 */
export const candidate = pgTable('candidate', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  /** Optional display name override (e.g. for localized name ordering) */
  displayName: text('display_name'),
  email: text('email').notNull(),
  phone: text('phone'),
  /** Gender — stored as enum for structured filtering */
  gender: genderEnum('gender'),
  /** Date of birth — stored as text in ISO 8601 format (YYYY-MM-DD) to avoid timezone issues */
  dateOfBirth: text('date_of_birth'),
  /** Quick notes visible inline on the candidates list */
  quickNotes: text('quick_notes'),
  // ─── hh.ru resume snapshot ('бэкап резюме' — даже если кандидат удалил его на hh) ───
  /** Id резюме на hh.ru — последний пришедший для этого кандидата. */
  hhResumeId: text('hh_resume_id'),
  /** Сырой JSON-payload резюме с hh.ru. Используется для красивого рендера + PDF-экспорта. */
  hhResumeRaw: jsonb('hh_resume_raw').$type<Record<string, unknown> | null>(),
  /** Когда последний раз обновляли hh_resume_raw. */
  hhResumeFetchedAt: timestamp('hh_resume_fetched_at'),
  // ─── AI summary ───
  /** Короткое AI-саммари по кандидату (3-5 строк, plain text). */
  aiSummary: text('ai_summary'),
  /** Когда сгенерировано последнее ai_summary. */
  aiSummaryAt: timestamp('ai_summary_at'),
  // ─── Дедупликация ───
  /** active | merged — после мерджа ставится 'merged' и появляется merged_into_id. */
  mergeStatus: text('merge_status').notNull().default('active'),
  mergedIntoId: text('merged_into_id'),
  mergedAt: timestamp('merged_at'),
  /** True — «возможно повторный после отказа» (Д1), выводится предупреждение в UI. */
  fraudFlag: boolean('fraud_flag').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('candidate_organization_id_idx').on(t.organizationId),
  index('candidate_gender_idx').on(t.organizationId, t.gender),
  uniqueIndex('candidate_org_email_idx').on(t.organizationId, t.email),
  index('candidate_hh_resume_id_idx').on(t.organizationId, t.hhResumeId),
  index('candidate_merge_status_idx').on(t.organizationId, t.mergeStatus),
]))

/**
 * An application links a candidate to a job within the same organization.
 */
export const application = pgTable('application', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidate.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  status: applicationStatusEnum('status').notNull().default('new'),
  /** Current pipeline stage — null until assigned to a pipeline. Old enum status field kept for back-compat. */
  currentStageId: text('current_stage_id').references(() => pipelineStage.id, { onDelete: 'set null' }),
  /** Timestamp of last stage transition. */
  stageChangedAt: timestamp('stage_changed_at'),
  score: integer('score'),
  notes: text('notes'),
  coverLetterText: text('cover_letter_text'),
  /** Source of this application: 'manual' (created in UI), 'hh' (imported from hh.ru), 'api' (external API). */
  source: text('source').notNull().default('manual'),
  /** External identifier (e.g. hh.ru negotiation_id) for idempotent sync. */
  externalId: text('external_id'),
  /** Direct URL to the source (e.g. resume URL on hh.ru). */
  externalUrl: text('external_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('application_organization_id_idx').on(t.organizationId),
  index('application_candidate_id_idx').on(t.candidateId),
  index('application_job_id_idx').on(t.jobId),
  uniqueIndex('application_org_candidate_job_idx').on(t.organizationId, t.candidateId, t.jobId),
  index('application_source_idx').on(t.organizationId, t.source),
]))

// ─────────────────────────────────────────────
// Configurable Pipelines (Stage B1)
// ─────────────────────────────────────────────

/**
 * A recruiting pipeline template belonging to an organization.
 * System presets (isSystem=true) are seeded once per org and cannot be
 * edited or deleted — only cloned. Exactly one default per org is enforced
 * in application logic.
 */
export const pipeline = pgTable('pipeline', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  /** System preset cannot be edited or deleted; only cloned. Seeded once per org. */
  isSystem: boolean('is_system').notNull().default(false),
  /** Default pipeline for new jobs in this org. Exactly one default per org enforced in app logic. */
  isDefault: boolean('is_default').notNull().default(false),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('pipeline_organization_id_idx').on(t.organizationId),
  uniqueIndex('pipeline_org_name_idx').on(t.organizationId, t.name),
]))

/**
 * A single stage within a pipeline. Each pipeline has an ordered list of stages.
 * Terminal stages (isTerminal=true) represent final outcomes (hired/rejected).
 * Each pipeline must have ≥1 success-terminal and ≥1 reject-terminal (enforced in app logic).
 */
export const pipelineStage = pgTable('pipeline_stage', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  pipelineId: text('pipeline_id').notNull().references(() => pipeline.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  /** Hex color, auto-assigned by server based on type. e.g. '#10b981' */
  color: text('color').notNull(),
  type: pipelineStageTypeEnum('type').notNull().default('custom'),
  /** Order within pipeline. 0-based, gaps allowed (we reindex on save). */
  displayOrder: integer('display_order').notNull().default(0),
  /** True for hired/rejected stages. Validation: each pipeline must have >=1 success-terminal + >=1 reject-terminal. */
  isTerminal: boolean('is_terminal').notNull().default(false),
  /** When archived, hidden in new movements but existing applications stay. */
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('pipeline_stage_pipeline_id_idx').on(t.pipelineId),
  index('pipeline_stage_organization_id_idx').on(t.organizationId),
]))

/**
 * Audit trail for every stage transition of an application.
 * fromStageId is null for the initial placement into the pipeline.
 */
export const applicationStageHistory = pgTable('application_stage_history', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').notNull().references(() => application.id, { onDelete: 'cascade' }),
  fromStageId: text('from_stage_id').references(() => pipelineStage.id, { onDelete: 'set null' }),
  toStageId: text('to_stage_id').notNull().references(() => pipelineStage.id, { onDelete: 'cascade' }),
  movedByUserId: text('moved_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  comment: text('comment'),
  movedAt: timestamp('moved_at').notNull().defaultNow(),
}, (t) => ([
  index('application_stage_history_application_id_idx').on(t.applicationId),
  index('application_stage_history_organization_id_idx').on(t.organizationId),
]))

/**
 * Documents stored in MinIO (resumes, cover letters, etc.).
 * `storageKey` is the S3 object key in the bucket.
 * `parsedContent` holds the structured JSON output from PDF parsing.
 */
export const document = pgTable('document', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id').notNull().references(() => candidate.id, { onDelete: 'cascade' }),
  type: documentTypeEnum('type').notNull().default('resume'),
  storageKey: text('storage_key').notNull().unique(),
  originalFilename: text('original_filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes'),
  parsedContent: jsonb('parsed_content'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('document_organization_id_idx').on(t.organizationId),
  index('document_candidate_id_idx').on(t.candidateId),
]))

// ─────────────────────────────────────────────
// Custom Application Form Questions
// ─────────────────────────────────────────────

/**
 * Custom questions configured by the recruiter for a specific job.
 * These appear on the public application form alongside the standard fields.
 * `options` is only used for `single_select` and `multi_select` types.
 */
export const jobQuestion = pgTable('job_question', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  type: questionTypeEnum('type').notNull().default('short_text'),
  label: text('label').notNull(),
  description: text('description'),
  required: boolean('required').notNull().default(false),
  options: jsonb('options').$type<string[]>(),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('job_question_organization_id_idx').on(t.organizationId),
  index('job_question_job_id_idx').on(t.jobId),
]))

/**
 * Applicant responses to custom questions, stored per application.
 * `value` is stored as JSONB to support different response types
 * (string, string[], number, boolean).
 */
export const questionResponse = pgTable('question_response', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').notNull().references(() => application.id, { onDelete: 'cascade' }),
  questionId: text('question_id').notNull().references(() => jobQuestion.id, { onDelete: 'cascade' }),
  value: jsonb('value').$type<string | string[] | number | boolean>().notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('question_response_organization_id_idx').on(t.organizationId),
  index('question_response_application_id_idx').on(t.applicationId),
  index('question_response_question_id_idx').on(t.questionId),
]))

// ─────────────────────────────────────────────
// Custom Properties (Notion-style "database properties")
// ─────────────────────────────────────────────
//
// Two-table design:
//   - propertyDefinition: schema. Org-global when jobId IS NULL; per-job otherwise.
//                         entityType=candidate is always org-global (jobId must be NULL).
//                         entityType=application can be org-global OR per-job.
//   - propertyValue:      values, polymorphic to candidate.id or application.id.
//
// `value` is jsonb shaped by the property type:
//   text/long_text/url/email/person → string
//   number                          → number
//   select                          → string (one option id)
//   multi_select                    → string[] (option ids)
//   date                            → string (ISO YYYY-MM-DD)
//   checkbox                        → boolean
//   file                            → { documentId: string }
//
// `config` jsonb:
//   select / multi_select → { options: [{ id, label, color }] }
//   number                → { format?: 'plain' | 'percent' | 'currency', currency?: string }
//   others                → null
//
// Per-job overrides are NOT supported (additive only): per-job props are merged
// after org-global ones, ordered by displayOrder.

export const propertyDefinition = pgTable('property_definition', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  /** NULL = org-global. Non-null = per-job (only valid when entityType='application'). */
  jobId: text('job_id').references(() => job.id, { onDelete: 'cascade' }),
  entityType: propertyEntityTypeEnum('entity_type').notNull(),
  type: propertyTypeEnum('type').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  displayOrder: integer('display_order').notNull().default(0),
  config: jsonb('config').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('property_definition_org_idx').on(t.organizationId),
  index('property_definition_org_entity_idx').on(t.organizationId, t.entityType),
  index('property_definition_job_idx').on(t.jobId),
]))

export const propertyValue = pgTable('property_value', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  propertyDefinitionId: text('property_definition_id').notNull().references(() => propertyDefinition.id, { onDelete: 'cascade' }),
  entityType: propertyEntityTypeEnum('entity_type').notNull(),
  /** candidate.id when entityType='candidate', application.id when 'application' */
  entityId: text('entity_id').notNull(),
  value: jsonb('value'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('property_value_org_idx').on(t.organizationId),
  index('property_value_entity_idx').on(t.entityType, t.entityId),
  index('property_value_definition_idx').on(t.propertyDefinitionId),
  uniqueIndex('property_value_def_entity_idx').on(t.propertyDefinitionId, t.entityId),
]))

// ─────────────────────────────────────────────
// Organization Localization Settings
// ─────────────────────────────────────────────

/**
 * Per-organization localization preferences.
 * Controls how candidate names and dates are displayed across the app.
 * One row per organization — upserted on change.
 */
export const orgSettings = pgTable('org_settings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  /** Controls whether names display as "First Last" or "Last First" */
  nameDisplayFormat: nameDisplayFormatEnum('name_display_format').notNull().default('first_last'),
  /** Controls the date display format across the app */
  dateFormat: dateFormatEnum('date_format').notNull().default('dmy'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  uniqueIndex('org_settings_organization_id_idx').on(t.organizationId),
]))

// ─────────────────────────────────────────────
// Invite Links & Join Requests
// ─────────────────────────────────────────────

export const joinRequestStatusEnum = pgEnum('join_request_status', ['pending', 'approved', 'rejected'])

/**
 * Shareable invite links generated by org owners/admins.
 * Anyone with the link (and authenticated) can join at the specified role.
 * `token` is a cryptographic random hex string — NOT the primary key —
 * to prevent ID enumeration.
 */
export const inviteLink = pgTable('invite_link', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  createdById: text('created_by_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  role: text('role').notNull().default('member'),
  maxUses: integer('max_uses'),
  useCount: integer('use_count').notNull().default(0),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('invite_link_organization_id_idx').on(t.organizationId),
  index('invite_link_token_idx').on(t.token),
]))

/**
 * Join requests submitted by authenticated users wanting to join an org.
 * Only one pending request per user per org at a time (enforced in API).
 */
export const joinRequest = pgTable('join_request', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  message: text('message'),
  status: joinRequestStatusEnum('status').notNull().default('pending'),
  reviewedById: text('reviewed_by_id').references(() => user.id),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('join_request_organization_id_idx').on(t.organizationId),
  index('join_request_user_id_idx').on(t.userId),
  index('join_request_status_idx').on(t.status),
]))

// ─────────────────────────────────────────────
// Collaboration: Comments
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// Calendar Integrations
// ─────────────────────────────────────────────

export const calendarProviderEnum = pgEnum('calendar_provider', ['google'])

/**
 * Per-user calendar integration credentials.
 * Tokens are encrypted at rest with AES-256-GCM derived from BETTER_AUTH_SECRET.
 * Each user can connect one calendar provider. The `calendarId` is the target
 * calendar for interview events (defaults to 'primary').
 */
export const calendarIntegration = pgTable('calendar_integration', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  provider: calendarProviderEnum('provider').notNull().default('google'),
  /** AES-256-GCM encrypted Google OAuth2 access token */
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  /** AES-256-GCM encrypted Google OAuth2 refresh token */
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  /** Google Calendar ID to create events in (defaults to 'primary') */
  calendarId: text('calendar_id').notNull().default('primary'),
  /** Email address of the connected Google account */
  accountEmail: text('account_email'),
  /** Google push notification channel ID for two-way sync */
  webhookChannelId: text('webhook_channel_id'),
  /** Google push notification resource ID (needed for stop) */
  webhookResourceId: text('webhook_resource_id'),
  /** When the webhook channel expires (Google max = 7 days) */
  webhookExpiration: timestamp('webhook_expiration'),
  /** Incremental sync token from Google Calendar API */
  syncToken: text('sync_token'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  uniqueIndex('calendar_integration_user_provider_idx').on(t.userId, t.provider),
  index('calendar_integration_webhook_channel_idx').on(t.webhookChannelId),
]))

// ─────────────────────────────────────────────
// Interviews
// ─────────────────────────────────────────────

export const interviewTypeEnum = pgEnum('interview_type', [
  'phone', 'video', 'in_person', 'panel', 'technical', 'take_home',
])

export const interviewStatusEnum = pgEnum('interview_status', [
  'scheduled', 'completed', 'cancelled', 'no_show',
])

export const candidateResponseEnum = pgEnum('candidate_response', [
  'pending', 'accepted', 'declined', 'tentative',
])

/**
 * Interviews scheduled for applications in the pipeline.
 * Each interview is linked to an application (which contains candidate + job).
 * Multiple interviews can exist per application (e.g., phone screen → technical → panel).
 */
export const interview = pgTable('interview', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').notNull().references(() => application.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  type: interviewTypeEnum('type').notNull().default('video'),
  status: interviewStatusEnum('status').notNull().default('scheduled'),
  scheduledAt: timestamp('scheduled_at').notNull(),
  duration: integer('duration').notNull().default(60),
  location: text('location'),
  notes: text('notes'),
  interviewers: jsonb('interviewers').$type<string[]>(),
  createdById: text('created_by_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  invitationSentAt: timestamp('invitation_sent_at'),
  candidateResponse: candidateResponseEnum('candidate_response').notNull().default('pending'),
  candidateRespondedAt: timestamp('candidate_responded_at'),
  /** Google Calendar event ID for two-way sync (null = not synced) */
  googleCalendarEventId: text('google_calendar_event_id'),
  /** Direct link to the Google Calendar event (htmlLink from Google API) */
  googleCalendarEventLink: text('google_calendar_event_link'),
  /** IANA timezone for the scheduled time (e.g. 'America/New_York') */
  timezone: text('timezone').notNull().default('UTC'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('interview_organization_id_idx').on(t.organizationId),
  index('interview_application_id_idx').on(t.applicationId),
  index('interview_scheduled_at_idx').on(t.scheduledAt),
  index('interview_status_idx').on(t.status),
  index('interview_created_by_id_idx').on(t.createdById),
]))

// ─────────────────────────────────────────────
// Email Templates
// ─────────────────────────────────────────────

/**
 * Reusable email templates for interview invitations.
 * Each org can create custom templates or use the system defaults.
 * Template body supports placeholder variables like {{candidateName}}, {{jobTitle}}, etc.
 */
export const emailTemplate = pgTable('email_template', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  createdById: text('created_by_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('email_template_organization_id_idx').on(t.organizationId),
  index('email_template_created_by_id_idx').on(t.createdById),
]))

export const commentTargetEnum = pgEnum('comment_target', ['candidate', 'application', 'job'])

/**
 * Internal comments left by team members on candidates, applications, or jobs.
 * Scoped by organizationId for tenant isolation.
 */
export const comment = pgTable('comment', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  targetType: commentTargetEnum('target_type').notNull(),
  targetId: text('target_id').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('comment_organization_id_idx').on(t.organizationId),
  index('comment_target_idx').on(t.targetType, t.targetId),
  index('comment_author_id_idx').on(t.authorId),
]))

// ─────────────────────────────────────────────
// Collaboration: Activity Log
// ─────────────────────────────────────────────

export const activityActionEnum = pgEnum('activity_action', [
  'created', 'updated', 'deleted', 'status_changed',
  'comment_added', 'member_invited', 'member_removed', 'member_role_changed',
  'scored', 'stage_changed',
])

// ─────────────────────────────────────────────
// AI Scoring Enums
// ─────────────────────────────────────────────

export const criterionCategoryEnum = pgEnum('criterion_category', [
  'technical', 'experience', 'soft_skills', 'education', 'culture', 'custom',
])

export const analysisRunStatusEnum = pgEnum('analysis_run_status', [
  'completed', 'failed', 'partial',
])

/**
 * Immutable audit trail for all significant actions within an organization.
 * Append-only — no UPDATE or DELETE allowed via the API.
 */
export const activityLog = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  action: activityActionEnum('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('activity_log_organization_id_idx').on(t.organizationId),
  index('activity_log_actor_id_idx').on(t.actorId),
  index('activity_log_resource_idx').on(t.resourceType, t.resourceId),
  index('activity_log_created_at_idx').on(t.createdAt),
]))

// ─────────────────────────────────────────────
// Source Tracking
// ─────────────────────────────────────────────

/**
 * Well-known source identifiers for major job boards and channels.
 * `custom` allows organizations to create their own named sources.
 */
export const sourceChannelEnum = pgEnum('source_channel', [
  'linkedin', 'indeed', 'glassdoor', 'ziprecruiter', 'monster',
  'handshake', 'angellist', 'wellfound', 'dice', 'stackoverflow',
  'weworkremotely', 'remoteok', 'builtin', 'hired', 'lever',
  'greenhouse_board', 'google_jobs', 'facebook', 'twitter', 'instagram',
  'tiktok', 'reddit', 'referral', 'career_site', 'email',
  'event', 'agency', 'direct', 'other', 'custom',
])

/**
 * Tracking links generated by recruiters to attribute candidate sources.
 * Each link produces a unique campaign code appended as `?ref=CODE` to the
 * public job page or global careers page. When a candidate applies through
 * a tracked link, the application records the source.
 */
export const trackingLink = pgTable('tracking_link', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  /** Optional — links may be org-wide (null) or scoped to a single job */
  jobId: text('job_id').references(() => job.id, { onDelete: 'cascade' }),
  /** Canonical source channel */
  channel: sourceChannelEnum('channel').notNull().default('custom'),
  /** Human-readable label, e.g. "LinkedIn Spring Campaign" */
  name: text('name').notNull(),
  /** Unique short code used in ?ref=CODE — generated from crypto */
  code: text('code').notNull().unique(),
  /** Standard UTM parameters captured for external analytics */
  utmSource: text('utm_source'),
  utmMedium: text('utm_medium'),
  utmCampaign: text('utm_campaign'),
  utmTerm: text('utm_term'),
  utmContent: text('utm_content'),
  /** Aggregate counters (incremented on each click/application) */
  clickCount: integer('click_count').notNull().default(0),
  applicationCount: integer('application_count').notNull().default(0),
  /** Soft-disabled — deactivated links stop incrementing counts */
  isActive: boolean('is_active').notNull().default(true),
  createdById: text('created_by_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('tracking_link_organization_id_idx').on(t.organizationId),
  index('tracking_link_job_id_idx').on(t.jobId),
  index('tracking_link_code_idx').on(t.code),
  index('tracking_link_channel_idx').on(t.channel),
]))

/**
 * Per-application source attribution — records HOW a candidate discovered
 * and applied to a job. One row per application. Populated at apply time
 * from ?ref=, ?utm_*, or Referer header.
 */
export const applicationSource = pgTable('application_source', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').notNull().references(() => application.id, { onDelete: 'cascade' }),
  /** Resolved channel — normalized from tracking link, UTM, or Referer */
  channel: sourceChannelEnum('channel').notNull().default('direct'),
  /** FK to tracking_link if the application came via a tracked link */
  trackingLinkId: text('tracking_link_id').references(() => trackingLink.id, { onDelete: 'set null' }),
  /** Raw UTM query params captured from the application URL */
  utmSource: text('utm_source'),
  utmMedium: text('utm_medium'),
  utmCampaign: text('utm_campaign'),
  utmTerm: text('utm_term'),
  utmContent: text('utm_content'),
  /** Cleaned Referer header (domain only — no path/query for privacy) */
  referrerDomain: text('referrer_domain'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('application_source_organization_id_idx').on(t.organizationId),
  index('application_source_application_id_idx').on(t.applicationId),
  index('application_source_channel_idx').on(t.channel),
  index('application_source_tracking_link_id_idx').on(t.trackingLinkId),
  uniqueIndex('application_source_application_idx').on(t.applicationId),
]))

// ─────────────────────────────────────────────
// AI Configuration & Scoring Tables
// ─────────────────────────────────────────────

/**
 * Per-organization AI provider configuration.
 * API keys are encrypted at rest using AES-256-GCM (same as calendar tokens).
 * Each org can configure their own provider, model, and API key.
 */
export const aiConfig = pgTable('ai_config', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  /** Friendly display name shown in the picker (e.g. "GPT-4o (production)"). */
  name: text('name').notNull().default('Default'),
  provider: text('provider').notNull().default('openai'),
  model: text('model').notNull().default('gpt-4o-mini'),
  /** AES-256-GCM encrypted API key — NEVER returned to client */
  apiKeyEncrypted: text('api_key_encrypted').notNull(),
  /** Optional base URL override (e.g. for Ollama or custom endpoints) */
  baseUrl: text('base_url'),
  maxTokens: integer('max_tokens').notNull().default(4096),
  /** Price per 1M input tokens in USD (e.g. "2.50") */
  inputPricePer1m: numeric('input_price_per_1m', { precision: 10, scale: 4 }),
  /** Price per 1M output tokens in USD (e.g. "10.00") */
  outputPricePer1m: numeric('output_price_per_1m', { precision: 10, scale: 4 }),
  /** When true, this configuration is used by the chatbot when no per-conversation override is set. At most one row per org. */
  isDefaultChatbot: boolean('is_default_chatbot').notNull().default(false),
  /** When true, this configuration is used for applicant analysis (manual + auto). At most one row per org. */
  isDefaultAnalysis: boolean('is_default_analysis').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('ai_config_organization_id_idx').on(t.organizationId),
  // Partial unique indexes enforce at most one default per purpose per org.
  uniqueIndex('ai_config_default_chatbot_idx').on(t.organizationId).where(sql`${t.isDefaultChatbot} = true`),
  uniqueIndex('ai_config_default_analysis_idx').on(t.organizationId).where(sql`${t.isDefaultAnalysis} = true`),
]))

/**
 * Per-job scoring criteria. Each criterion defines one dimension of evaluation.
 * Weights are user-adjustable via sliders and used to compute weighted composite scores.
 */
export const scoringCriterion = pgTable('scoring_criterion', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  category: criterionCategoryEnum('category').notNull().default('custom'),
  maxScore: integer('max_score').notNull().default(10),
  /** Weight from 0–100, used by sliders. Default 50 = neutral. */
  weight: integer('weight').notNull().default(50),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('scoring_criterion_organization_id_idx').on(t.organizationId),
  index('scoring_criterion_job_id_idx').on(t.jobId),
  uniqueIndex('scoring_criterion_job_key_idx').on(t.jobId, t.key),
]))

/**
 * Individual criterion scores computed by AI for each application.
 * Stores the raw AI output including evidence and confidence.
 */
export const criterionScore = pgTable('criterion_score', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').notNull().references(() => application.id, { onDelete: 'cascade' }),
  criterionKey: text('criterion_key').notNull(),
  maxScore: integer('max_score').notNull(),
  applicantScore: integer('applicant_score').notNull(),
  /** Confidence from 0 to 100 (%). */
  confidence: integer('confidence').notNull(),
  evidence: text('evidence').notNull(),
  strengths: jsonb('strengths').$type<string[]>(),
  gaps: jsonb('gaps').$type<string[]>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('criterion_score_organization_id_idx').on(t.organizationId),
  index('criterion_score_application_id_idx').on(t.applicationId),
  uniqueIndex('criterion_score_app_criterion_idx').on(t.applicationId, t.criterionKey),
]))

/**
 * Audit trail for each AI scoring run. Captures the rubric snapshot,
 * model used, token usage, and the raw LLM response for debugging.
 */
export const analysisRun = pgTable('analysis_run', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').notNull().references(() => application.id, { onDelete: 'cascade' }),
  status: analysisRunStatusEnum('status').notNull().default('completed'),
  /** Provider + model used for this run */
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  /** Snapshot of criteria at score time for audit trail */
  criteriaSnapshot: jsonb('criteria_snapshot').$type<Record<string, unknown>[]>(),
  /** Composite weighted score (0–100) */
  compositeScore: integer('composite_score'),
  /** Token usage for cost tracking */
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  /** Raw LLM response for debugging (sanitized — no PII stored) */
  rawResponse: jsonb('raw_response'),
  errorMessage: text('error_message'),
  scoredById: text('scored_by_id').references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('analysis_run_organization_id_idx').on(t.organizationId),
  index('analysis_run_application_id_idx').on(t.applicationId),
  index('analysis_run_created_at_idx').on(t.createdAt),
]))

// ─────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────

export const jobRelations = relations(job, ({ one, many }) => ({
  organization: one(organization, { fields: [job.organizationId], references: [organization.id] }),
  applications: many(application),
  questions: many(jobQuestion),
  scoringCriteria: many(scoringCriterion),
  trackingLinks: many(trackingLink),
  pipeline: one(pipeline, { fields: [job.pipelineId], references: [pipeline.id] }),
}))

export const candidateRelations = relations(candidate, ({ one, many }) => ({
  organization: one(organization, { fields: [candidate.organizationId], references: [organization.id] }),
  applications: many(application),
  documents: many(document),
}))

export const applicationRelations = relations(application, ({ one, many }) => ({
  organization: one(organization, { fields: [application.organizationId], references: [organization.id] }),
  candidate: one(candidate, { fields: [application.candidateId], references: [candidate.id] }),
  job: one(job, { fields: [application.jobId], references: [job.id] }),
  responses: many(questionResponse),
  interviews: many(interview),
  criterionScores: many(criterionScore),
  analysisRuns: many(analysisRun),
  source: one(applicationSource),
  currentStage: one(pipelineStage, { fields: [application.currentStageId], references: [pipelineStage.id] }),
  stageHistory: many(applicationStageHistory),
}))

export const documentRelations = relations(document, ({ one }) => ({
  organization: one(organization, { fields: [document.organizationId], references: [organization.id] }),
  candidate: one(candidate, { fields: [document.candidateId], references: [candidate.id] }),
}))

export const jobQuestionRelations = relations(jobQuestion, ({ one }) => ({
  organization: one(organization, { fields: [jobQuestion.organizationId], references: [organization.id] }),
  job: one(job, { fields: [jobQuestion.jobId], references: [job.id] }),
}))

export const questionResponseRelations = relations(questionResponse, ({ one }) => ({
  organization: one(organization, { fields: [questionResponse.organizationId], references: [organization.id] }),
  application: one(application, { fields: [questionResponse.applicationId], references: [application.id] }),
  question: one(jobQuestion, { fields: [questionResponse.questionId], references: [jobQuestion.id] }),
}))

export const propertyDefinitionRelations = relations(propertyDefinition, ({ one, many }) => ({
  organization: one(organization, { fields: [propertyDefinition.organizationId], references: [organization.id] }),
  job: one(job, { fields: [propertyDefinition.jobId], references: [job.id] }),
  values: many(propertyValue),
}))

export const propertyValueRelations = relations(propertyValue, ({ one }) => ({
  organization: one(organization, { fields: [propertyValue.organizationId], references: [organization.id] }),
  definition: one(propertyDefinition, { fields: [propertyValue.propertyDefinitionId], references: [propertyDefinition.id] }),
}))

export const commentRelations = relations(comment, ({ one }) => ({
  organization: one(organization, { fields: [comment.organizationId], references: [organization.id] }),
  author: one(user, { fields: [comment.authorId], references: [user.id] }),
}))

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  organization: one(organization, { fields: [activityLog.organizationId], references: [organization.id] }),
  actor: one(user, { fields: [activityLog.actorId], references: [user.id] }),
}))

export const inviteLinkRelations = relations(inviteLink, ({ one }) => ({
  organization: one(organization, { fields: [inviteLink.organizationId], references: [organization.id] }),
  createdBy: one(user, { fields: [inviteLink.createdById], references: [user.id] }),
}))

export const joinRequestRelations = relations(joinRequest, ({ one }) => ({
  user: one(user, { fields: [joinRequest.userId], references: [user.id] }),
  organization: one(organization, { fields: [joinRequest.organizationId], references: [organization.id] }),
  reviewedBy: one(user, { fields: [joinRequest.reviewedById], references: [user.id] }),
}))

export const interviewRelations = relations(interview, ({ one }) => ({
  organization: one(organization, { fields: [interview.organizationId], references: [organization.id] }),
  application: one(application, { fields: [interview.applicationId], references: [application.id] }),
  createdBy: one(user, { fields: [interview.createdById], references: [user.id] }),
}))

export const emailTemplateRelations = relations(emailTemplate, ({ one }) => ({
  organization: one(organization, { fields: [emailTemplate.organizationId], references: [organization.id] }),
  createdBy: one(user, { fields: [emailTemplate.createdById], references: [user.id] }),
}))

export const calendarIntegrationRelations = relations(calendarIntegration, ({ one }) => ({
  user: one(user, { fields: [calendarIntegration.userId], references: [user.id] }),
}))

// ─── AI Scoring Relations ──────────────────────────────────────────

export const aiConfigRelations = relations(aiConfig, ({ one }) => ({
  organization: one(organization, { fields: [aiConfig.organizationId], references: [organization.id] }),
}))

export const scoringCriterionRelations = relations(scoringCriterion, ({ one }) => ({
  organization: one(organization, { fields: [scoringCriterion.organizationId], references: [organization.id] }),
  job: one(job, { fields: [scoringCriterion.jobId], references: [job.id] }),
}))

export const criterionScoreRelations = relations(criterionScore, ({ one }) => ({
  organization: one(organization, { fields: [criterionScore.organizationId], references: [organization.id] }),
  application: one(application, { fields: [criterionScore.applicationId], references: [application.id] }),
}))

export const analysisRunRelations = relations(analysisRun, ({ one }) => ({
  organization: one(organization, { fields: [analysisRun.organizationId], references: [organization.id] }),
  application: one(application, { fields: [analysisRun.applicationId], references: [application.id] }),
  scoredBy: one(user, { fields: [analysisRun.scoredById], references: [user.id] }),
}))

// ─── Source Tracking Relations ─────────────────────────────────────

export const trackingLinkRelations = relations(trackingLink, ({ one, many }) => ({
  organization: one(organization, { fields: [trackingLink.organizationId], references: [organization.id] }),
  job: one(job, { fields: [trackingLink.jobId], references: [job.id] }),
  createdBy: one(user, { fields: [trackingLink.createdById], references: [user.id] }),
  applicationSources: many(applicationSource),
}))

export const applicationSourceRelations = relations(applicationSource, ({ one }) => ({
  organization: one(organization, { fields: [applicationSource.organizationId], references: [organization.id] }),
  application: one(application, { fields: [applicationSource.applicationId], references: [application.id] }),
  trackingLink: one(trackingLink, { fields: [applicationSource.trackingLinkId], references: [trackingLink.id] }),
}))

export const orgSettingsRelations = relations(orgSettings, ({ one }) => ({
  organization: one(organization, { fields: [orgSettings.organizationId], references: [organization.id] }),
}))

// ─────────────────────────────────────────────
// Chatbot — per-user persisted state
// ─────────────────────────────────────────────
// Conversations, folders and custom AI agents are PRIVATE to the creating user
// (scoped by both organizationId AND userId). The chatbot itself runs against
// org-wide data via tool calls, but the chat history and user preferences
// (custom system prompts, folder organisation) never leak between users.

export const chatbotMessageRoleEnum = pgEnum('chatbot_message_role', ['user', 'assistant'])

/**
 * Custom AI agents — user-defined personas with their own system prompt.
 * Each user manages their own private list. isDefault marks the one that
 * gets pre-selected when starting a new conversation.
 */
export const chatbotAgent = pgTable('chatbot_agent', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Short description shown next to the name in the picker. */
  description: text('description'),
  /** Lucide icon name (e.g. 'Sparkles'). Optional; UI falls back to a default. */
  icon: text('icon'),
  /** The custom system prompt appended/replacing the base assistant prompt. */
  systemPrompt: text('system_prompt').notNull(),
  /** Default temperature override (0..2). Null → use server default. */
  temperature: numeric('temperature', { precision: 3, scale: 2 }),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('chatbot_agent_org_user_idx').on(t.organizationId, t.userId),
  // Enforce single default agent per (org, user) at the DB layer to backstop
  // the application-level clear-then-set logic against concurrent requests.
  uniqueIndex('chatbot_agent_default_per_user_idx')
    .on(t.organizationId, t.userId)
    .where(sql`${t.isDefault} = true`),
]))

/**
 * Folders for organising conversations in the sidebar. Per-user.
 */
export const chatbotFolder = pgTable('chatbot_folder', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Lucide icon name. Optional. */
  icon: text('icon'),
  /** Manual sort order, ascending. */
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('chatbot_folder_org_user_idx').on(t.organizationId, t.userId),
]))

/**
 * A persisted chatbot conversation. Belongs to a user, optionally filed under
 * a folder, optionally bound to a specific custom agent.
 */
export const chatbotConversation = pgTable('chatbot_conversation', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  folderId: text('folder_id').references(() => chatbotFolder.id, { onDelete: 'set null' }),
  agentId: text('agent_id').references(() => chatbotAgent.id, { onDelete: 'set null' }),
  /** AI configuration last used for this conversation. Falls back to org chatbot default. */
  aiConfigId: text('ai_config_id').references(() => aiConfig.id, { onDelete: 'set null' }),
  /** Human-friendly title. Auto-generated from the first user message if absent. */
  title: text('title').notNull().default('New chat'),
  /** Scope at the time of last message: { kind: 'organization' } or { kind: 'job', jobId } */
  scope: jsonb('scope').notNull().$type<{ kind: 'organization' | 'job'; jobId?: string }>(),
  /** Whether extended thinking was enabled for the most recent turn. */
  thinking: boolean('thinking').notNull().default(false),
  /** Pinned to the top of the sidebar list. */
  pinned: boolean('pinned').notNull().default(false),
  /** Cached preview of last message — avoids loading messages just for the list. */
  lastMessagePreview: text('last_message_preview'),
  lastMessageAt: timestamp('last_message_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('chatbot_conversation_org_user_idx').on(t.organizationId, t.userId),
  index('chatbot_conversation_folder_idx').on(t.folderId),
  index('chatbot_conversation_last_message_at_idx').on(t.userId, t.lastMessageAt),
]))

/**
 * Persisted message belonging to a conversation. We mirror the wire shape of
 * ChatbotMessage but normalize a few server-side fields (toolCalls, sources).
 */
export const chatbotMessage = pgTable('chatbot_message', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId: text('conversation_id').notNull().references(() => chatbotConversation.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: chatbotMessageRoleEnum('role').notNull(),
  content: text('content').notNull().default(''),
  reasoning: text('reasoning'),
  /** Persisted ChatbotToolCall[]. */
  toolCalls: jsonb('tool_calls').$type<unknown[]>(),
  /** Persisted ChatbotSource[] (jobs / candidates / applications referenced). */
  sources: jsonb('sources').$type<unknown[]>(),
  /** Attachment metadata snapshots (no raw file content). */
  attachments: jsonb('attachments').$type<unknown[]>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('chatbot_message_conversation_idx').on(t.conversationId, t.createdAt),
]))

export const chatbotAgentRelations = relations(chatbotAgent, ({ many }) => ({
  conversations: many(chatbotConversation),
}))

export const chatbotFolderRelations = relations(chatbotFolder, ({ many }) => ({
  conversations: many(chatbotConversation),
}))

export const chatbotConversationRelations = relations(chatbotConversation, ({ one, many }) => ({
  organization: one(organization, { fields: [chatbotConversation.organizationId], references: [organization.id] }),
  user: one(user, { fields: [chatbotConversation.userId], references: [user.id] }),
  folder: one(chatbotFolder, { fields: [chatbotConversation.folderId], references: [chatbotFolder.id] }),
  agent: one(chatbotAgent, { fields: [chatbotConversation.agentId], references: [chatbotAgent.id] }),
  aiConfig: one(aiConfig, { fields: [chatbotConversation.aiConfigId], references: [aiConfig.id] }),
  messages: many(chatbotMessage),
}))

export const chatbotMessageRelations = relations(chatbotMessage, ({ one }) => ({
  conversation: one(chatbotConversation, { fields: [chatbotMessage.conversationId], references: [chatbotConversation.id] }),
}))

// ─── Pipeline Relations ─────────────────────────────────────────────────

export const pipelineRelations = relations(pipeline, ({ one, many }) => ({
  organization: one(organization, { fields: [pipeline.organizationId], references: [organization.id] }),
  stages: many(pipelineStage),
  jobs: many(job),
}))

export const pipelineStageRelations = relations(pipelineStage, ({ one, many }) => ({
  organization: one(organization, { fields: [pipelineStage.organizationId], references: [organization.id] }),
  pipeline: one(pipeline, { fields: [pipelineStage.pipelineId], references: [pipeline.id] }),
  applications: many(application),
  stageHistoryFrom: many(applicationStageHistory, { relationName: 'fromStage' }),
  stageHistoryTo: many(applicationStageHistory, { relationName: 'toStage' }),
}))

export const applicationStageHistoryRelations = relations(applicationStageHistory, ({ one }) => ({
  organization: one(organization, { fields: [applicationStageHistory.organizationId], references: [organization.id] }),
  application: one(application, { fields: [applicationStageHistory.applicationId], references: [application.id] }),
  fromStage: one(pipelineStage, { fields: [applicationStageHistory.fromStageId], references: [pipelineStage.id], relationName: 'fromStage' }),
  toStage: one(pipelineStage, { fields: [applicationStageHistory.toStageId], references: [pipelineStage.id], relationName: 'toStage' }),
  movedByUser: one(user, { fields: [applicationStageHistory.movedByUserId], references: [user.id] }),
}))

// ─────────────────────────────────────────────
// Huntfork × hh.ru integration (Stage 5)
// ─────────────────────────────────────────────

/**
 * Stores the hh.ru OAuth tokens for a single recruiter within an organization.
 * Tokens are AES-256-GCM encrypted at rest using BETTER_AUTH_SECRET as the
 * key source — see server/utils/crypto.ts.
 */
export const hhAccount = pgTable('hh_account', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  // Identifiers returned by hh.ru GET /me
  hhUserId: text('hh_user_id').notNull(),
  hhEmployerId: text('hh_employer_id'),
  hhManagerId: text('hh_manager_id'),
  hhEmail: text('hh_email'),
  hhFirstName: text('hh_first_name'),
  hhLastName: text('hh_last_name'),
  // Encrypted tokens (base64-encoded ciphertext + iv + tag)
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  refreshTokenEncrypted: text('refresh_token_encrypted').notNull(),
  accessTokenExpiresAt: timestamp('access_token_expires_at').notNull(),
  scope: text('scope'),
  connectedAt: timestamp('connected_at').notNull().defaultNow(),
  lastRefreshedAt: timestamp('last_refreshed_at'),
  lastError: text('last_error'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('hh_account_org_idx').on(t.organizationId),
  uniqueIndex('hh_account_org_user_idx').on(t.organizationId, t.userId),
  index('hh_account_hh_user_idx').on(t.hhUserId),
]))

/**
 * Links a Huntfork job to a specific hh.ru vacancy.
 * A job can have at most one hh link (enforced in app logic);
 * a single hh vacancy can be linked only once per organization.
 */
export const hhVacancyLink = pgTable('hh_vacancy_link', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  hhAccountId: text('hh_account_id').notNull().references(() => hhAccount.id, { onDelete: 'cascade' }),
  hhVacancyId: text('hh_vacancy_id').notNull(),
  hhVacancyUrl: text('hh_vacancy_url'),
  hhVacancyTitle: text('hh_vacancy_title'),
  lastSyncAt: timestamp('last_sync_at'),
  lastSyncStatus: text('last_sync_status'),
  lastSyncError: text('last_sync_error'),
  autoSyncEnabled: boolean('auto_sync_enabled').notNull().default(true),
  importedCount: integer('imported_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('hh_vacancy_link_org_idx').on(t.organizationId),
  index('hh_vacancy_link_job_idx').on(t.jobId),
  uniqueIndex('hh_vacancy_link_org_hh_vacancy_idx').on(t.organizationId, t.hhVacancyId),
]))

/**
 * Tracks an individual отклик (negotiation) imported from hh.ru.
 * One-to-one with application: each imported negotiation creates or updates
 * a single application row. Raw JSON snapshots are kept for re-scoring.
 */
export const hhNegotiation = pgTable('hh_negotiation', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  hhVacancyLinkId: text('hh_vacancy_link_id').notNull().references(() => hhVacancyLink.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').references(() => application.id, { onDelete: 'set null' }),
  hhNegotiationId: text('hh_negotiation_id').notNull(),
  hhResumeId: text('hh_resume_id'),
  hhCollection: text('hh_collection'),
  hhState: text('hh_state'),
  hhCreatedAt: timestamp('hh_created_at'),
  hhUpdatedAt: timestamp('hh_updated_at'),
  rawResumeJson: jsonb('raw_resume_json'),
  rawNegotiationJson: jsonb('raw_negotiation_json'),
  importedAt: timestamp('imported_at').notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ([
  index('hh_negotiation_org_idx').on(t.organizationId),
  index('hh_negotiation_link_idx').on(t.hhVacancyLinkId),
  index('hh_negotiation_application_idx').on(t.applicationId),
  uniqueIndex('hh_negotiation_org_hhid_idx').on(t.organizationId, t.hhNegotiationId),
]))

// Relations for ergonomics in queries
export const hhAccountRelations = relations(hhAccount, ({ one, many }) => ({
  organization: one(organization, { fields: [hhAccount.organizationId], references: [organization.id] }),
  user: one(user, { fields: [hhAccount.userId], references: [user.id] }),
  vacancyLinks: many(hhVacancyLink),
}))

export const hhVacancyLinkRelations = relations(hhVacancyLink, ({ one, many }) => ({
  organization: one(organization, { fields: [hhVacancyLink.organizationId], references: [organization.id] }),
  job: one(job, { fields: [hhVacancyLink.jobId], references: [job.id] }),
  hhAccount: one(hhAccount, { fields: [hhVacancyLink.hhAccountId], references: [hhAccount.id] }),
  negotiations: many(hhNegotiation),
}))

export const hhNegotiationRelations = relations(hhNegotiation, ({ one }) => ({
  organization: one(organization, { fields: [hhNegotiation.organizationId], references: [organization.id] }),
  vacancyLink: one(hhVacancyLink, { fields: [hhNegotiation.hhVacancyLinkId], references: [hhVacancyLink.id] }),
  application: one(application, { fields: [hhNegotiation.applicationId], references: [application.id] }),
}))

// ─────────────────────────────────────────────
// Дедупликация — фундамент
// ─────────────────────────────────────────────

/**
 * Группа компаний (например, «Astra Group»).
 * Внутри одной группы кандидаты считаются общими и проверяются на дубли.
 * Несколько organizations (юрлиц) могут принадлежать одной группе.
 */
export const organizationGroup = pgTable('organization_group', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  /** oldest | most_complete | manual — стратегия выбора primary при автомердже */
  mergeStrategy: text('merge_strategy').notNull().default('oldest'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

/**
 * Идентификатор кандидата (email / phone / hh_owner / linkedin / telegram / manual_external).
 * Используется как «мульти-ключ» для дедупликации:
 *   при импорте новой записи ищем по нормализованному value в рамках group_id —
 *   если нашли существующего кандидата, переиспользуем его вместо создания дубля.
 */
export const candidateIdentity = pgTable('candidate_identity', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  candidateId: text('candidate_id').notNull().references(() => candidate.id, { onDelete: 'cascade' }),
  /** group_id — основной ключ дедупликации (cross-org внутри группы). */
  groupId: text('group_id').references(() => organizationGroup.id, { onDelete: 'set null' }),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  /** email | phone | hh_owner | hh_resume | linkedin | telegram | manual_external */
  kind: text('kind').notNull(),
  /** Как пришло (для отображения в UI). */
  valueRaw: text('value_raw').notNull(),
  /** Нормализованный ключ — по нему идёт поиск. */
  valueNormalized: text('value_normalized').notNull(),
  /** verified | claimed | inferred */
  confidence: text('confidence').notNull().default('claimed'),
  /** hh | telegram | manual | csv | career_form | import */
  source: text('source').notNull(),
  firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('candidate_identity_candidate_id_idx').on(t.candidateId),
  index('candidate_identity_org_id_idx').on(t.organizationId),
  index('candidate_identity_group_lookup_idx').on(t.groupId, t.kind, t.valueNormalized),
]))

/**
 * Журнал слияний — аудит и поддержка rollback в течение rollback_until.
 * merged_candidate_id хранится как text (не FK), чтобы запись сохранялась
 * и после физического удаления записи кандидата.
 */
export const candidateMergeLog = pgTable('candidate_merge_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  groupId: text('group_id').references(() => organizationGroup.id, { onDelete: 'set null' }),
  primaryCandidateId: text('primary_candidate_id').notNull().references(() => candidate.id, { onDelete: 'cascade' }),
  mergedCandidateId: text('merged_candidate_id').notNull(),
  performedByUserId: text('performed_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  /** merge | rollback */
  action: text('action').notNull(),
  /** auto | manual */
  mergeKind: text('merge_kind').notNull(),
  reason: text('reason'),
  /** Список сигналов, по которым решили мерджить: [{kind, value, score}] */
  signals: jsonb('signals').$type<Array<{ kind: string; value: string; score?: number }>>().notNull().default(sql`'[]'::jsonb`),
  score: integer('score'),
  /** Снимок обоих кандидатов до слияния (для rollback). */
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  /** До какого момента возможен rollback через UI. */
  rollbackUntil: timestamp('rollback_until'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ([
  index('candidate_merge_log_primary_idx').on(t.primaryCandidateId),
  index('candidate_merge_log_merged_idx').on(t.mergedCandidateId),
  index('candidate_merge_log_org_idx').on(t.organizationId, t.createdAt),
]))

export const candidateIdentityRelations = relations(candidateIdentity, ({ one }) => ({
  candidate: one(candidate, { fields: [candidateIdentity.candidateId], references: [candidate.id] }),
  organization: one(organization, { fields: [candidateIdentity.organizationId], references: [organization.id] }),
  group: one(organizationGroup, { fields: [candidateIdentity.groupId], references: [organizationGroup.id] }),
}))

export const candidateMergeLogRelations = relations(candidateMergeLog, ({ one }) => ({
  organization: one(organization, { fields: [candidateMergeLog.organizationId], references: [organization.id] }),
  primaryCandidate: one(candidate, { fields: [candidateMergeLog.primaryCandidateId], references: [candidate.id] }),
  performedByUser: one(user, { fields: [candidateMergeLog.performedByUserId], references: [user.id] }),
}))
