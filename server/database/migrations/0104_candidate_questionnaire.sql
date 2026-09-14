-- Модуль вопросов — Спринт 4: Персональный опросник под кандидата.
-- Расширение applicationQuestionSet (версии/snapshot/персонализация) +
-- applicationQuestionItem (probe/CARE/приоритеты). Enum item_priority + origin +personalized.
-- Аддитивно + идемпотентно. Runner применяет statements с autocommit (ALTER TYPE ADD VALUE ок).
-- docs/tz-questions-04-candidate-questionnaire.md

-- Новое значение origin (реальное имя enum candidate_question_origin, без суффикса _enum).
ALTER TYPE "candidate_question_origin" ADD VALUE IF NOT EXISTS 'personalized';--> statement-breakpoint

DO $$ BEGIN
 CREATE TYPE "item_priority" AS ENUM('must_ask', 'should_ask', 'optional');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- application_question_set: версии/snapshot/персонализация.
ALTER TABLE "application_question_set" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "application_question_set" ADD COLUMN IF NOT EXISTS "is_snapshot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "application_question_set" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "application_question_set" ADD COLUMN IF NOT EXISTS "confirmed_by_id" text;--> statement-breakpoint
ALTER TABLE "application_question_set" ADD COLUMN IF NOT EXISTS "source_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "application_question_set" ADD COLUMN IF NOT EXISTS "personalized_at" timestamp;--> statement-breakpoint
ALTER TABLE "application_question_set" ADD COLUMN IF NOT EXISTS "personalize_model" text;--> statement-breakpoint
ALTER TABLE "application_question_set" ADD COLUMN IF NOT EXISTS "is_stale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "application_question_set" ADD COLUMN IF NOT EXISTS "budget_max" integer DEFAULT 15 NOT NULL;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "application_question_set" ADD CONSTRAINT "application_question_set_confirmed_by_id_user_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- Снять старый unique (один набор на отклик) → заменить на partial-unique активного черновика.
DROP INDEX IF EXISTS "application_question_set_application_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "application_question_set_active_unique" ON "application_question_set" ("application_id") WHERE "is_snapshot" = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_question_set_application_id_idx" ON "application_question_set" ("application_id");--> statement-breakpoint

-- application_question_item: probe/CARE/приоритеты.
ALTER TABLE "application_question_item" ADD COLUMN IF NOT EXISTS "parent_item_id" text;--> statement-breakpoint
ALTER TABLE "application_question_item" ADD COLUMN IF NOT EXISTS "care_element" "care_element";--> statement-breakpoint
ALTER TABLE "application_question_item" ADD COLUMN IF NOT EXISTS "priority" "item_priority" DEFAULT 'should_ask' NOT NULL;--> statement-breakpoint
ALTER TABLE "application_question_item" ADD COLUMN IF NOT EXISTS "topic_id" text;--> statement-breakpoint
ALTER TABLE "application_question_item" ADD COLUMN IF NOT EXISTS "scale_id" text;--> statement-breakpoint
ALTER TABLE "application_question_item" ADD COLUMN IF NOT EXISTS "expected_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "application_question_item" ADD COLUMN IF NOT EXISTS "green_flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "application_question_item" ADD COLUMN IF NOT EXISTS "red_flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "application_question_item" ADD COLUMN IF NOT EXISTS "is_personalized" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "application_question_item" ADD COLUMN IF NOT EXISTS "original_text" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_question_item_parent_idx" ON "application_question_item" ("parent_item_id");
