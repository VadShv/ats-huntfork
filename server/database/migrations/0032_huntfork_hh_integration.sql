-- Migration 0032: Huntfork × hh.ru integration (Stage 5 — Phase 1)
-- Adds tables for storing hh.ru OAuth tokens per recruiter, linking
-- our jobs to hh vacancies, and tracking imported negotiations (отклики).
--
-- Design principles:
-- 1. We do NOT introduce a separate "candidate from hh" model — imported
--    отклики become regular `application` rows. Link to the hh side lives
--    in `hh_negotiation`, so existing scoring/pipeline/UI keep working.
-- 2. Tokens are encrypted at rest (AES-256-GCM via BETTER_AUTH_SECRET).
--    We still store expiry/refresh in plaintext columns to allow scheduled
--    refresh without decryption on every check.
-- 3. All FKs are CASCADE to organization so deleting a tenant cleans up
--    its hh-side state too.

-- ─────────────────────────────────────────────
-- hh_account: one row per recruiter who connected hh.ru via OAuth.
-- A user may have at most one active hh account per organization.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "hh_account" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  -- hh.ru identifiers returned by GET /me
  "hh_user_id" text NOT NULL,
  "hh_employer_id" text,
  "hh_manager_id" text,
  "hh_email" text,
  "hh_first_name" text,
  "hh_last_name" text,
  -- Encrypted tokens (AES-256-GCM, base64-encoded)
  "access_token_encrypted" text NOT NULL,
  "refresh_token_encrypted" text NOT NULL,
  "access_token_expires_at" timestamp NOT NULL,
  -- Connection metadata
  "scope" text,
  "connected_at" timestamp NOT NULL DEFAULT NOW(),
  "last_refreshed_at" timestamp,
  "last_error" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT NOW(),
  "updated_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "hh_account_org_idx" ON "hh_account" ("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "hh_account_org_user_idx" ON "hh_account" ("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "hh_account_hh_user_idx" ON "hh_account" ("hh_user_id");

-- ─────────────────────────────────────────────
-- hh_vacancy_link: which of our jobs is mirrored from which hh vacancy.
-- Decoupled from `job` so we can support multi-source jobs later.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "hh_vacancy_link" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "job_id" text NOT NULL REFERENCES "job"("id") ON DELETE CASCADE,
  "hh_account_id" text NOT NULL REFERENCES "hh_account"("id") ON DELETE CASCADE,
  -- hh vacancy reference
  "hh_vacancy_id" text NOT NULL,
  "hh_vacancy_url" text,
  "hh_vacancy_title" text,
  -- Sync state
  "last_sync_at" timestamp,
  "last_sync_status" text,         -- 'ok' | 'error'
  "last_sync_error" text,
  "auto_sync_enabled" boolean NOT NULL DEFAULT true,
  -- Counters (denormalized for UI; updated by sync worker)
  "imported_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT NOW(),
  "updated_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "hh_vacancy_link_org_idx" ON "hh_vacancy_link" ("organization_id");
CREATE INDEX IF NOT EXISTS "hh_vacancy_link_job_idx" ON "hh_vacancy_link" ("job_id");
CREATE UNIQUE INDEX IF NOT EXISTS "hh_vacancy_link_org_hh_vacancy_idx" ON "hh_vacancy_link" ("organization_id", "hh_vacancy_id");

-- ─────────────────────────────────────────────
-- hh_negotiation: one row per imported отклик.
-- Tracks idempotency (we never re-import the same negotiation) and
-- links to our application/candidate.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "hh_negotiation" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "hh_vacancy_link_id" text NOT NULL REFERENCES "hh_vacancy_link"("id") ON DELETE CASCADE,
  "application_id" text REFERENCES "application"("id") ON DELETE SET NULL,
  -- hh.ru side
  "hh_negotiation_id" text NOT NULL,
  "hh_resume_id" text,
  "hh_collection" text,              -- response | invitation | discard | etc
  "hh_state" text,
  "hh_created_at" timestamp,
  "hh_updated_at" timestamp,
  -- Raw JSON snapshot of the resume at import time (for re-scoring later)
  "raw_resume_json" jsonb,
  "raw_negotiation_json" jsonb,
  -- Import metadata
  "imported_at" timestamp NOT NULL DEFAULT NOW(),
  "last_seen_at" timestamp NOT NULL DEFAULT NOW(),
  "updated_at" timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "hh_negotiation_org_idx" ON "hh_negotiation" ("organization_id");
CREATE INDEX IF NOT EXISTS "hh_negotiation_link_idx" ON "hh_negotiation" ("hh_vacancy_link_id");
CREATE INDEX IF NOT EXISTS "hh_negotiation_application_idx" ON "hh_negotiation" ("application_id");
CREATE UNIQUE INDEX IF NOT EXISTS "hh_negotiation_org_hhid_idx" ON "hh_negotiation" ("organization_id", "hh_negotiation_id");

-- ─────────────────────────────────────────────
-- application: mark which applications came from external source.
-- Lightweight columns; full hh details live in hh_negotiation.
-- ─────────────────────────────────────────────
ALTER TABLE "application"
  ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "external_id" text,
  ADD COLUMN IF NOT EXISTS "external_url" text;

CREATE INDEX IF NOT EXISTS "application_source_idx" ON "application" ("organization_id", "source");
