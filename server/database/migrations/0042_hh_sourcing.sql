-- ───────────────────────────────────────────────────────────────────────────
-- 0042 — HH sourcing (Joon-like): saved searches, sourcing candidates,
-- action log, stage mapping.
--
-- Adds the cold-sourcing pipeline on top of the existing hh_account /
-- hh_vacancy_link / hh_negotiation tables.
-- ───────────────────────────────────────────────────────────────────────────

-- Saved search configuration. One search ↔ one job, but the same job may
-- have multiple parallel searches (e.g. "Москва", "Питер", "удалёнка").
CREATE TABLE IF NOT EXISTS "hh_saved_search" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "job_id" text NOT NULL REFERENCES "job"("id") ON DELETE CASCADE,
  "hh_account_id" text NOT NULL REFERENCES "hh_account"("id") ON DELETE CASCADE,
  "created_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "name" text NOT NULL,
  -- Free-form hh.ru /resumes query parameters (text, area[], experience,
  -- salary_from/to, employment[], schedule[], educational_level, relocation,
  -- order_by, period, label[] etc.). Validated against hh API at runtime.
  "query" jsonb NOT NULL,
  -- Original hh.ru search URL the recruiter pasted (if any). Useful for audit
  -- and "re-import from hh" later.
  "source_url" text,
  -- Auto-run cadence in minutes. NULL = manual only. Default 1440 (=24h).
  "schedule_minutes" integer,
  "auto_run_enabled" boolean NOT NULL DEFAULT true,
  -- How many pages of /resumes (50/page) to fetch per run. Soft cap.
  "max_pages_per_run" integer NOT NULL DEFAULT 10,
  -- Last-run telemetry (purely informational).
  "last_run_at" timestamp,
  "last_run_status" text,
  "last_run_error" text,
  "last_run_found" integer NOT NULL DEFAULT 0,
  "last_run_new" integer NOT NULL DEFAULT 0,
  "next_run_at" timestamp,
  "is_archived" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hh_saved_search_org_idx" ON "hh_saved_search" ("organization_id");
CREATE INDEX IF NOT EXISTS "hh_saved_search_job_idx" ON "hh_saved_search" ("job_id");
CREATE INDEX IF NOT EXISTS "hh_saved_search_next_run_idx" ON "hh_saved_search" ("next_run_at") WHERE auto_run_enabled = true AND is_archived = false;

-- ───────────────────────────────────────────────────────────────────────────
-- One row per (search × hh_resume). Deduplicated; multiple searches surfacing
-- the same resume each get their own row (different score / rationale).
-- We do NOT store contact info — only the anonymised snapshot needed for the
-- recruiter to make a decision. Contacts are fetched live from hh.ru when
-- the recruiter clicks "Open contact".
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "hh_sourcing_candidate" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "saved_search_id" text NOT NULL REFERENCES "hh_saved_search"("id") ON DELETE CASCADE,
  "job_id" text NOT NULL REFERENCES "job"("id") ON DELETE CASCADE,
  "hh_resume_id" text NOT NULL,
  -- Anonymised snapshot (title, area, salary, experience years, last position).
  -- NO email/phone/full name.
  "snapshot" jsonb NOT NULL,
  -- AI scoring (reuses the existing YandexGPT criterion engine).
  "score" integer,
  "score_rationale" text,
  "score_strengths" jsonb,
  "score_gaps" jsonb,
  -- Lifecycle: new → reviewed → approved → imported (became application)
  --                       → rejected
  --                       → contacted (recruiter opened contacts on hh — quota spent)
  "state" text NOT NULL DEFAULT 'new',
  -- Set once recruiter actions it.
  "reviewed_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp,
  "review_note" text,
  -- Link to the application row once "imported into pipeline".
  "application_id" text REFERENCES "application"("id") ON DELETE SET NULL,
  "first_seen_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hh_sourcing_candidate_org_idx" ON "hh_sourcing_candidate" ("organization_id");
CREATE INDEX IF NOT EXISTS "hh_sourcing_candidate_search_idx" ON "hh_sourcing_candidate" ("saved_search_id");
CREATE INDEX IF NOT EXISTS "hh_sourcing_candidate_job_idx" ON "hh_sourcing_candidate" ("job_id");
CREATE INDEX IF NOT EXISTS "hh_sourcing_candidate_state_idx" ON "hh_sourcing_candidate" ("state");
-- Same resume may appear in multiple searches, but only once per search.
CREATE UNIQUE INDEX IF NOT EXISTS "hh_sourcing_candidate_search_resume_idx" ON "hh_sourcing_candidate" ("saved_search_id", "hh_resume_id");

-- ───────────────────────────────────────────────────────────────────────────
-- Mapping of internal pipeline stages → hh.ru negotiation collections.
-- When a recruiter moves an application across stages, we look up this
-- table to decide whether to push a status change to hh.ru.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "hh_stage_mapping" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  -- Mapping is per hh_vacancy_link so different vacancies can use different
  -- hh collection IDs (they're per-vacancy on hh's side).
  "hh_vacancy_link_id" text NOT NULL REFERENCES "hh_vacancy_link"("id") ON DELETE CASCADE,
  "pipeline_stage_id" text NOT NULL REFERENCES "pipeline_stage"("id") ON DELETE CASCADE,
  -- The hh negotiation collection / state to push to. e.g. "phone_interview",
  -- "discard_by_employer", or a collection id discovered via GET /negotiations.
  "hh_collection" text NOT NULL,
  -- Optional message template to send when transitioning here (e.g. an
  -- offer letter or polite rejection).
  "message_template" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hh_stage_mapping_org_idx" ON "hh_stage_mapping" ("organization_id");
CREATE INDEX IF NOT EXISTS "hh_stage_mapping_link_idx" ON "hh_stage_mapping" ("hh_vacancy_link_id");
CREATE UNIQUE INDEX IF NOT EXISTS "hh_stage_mapping_link_stage_idx" ON "hh_stage_mapping" ("hh_vacancy_link_id", "pipeline_stage_id");

-- ───────────────────────────────────────────────────────────────────────────
-- Audit log of all push-actions to hh.ru. Idempotent: a duplicate
-- (negotiation_id, action_type, target_collection) within 60s is a no-op.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "hh_action_log" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "hh_account_id" text NOT NULL REFERENCES "hh_account"("id") ON DELETE CASCADE,
  -- One of: stage_change, send_message, open_contact, import_sourcing.
  "action_type" text NOT NULL,
  "negotiation_id" text,
  "hh_resume_id" text,
  "target_collection" text,
  "request_payload" jsonb,
  "response_status" integer,
  "response_body" jsonb,
  "error" text,
  "performed_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "application_id" text REFERENCES "application"("id") ON DELETE SET NULL,
  "sourcing_candidate_id" text REFERENCES "hh_sourcing_candidate"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hh_action_log_org_idx" ON "hh_action_log" ("organization_id");
CREATE INDEX IF NOT EXISTS "hh_action_log_negotiation_idx" ON "hh_action_log" ("negotiation_id");
CREATE INDEX IF NOT EXISTS "hh_action_log_app_idx" ON "hh_action_log" ("application_id");
CREATE INDEX IF NOT EXISTS "hh_action_log_created_idx" ON "hh_action_log" ("created_at");
