DO $$ BEGIN
 CREATE TYPE "risk_run_status" AS ENUM('running', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "risk_level" AS ENUM('low', 'medium', 'high');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resume_risk" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"resume_version_id" text NOT NULL,
	"status" "risk_run_status" DEFAULT 'running' NOT NULL,
	"overall_risk" "risk_level" DEFAULT 'low' NOT NULL,
	"overall_score" integer DEFAULT 0 NOT NULL,
	"is_capped" boolean DEFAULT false NOT NULL,
	"summary" text,
	"tenure_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"findings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metrics_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider" text,
	"model" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"error_message" text,
	"content_hash" text,
	"assessed_at" timestamp,
	"triggered_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"short_stint_months" integer DEFAULT 12 NOT NULL,
	"job_hopping_medium_score" integer DEFAULT 40 NOT NULL,
	"job_hopping_high_score" integer DEFAULT 65 NOT NULL,
	"cap_linguistic_to_medium" boolean DEFAULT true NOT NULL,
	"extra_instructions" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_risk" ADD CONSTRAINT "resume_risk_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_risk" ADD CONSTRAINT "resume_risk_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "candidate"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- NB: candidate_resume_version.id is uuid on the deployed DB while resume_risk.resume_version_id
-- is text (matches the Drizzle schema, which models that id as text). Types are incompatible for a
-- FK, so referential integrity is enforced in application code (worker + endpoints verify
-- version ∈ candidate ∈ org). We add an index instead of a FK constraint.
CREATE INDEX IF NOT EXISTS "resume_risk_resume_version_id_idx" ON "resume_risk" ("resume_version_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_risk" ADD CONSTRAINT "resume_risk_triggered_by_id_user_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_policy" ADD CONSTRAINT "risk_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resume_risk_resume_version_id_unique" ON "resume_risk" ("resume_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resume_risk_candidate_id_idx" ON "resume_risk" ("candidate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resume_risk_organization_id_idx" ON "resume_risk" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "risk_policy_organization_id_unique" ON "risk_policy" ("organization_id");
