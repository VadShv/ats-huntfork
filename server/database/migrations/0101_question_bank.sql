-- Модуль вопросов — Спринт 1: Org Банк вопросов.
-- Таблицы: assessment_topic, assessment_scale, bars_anchor, bank_question,
-- bank_question_probe. Enums: assessment_topic_type, topic_status, scale_type,
-- bank_question_type, bank_question_status, interview_stage, care_element,
-- bank_question_source, bank_question_complexity.
-- Аддитивно + идемпотентно. docs/tz-questions-01-org-bank.md

DO $$ BEGIN
 CREATE TYPE "assessment_topic_type" AS ENUM('value', 'soft_skill', 'management', 'professional', 'motivation', 'expectations', 'factcheck', 'achievement_scale', 'career_logic', 'risk_zone', 'culture', 'custom');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "topic_status" AS ENUM('draft', 'active', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "scale_type" AS ENUM('numeric_5', 'numeric_4', 'numeric_3', 'match_3', 'verify_3', 'level_5', 'custom');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "bank_question_type" AS ENUM('behavioral', 'situational', 'motivational', 'factual', 'verification', 'reflective', 'professional', 'control', 'ai_personal');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "bank_question_status" AS ENUM('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "interview_stage" AS ENUM('screening', 'recruiter', 'hiring_manager', 'final', 'expert', 'full_cycle');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "care_element" AS ENUM('context', 'action', 'result', 'evaluate');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "bank_question_source" AS ENUM('manual', 'ai_generated', 'imported', 'from_vacancy');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "bank_question_complexity" AS ENUM('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "assessment_topic" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"short_name" text,
	"type" "assessment_topic_type" DEFAULT 'custom' NOT NULL,
	"definition" text,
	"goal" text,
	"positive_indicators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"negative_indicators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_topic_id" text,
	"target_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "topic_status" DEFAULT 'active' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assessment_scale" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "scale_type" DEFAULT 'numeric_5' NOT NULL,
	"min_value" integer,
	"max_value" integer,
	"allow_insufficient_data" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bars_anchor" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"scale_id" text NOT NULL,
	"value" text NOT NULL,
	"anchor_text" text NOT NULL,
	"positive_examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"negative_examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_question" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"code" text,
	"primary_topic_id" text NOT NULL,
	"type" "bank_question_type" DEFAULT 'behavioral' NOT NULL,
	"text" text NOT NULL,
	"goal" text,
	"assesses" text,
	"recommended_stage" "interview_stage",
	"expected_signal" text,
	"strong_indicators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weak_indicators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_min" integer,
	"complexity" "bank_question_complexity",
	"secondary_topic_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scale_id_override" text,
	"target_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "bank_question_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source" "bank_question_source" DEFAULT 'manual' NOT NULL,
	"care_ready" boolean DEFAULT false NOT NULL,
	"published_at" timestamp,
	"published_by_id" text,
	"owner_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_question_probe" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"bank_question_id" text NOT NULL,
	"care_element" "care_element" NOT NULL,
	"text" text NOT NULL,
	"sufficient_signal" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "assessment_topic" ADD CONSTRAINT "assessment_topic_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessment_topic" ADD CONSTRAINT "assessment_topic_parent_topic_id_assessment_topic_id_fk" FOREIGN KEY ("parent_topic_id") REFERENCES "assessment_topic"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessment_topic" ADD CONSTRAINT "assessment_topic_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessment_scale" ADD CONSTRAINT "assessment_scale_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assessment_scale" ADD CONSTRAINT "assessment_scale_topic_id_assessment_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "assessment_topic"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bars_anchor" ADD CONSTRAINT "bars_anchor_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bars_anchor" ADD CONSTRAINT "bars_anchor_scale_id_assessment_scale_id_fk" FOREIGN KEY ("scale_id") REFERENCES "assessment_scale"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_question" ADD CONSTRAINT "bank_question_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_question" ADD CONSTRAINT "bank_question_primary_topic_id_assessment_topic_id_fk" FOREIGN KEY ("primary_topic_id") REFERENCES "assessment_topic"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_question" ADD CONSTRAINT "bank_question_scale_id_override_assessment_scale_id_fk" FOREIGN KEY ("scale_id_override") REFERENCES "assessment_scale"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_question" ADD CONSTRAINT "bank_question_published_by_id_user_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_question" ADD CONSTRAINT "bank_question_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_question" ADD CONSTRAINT "bank_question_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_question_probe" ADD CONSTRAINT "bank_question_probe_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_question_probe" ADD CONSTRAINT "bank_question_probe_bank_question_id_bank_question_id_fk" FOREIGN KEY ("bank_question_id") REFERENCES "bank_question"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "assessment_topic_org_idx" ON "assessment_topic" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assessment_topic_org_code_unique" ON "assessment_topic" ("organization_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assessment_topic_parent_idx" ON "assessment_topic" ("parent_topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assessment_topic_status_idx" ON "assessment_topic" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assessment_scale_org_idx" ON "assessment_scale" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assessment_scale_topic_idx" ON "assessment_scale" ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bars_anchor_org_idx" ON "bars_anchor" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bars_anchor_scale_idx" ON "bars_anchor" ("scale_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bars_anchor_scale_value_unique" ON "bars_anchor" ("scale_id","value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_question_org_idx" ON "bank_question" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_question_org_code_unique" ON "bank_question" ("organization_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_question_primary_topic_idx" ON "bank_question" ("primary_topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_question_status_idx" ON "bank_question" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_question_probe_org_idx" ON "bank_question_probe" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_question_probe_question_idx" ON "bank_question_probe" ("bank_question_id");
