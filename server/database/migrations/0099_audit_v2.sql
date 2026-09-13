-- RBAC v2 §7 — audit v2: extend activity_log + hash-chain + immutability trigger.

ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "actor_email" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "before" jsonb;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "after" jsonb;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "ip" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "user_agent" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "decision" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "policy_reason" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "risk_level" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "field_set" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "prev_hash" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN IF NOT EXISTS "entry_hash" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_log_risk_idx" ON "activity_log" ("risk_level");--> statement-breakpoint

-- New activity_action enum values (autocommit; ADD VALUE cannot run in a txn).
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'role_created';--> statement-breakpoint
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'role_updated';--> statement-breakpoint
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'role_deleted';--> statement-breakpoint
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'member_scope_changed';--> statement-breakpoint
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'member_override_set';--> statement-breakpoint
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'member_suspended';--> statement-breakpoint
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'member_revoked';--> statement-breakpoint
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'contacts_viewed';--> statement-breakpoint
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'resume_downloaded';--> statement-breakpoint
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'list_exported';--> statement-breakpoint
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'bulk_action';--> statement-breakpoint
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'view_as_started';--> statement-breakpoint
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'permission_denied';--> statement-breakpoint
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'login';--> statement-breakpoint
ALTER TYPE "activity_action" ADD VALUE IF NOT EXISTS 'logout';--> statement-breakpoint

-- Immutability: block UPDATE on activity_log even for the table owner (REVOKE
-- doesn't bind the owner; a trigger does). Tampering = modifying existing
-- entries → forbidden. Row DELETE is intentionally NOT trigger-blocked so that
-- `organization` ON DELETE CASCADE still works; any out-of-band deletion is
-- detected by the hash-chain (a missing link breaks verification).
CREATE OR REPLACE FUNCTION "activity_log_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activity_log is append-only (immutable audit trail)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "activity_log_no_update" ON "activity_log";--> statement-breakpoint
CREATE TRIGGER "activity_log_no_update" BEFORE UPDATE ON "activity_log"
  FOR EACH ROW EXECUTE FUNCTION "activity_log_immutable"();
