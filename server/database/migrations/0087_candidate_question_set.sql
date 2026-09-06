DO $$ BEGIN
 CREATE TYPE "candidate_question_category" AS ENUM('hard_skill', 'soft_skill', 'experience', 'motivation', 'culture', 'logistics', 'risk_probe', 'verification', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "candidate_question_origin" AS ENUM('from_job_bank', 'risk_derived', 'manual');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "candidate_question_ask_status" AS ENUM('pending', 'asked', 'skipped');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "candidate_question_set_status" AS ENUM('draft', 'ready');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "application_question_set" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"application_id" text NOT NULL,
	"status" "candidate_question_set_status" DEFAULT 'ready' NOT NULL,
	"based_on_resume_risk_id" text,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "application_question_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"set_id" text NOT NULL,
	"text" text NOT NULL,
	"listen_for" text,
	"category" "candidate_question_category" DEFAULT 'other' NOT NULL,
	"origin" "candidate_question_origin" DEFAULT 'manual' NOT NULL,
	"source_ref" text,
	"rationale" text,
	"ask_status" "candidate_question_ask_status" DEFAULT 'pending' NOT NULL,
	"answer_note" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_question_set" ADD CONSTRAINT "application_question_set_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_question_set" ADD CONSTRAINT "application_question_set_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_question_set" ADD CONSTRAINT "application_question_set_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_question_item" ADD CONSTRAINT "application_question_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_question_item" ADD CONSTRAINT "application_question_item_set_id_application_question_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "application_question_set"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "application_question_set_application_id_unique" ON "application_question_set" ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_question_set_organization_id_idx" ON "application_question_set" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_question_item_set_id_idx" ON "application_question_item" ("set_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_question_item_organization_id_idx" ON "application_question_item" ("organization_id");
