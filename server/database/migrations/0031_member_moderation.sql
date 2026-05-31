-- Migration 0031: Add moderation fields to member table (Phase 1 — Sign-up Moderation)
-- Adds status, approvedBy, approvedAt, rejectedReason columns plus a composite index.
-- CRITICAL: backfill all existing rows to status='active' so no one is locked out.

ALTER TABLE "member"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "approved_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "approved_at" timestamp,
  ADD COLUMN IF NOT EXISTS "rejected_reason" text;

-- Backfill: every member row that existed before this migration must be 'active'.
-- The DEFAULT 'active' above already covers new rows; these UPDATEs make the
-- intent explicit and handle any edge-cases where the column was just added
-- and rows somehow got a different default.
UPDATE "member" SET "status" = 'active' WHERE "role" IN ('owner', 'admin');
UPDATE "member" SET "status" = 'active' WHERE "created_at" < NOW() - INTERVAL '1 second';

-- Index for fast pending-member queries per organization
CREATE INDEX IF NOT EXISTS "member_org_status_idx" ON "member" ("organization_id", "status");
