-- Модуль вопросов — Спринт 3: Пресеты опросных карт + карта вакансии.
-- Таблицы: question_preset, preset_section, preset_section_question, job_questionnaire_meta.
-- Enums: preset_status, question_link_mode. interview_stage переиспользуется (S1).
-- Расширение jobInterviewQuestion: +7 колонок связи с банком/пресетом/критерием.
-- Аддитивно + идемпотентно. docs/tz-questions-03-presets-vacancy.md

DO $$ BEGIN
 CREATE TYPE "preset_status" AS ENUM('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "question_link_mode" AS ENUM('linked', 'copy', 'linked_with_overrides');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "question_preset" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"description" text,
	"interview_type" "interview_stage" DEFAULT 'full_cycle' NOT NULL,
	"target_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seniority" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" "preset_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"owner_id" text,
	"created_by_id" text,
	"published_at" timestamp,
	"published_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "preset_section" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"preset_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"title" text NOT NULL,
	"goal" text,
	"weight" integer DEFAULT 50 NOT NULL,
	"min_questions" integer DEFAULT 0 NOT NULL,
	"max_questions" integer DEFAULT 0 NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "preset_section_question" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"section_id" text NOT NULL,
	"bank_question_id" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_questionnaire_meta" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text NOT NULL,
	"preset_id" text,
	"preset_version" integer,
	"imported_at" timestamp,
	"imported_by_id" text,
	"adapted_at" timestamp,
	"adaptation_model" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "job_interview_question" ADD COLUMN IF NOT EXISTS "source_bank_question_id" text;--> statement-breakpoint
ALTER TABLE "job_interview_question" ADD COLUMN IF NOT EXISTS "link_mode" "question_link_mode" DEFAULT 'copy' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_interview_question" ADD COLUMN IF NOT EXISTS "overridden_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "job_interview_question" ADD COLUMN IF NOT EXISTS "criterion_id" text;--> statement-breakpoint
ALTER TABLE "job_interview_question" ADD COLUMN IF NOT EXISTS "preset_id" text;--> statement-breakpoint
ALTER TABLE "job_interview_question" ADD COLUMN IF NOT EXISTS "section_ref" text;--> statement-breakpoint
ALTER TABLE "job_interview_question" ADD COLUMN IF NOT EXISTS "source_version" integer;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "question_preset" ADD CONSTRAINT "question_preset_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "question_preset" ADD CONSTRAINT "question_preset_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "question_preset" ADD CONSTRAINT "question_preset_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "question_preset" ADD CONSTRAINT "question_preset_published_by_id_user_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "preset_section" ADD CONSTRAINT "preset_section_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "preset_section" ADD CONSTRAINT "preset_section_preset_id_question_preset_id_fk" FOREIGN KEY ("preset_id") REFERENCES "question_preset"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "preset_section" ADD CONSTRAINT "preset_section_topic_id_assessment_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "assessment_topic"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "preset_section_question" ADD CONSTRAINT "preset_section_question_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "preset_section_question" ADD CONSTRAINT "preset_section_question_section_id_preset_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "preset_section"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "preset_section_question" ADD CONSTRAINT "preset_section_question_bank_question_id_bank_question_id_fk" FOREIGN KEY ("bank_question_id") REFERENCES "bank_question"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_questionnaire_meta" ADD CONSTRAINT "job_questionnaire_meta_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_questionnaire_meta" ADD CONSTRAINT "job_questionnaire_meta_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_questionnaire_meta" ADD CONSTRAINT "job_questionnaire_meta_preset_id_question_preset_id_fk" FOREIGN KEY ("preset_id") REFERENCES "question_preset"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_questionnaire_meta" ADD CONSTRAINT "job_questionnaire_meta_imported_by_id_user_id_fk" FOREIGN KEY ("imported_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_interview_question" ADD CONSTRAINT "job_interview_question_source_bank_question_id_bank_question_id_fk" FOREIGN KEY ("source_bank_question_id") REFERENCES "bank_question"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_interview_question" ADD CONSTRAINT "job_interview_question_criterion_id_scoring_criterion_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "scoring_criterion"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_interview_question" ADD CONSTRAINT "job_interview_question_preset_id_question_preset_id_fk" FOREIGN KEY ("preset_id") REFERENCES "question_preset"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "question_preset_org_idx" ON "question_preset" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "question_preset_org_code_unique" ON "question_preset" ("organization_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "question_preset_status_idx" ON "question_preset" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "question_preset_org_default_unique" ON "question_preset" ("organization_id") WHERE "is_default";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preset_section_org_idx" ON "preset_section" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preset_section_preset_idx" ON "preset_section" ("preset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preset_section_topic_idx" ON "preset_section" ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preset_section_question_org_idx" ON "preset_section_question" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preset_section_question_section_idx" ON "preset_section_question" ("section_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "preset_section_question_bank_idx" ON "preset_section_question" ("bank_question_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "preset_section_question_unique" ON "preset_section_question" ("section_id","bank_question_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_questionnaire_meta_job_unique" ON "job_questionnaire_meta" ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_questionnaire_meta_org_idx" ON "job_questionnaire_meta" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_questionnaire_meta_preset_idx" ON "job_questionnaire_meta" ("preset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_interview_question_source_bank_idx" ON "job_interview_question" ("source_bank_question_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_interview_question_criterion_idx" ON "job_interview_question" ("criterion_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_interview_question_preset_idx" ON "job_interview_question" ("preset_id");
