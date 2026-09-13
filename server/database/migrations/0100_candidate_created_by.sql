-- §J: candidate.created_by_id — who added the candidate (manual create).
-- Used by scope 'assigned': a recruiter sees candidates they added OR who
-- applied to one of their jobs. NULL for hh.ru / public-form imports.
-- Additive + idempotent.

ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "created_by_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "candidate" ADD CONSTRAINT "candidate_created_by_id_user_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_created_by_idx" ON "candidate" ("organization_id", "created_by_id");
