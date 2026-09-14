-- Модуль вопросов — Спринт 2: Методология CARE.
-- Таблицы: care_methodology, care_prompt, care_probe_trigger.
-- Enums: care_prompt_kind, probe_source.
-- Расширения: bank_question (+care-поля), bank_question_probe (+probe_source, +trigger_id).
-- Аддитивно + идемпотентно. docs/tz-questions-02-care.md

DO $$ BEGIN
 CREATE TYPE "care_prompt_kind" AS ENUM('structure_question', 'personalize_questionnaire', 'generate_report');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "probe_source" AS ENUM('ai_structured', 'manual', 'trigger');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "care_methodology" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"version" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"title" text DEFAULT 'CARE' NOT NULL,
	"description" text,
	"interviewer_instruction" text,
	"sufficiency_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"probe_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"probe_limit_per_element" integer DEFAULT 3 NOT NULL,
	"probe_limit_per_question" integer DEFAULT 6 NOT NULL,
	"change_note" text,
	"created_by_id" text,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "care_prompt" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "care_prompt_kind" NOT NULL,
	"prompt_text" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"methodology_version" integer NOT NULL,
	"change_note" text,
	"created_by_id" text,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "care_probe_trigger" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"trigger" text NOT NULL,
	"recommended_probe" text NOT NULL,
	"care_element" "care_element",
	"is_builtin" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "bank_question" ADD COLUMN IF NOT EXISTS "structured_with_version" integer;--> statement-breakpoint
ALTER TABLE "bank_question" ADD COLUMN IF NOT EXISTS "structured_at" timestamp;--> statement-breakpoint
ALTER TABLE "bank_question" ADD COLUMN IF NOT EXISTS "structured_by_id" text;--> statement-breakpoint
ALTER TABLE "bank_question" ADD COLUMN IF NOT EXISTS "care_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "bank_question_probe" ADD COLUMN IF NOT EXISTS "probe_source" "probe_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_question_probe" ADD COLUMN IF NOT EXISTS "trigger_id" text;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "care_methodology" ADD CONSTRAINT "care_methodology_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_methodology" ADD CONSTRAINT "care_methodology_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_prompt" ADD CONSTRAINT "care_prompt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_prompt" ADD CONSTRAINT "care_prompt_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_probe_trigger" ADD CONSTRAINT "care_probe_trigger_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "care_probe_trigger" ADD CONSTRAINT "care_probe_trigger_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_question" ADD CONSTRAINT "bank_question_structured_by_id_user_id_fk" FOREIGN KEY ("structured_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "care_methodology_org_idx" ON "care_methodology" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "care_methodology_org_version_unique" ON "care_methodology" ("organization_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "care_methodology_org_active_unique" ON "care_methodology" ("organization_id") WHERE "is_active";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_prompt_org_idx" ON "care_prompt" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "care_prompt_org_kind_version_unique" ON "care_prompt" ("organization_id","kind","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "care_prompt_org_kind_active_unique" ON "care_prompt" ("organization_id","kind") WHERE "is_active";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_probe_trigger_org_idx" ON "care_probe_trigger" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_probe_trigger_org_order_idx" ON "care_probe_trigger" ("organization_id","display_order");
