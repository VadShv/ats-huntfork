-- Модуль вопросов — Спринт 5: MyMeet-связка + отчёты по интервью.
-- Таблица report_template. Расширения meeting_report (поток Б) +
-- application_question_item (write-back метки). Enum report_template_kind,
-- report_source, answer_confidence; meeting_report_status += generating.
-- Аддитивно + идемпотентно (runner: autocommit). docs/tz-questions-05-mymeet-reports.md

ALTER TYPE "meeting_report_status" ADD VALUE IF NOT EXISTS 'generating';--> statement-breakpoint

DO $$ BEGIN
 CREATE TYPE "report_template_kind" AS ENUM('standard', 'executive', 'screening', 'technical', 'custom');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "report_source" AS ENUM('mymeet', 'assistant');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "answer_confidence" AS ENUM('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "report_template" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" "report_template_kind" DEFAULT 'standard' NOT NULL,
	"prompt_text" text NOT NULL,
	"preferred_ai_config_id" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "report_template" ADD CONSTRAINT "report_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_template" ADD CONSTRAINT "report_template_preferred_ai_config_id_ai_config_id_fk" FOREIGN KEY ("preferred_ai_config_id") REFERENCES "ai_config"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_template" ADD CONSTRAINT "report_template_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "report_template" ADD CONSTRAINT "report_template_updated_by_id_user_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "report_template_org_idx" ON "report_template" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_template_org_active_idx" ON "report_template" ("organization_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "report_template_org_default_unique" ON "report_template" ("organization_id") WHERE "is_default" AND "is_active";--> statement-breakpoint

-- meeting_report: поток Б + телеметрия.
ALTER TABLE "meeting_report" ADD COLUMN IF NOT EXISTS "source" "report_source" DEFAULT 'mymeet' NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_report" ADD COLUMN IF NOT EXISTS "report_template_id" text;--> statement-breakpoint
ALTER TABLE "meeting_report" ADD COLUMN IF NOT EXISTS "template_version" integer;--> statement-breakpoint
ALTER TABLE "meeting_report" ADD COLUMN IF NOT EXISTS "template_name" text;--> statement-breakpoint
ALTER TABLE "meeting_report" ADD COLUMN IF NOT EXISTS "report_markdown" text;--> statement-breakpoint
ALTER TABLE "meeting_report" ADD COLUMN IF NOT EXISTS "question_answer_map" jsonb;--> statement-breakpoint
ALTER TABLE "meeting_report" ADD COLUMN IF NOT EXISTS "generated_by_model" text;--> statement-breakpoint
ALTER TABLE "meeting_report" ADD COLUMN IF NOT EXISTS "ai_provider" text;--> statement-breakpoint
ALTER TABLE "meeting_report" ADD COLUMN IF NOT EXISTS "usage_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "meeting_report" ADD COLUMN IF NOT EXISTS "usage_output_tokens" integer;--> statement-breakpoint
ALTER TABLE "meeting_report" ADD COLUMN IF NOT EXISTS "mymeet_template" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_report" ADD CONSTRAINT "meeting_report_report_template_id_report_template_id_fk" FOREIGN KEY ("report_template_id") REFERENCES "report_template"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_report_application_id_idx" ON "meeting_report" ("application_id");--> statement-breakpoint

-- application_question_item: write-back метки.
ALTER TABLE "application_question_item" ADD COLUMN IF NOT EXISTS "answer_auto_filled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "application_question_item" ADD COLUMN IF NOT EXISTS "answer_confidence" "answer_confidence";
