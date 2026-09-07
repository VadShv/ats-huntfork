ALTER TABLE "application" ADD COLUMN IF NOT EXISTS "resume_version_id" text;--> statement-breakpoint
ALTER TABLE "candidate_resume_version" ADD COLUMN IF NOT EXISTS "document_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_resume_version_id_idx" ON "application" ("resume_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_resume_version_document_id_idx" ON "candidate_resume_version" ("document_id");
