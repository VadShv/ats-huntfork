DO $$ BEGIN
 CREATE TYPE "interview_question_category" AS ENUM('hard_skill', 'soft_skill', 'experience', 'motivation', 'culture', 'logistics', 'risk_probe', 'other');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "interview_question_source" AS ENUM('ai_generated', 'manual', 'edited');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_interview_question" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text NOT NULL,
	"text" text NOT NULL,
	"category" "interview_question_category" DEFAULT 'other' NOT NULL,
	"rationale" text,
	"good_answer" text,
	"source" "interview_question_source" DEFAULT 'manual' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_question_prompt" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text NOT NULL,
	"prompt_text" text DEFAULT '' NOT NULL,
	"last_generated_at" timestamp,
	"last_provider" text,
	"last_model" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_interview_question" ADD CONSTRAINT "job_interview_question_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_interview_question" ADD CONSTRAINT "job_interview_question_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_interview_question" ADD CONSTRAINT "job_interview_question_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_question_prompt" ADD CONSTRAINT "job_question_prompt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_question_prompt" ADD CONSTRAINT "job_question_prompt_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_interview_question_organization_id_idx" ON "job_interview_question" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_interview_question_job_id_idx" ON "job_interview_question" ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_question_prompt_job_id_unique" ON "job_question_prompt" ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_question_prompt_organization_id_idx" ON "job_question_prompt" ("organization_id");
