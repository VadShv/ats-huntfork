-- Модуль «Карта поиска» — docs/tz-search-map.md
-- Глобальный конструктор (шаблоны, реестр доноров, каналы) + карта вакансии
-- (секции, элементы, доноры, сегменты, версии). Связка с hh_saved_search.
-- Аддитивно + идемпотентно.

-- ── Enums ────────────────────────────────────────────────────────

DO $$ BEGIN
 CREATE TYPE "search_map_template_status" AS ENUM('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "search_map_section_type" AS ENUM('title_synonyms', 'keywords', 'geo', 'exclusions', 'notes');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "donor_layer" AS ENUM('core', 'adjacent', 'school', 'alumni', 'custom');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "donor_company_status" AS ENUM('active', 'archived', 'merged');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "hypothesis_status" AS ENUM('untested', 'in_progress', 'working', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "search_map_priority" AS ENUM('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "search_map_origin" AS ENUM('manual', 'ai', 'template');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "search_map_status" AS ENUM('draft', 'active', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "search_map_version_trigger" AS ENUM('manual', 'sources_changed', 'ai_generated', 'calibration', 'restore');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- ── Global: search_map_template ──────────────────────────────────

CREATE TABLE IF NOT EXISTS "search_map_template" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"description" text,
	"target_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generation_guidance" text,
	"default_channel_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" "search_map_template_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_id" text,
	"published_at" timestamp,
	"published_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_map_template_org_idx" ON "search_map_template" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "search_map_template_org_code_unique" ON "search_map_template" ("organization_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_map_template_default_idx" ON "search_map_template" ("organization_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "search_map_template_section" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"template_id" text NOT NULL,
	"section_type" "search_map_section_type" NOT NULL,
	"title" text NOT NULL,
	"guidance" text,
	"is_required" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_map_template_section_org_idx" ON "search_map_template_section" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_map_template_section_template_idx" ON "search_map_template_section" ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "search_map_template_section_unique" ON "search_map_template_section" ("template_id","section_type");--> statement-breakpoint

-- ── Global: donor_company ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "donor_company" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"normalized_aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"website" text,
	"hh_employer_id" text,
	"industry" text,
	"tech_stack" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"size_band" text,
	"stage" text,
	"country" text,
	"city" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"status" "donor_company_status" DEFAULT 'active' NOT NULL,
	"merged_into_id" text,
	"created_by_id" text,
	"created_from_job_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "donor_company_org_idx" ON "donor_company" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "donor_company_org_normalized_unique" ON "donor_company" ("organization_id","normalized_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "donor_company_status_idx" ON "donor_company" ("status");--> statement-breakpoint

-- ── Global: sourcing_channel ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS "sourcing_channel" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_priority" "search_map_priority" DEFAULT 'medium' NOT NULL,
	"url_template" text,
	"query_language_hint" text,
	"target_site" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sourcing_channel_org_idx" ON "sourcing_channel" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sourcing_channel_org_code_unique" ON "sourcing_channel" ("organization_id","code");--> statement-breakpoint

-- ── Local: job_search_map ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "job_search_map" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text NOT NULL,
	"template_id" text,
	"template_version" integer,
	"status" "search_map_status" DEFAULT 'draft' NOT NULL,
	"current_version_no" integer DEFAULT 0 NOT NULL,
	"source_hashes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_hashes_at" timestamp,
	"summary" text,
	"last_generated_at" timestamp,
	"last_generation_model" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_search_map_job_unique" ON "job_search_map" ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_search_map_org_idx" ON "job_search_map" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_search_map_template_idx" ON "job_search_map" ("template_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "job_search_map_section" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"map_id" text NOT NULL,
	"section_type" "search_map_section_type" NOT NULL,
	"title" text NOT NULL,
	"guidance" text,
	"is_required" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_search_map_section_org_idx" ON "job_search_map_section" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_search_map_section_map_idx" ON "job_search_map_section" ("map_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_search_map_section_unique" ON "job_search_map_section" ("map_id","section_type");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "job_search_map_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"map_id" text NOT NULL,
	"section_id" text NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"note" text,
	"origin" "search_map_origin" DEFAULT 'manual' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_search_map_item_org_idx" ON "job_search_map_item" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_search_map_item_section_idx" ON "job_search_map_item" ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_search_map_item_unique" ON "job_search_map_item" ("section_id","normalized_value");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "job_search_map_donor" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"map_id" text NOT NULL,
	"donor_company_id" text NOT NULL,
	"layer" "donor_layer" DEFAULT 'core' NOT NULL,
	"priority" "search_map_priority" DEFAULT 'medium' NOT NULL,
	"hypothesis_status" "hypothesis_status" DEFAULT 'untested' NOT NULL,
	"rationale" text,
	"result_note" text,
	"status_changed_at" timestamp,
	"status_changed_by_id" text,
	"origin" "search_map_origin" DEFAULT 'manual' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_search_map_donor_org_idx" ON "job_search_map_donor" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_search_map_donor_map_idx" ON "job_search_map_donor" ("map_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_search_map_donor_donor_idx" ON "job_search_map_donor" ("donor_company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_search_map_donor_unique" ON "job_search_map_donor" ("map_id","donor_company_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "job_search_map_segment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"map_id" text NOT NULL,
	"name" text NOT NULL,
	"donor_layer" "donor_layer",
	"donor_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"titles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"geo" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"channel_id" text,
	"query_string" text,
	"query_url" text,
	"priority" "search_map_priority" DEFAULT 'medium' NOT NULL,
	"pool_estimate" integer,
	"response_likelihood" integer,
	"access_difficulty" integer,
	"hypothesis_status" "hypothesis_status" DEFAULT 'untested' NOT NULL,
	"rationale" text,
	"result_note" text,
	"status_changed_at" timestamp,
	"status_changed_by_id" text,
	"origin" "search_map_origin" DEFAULT 'manual' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_search_map_segment_org_idx" ON "job_search_map_segment" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_search_map_segment_map_idx" ON "job_search_map_segment" ("map_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_search_map_segment_channel_idx" ON "job_search_map_segment" ("channel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_search_map_segment_status_idx" ON "job_search_map_segment" ("hypothesis_status");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "job_search_map_version" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"map_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"label" text NOT NULL,
	"trigger" "search_map_version_trigger" NOT NULL,
	"snapshot" jsonb NOT NULL,
	"source_hashes" jsonb NOT NULL,
	"diff_summary" jsonb,
	"comment" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_search_map_version_org_idx" ON "job_search_map_version" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_search_map_version_map_idx" ON "job_search_map_version" ("map_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_search_map_version_unique" ON "job_search_map_version" ("map_id","version_no");--> statement-breakpoint

-- ── Bridge: hh_saved_search + search_map_segment_id ──────────────

ALTER TABLE "hh_saved_search" ADD COLUMN IF NOT EXISTS "search_map_segment_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hh_saved_search_segment_idx" ON "hh_saved_search" ("search_map_segment_id");--> statement-breakpoint

-- ── Foreign keys (added separately for IF NOT EXISTS safety) ──────

DO $$ BEGIN
 ALTER TABLE "search_map_template" ADD CONSTRAINT "search_map_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "search_map_template_section" ADD CONSTRAINT "search_map_template_section_template_id_search_map_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "search_map_template"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "donor_company" ADD CONSTRAINT "donor_company_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sourcing_channel" ADD CONSTRAINT "sourcing_channel_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_search_map" ADD CONSTRAINT "job_search_map_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hh_saved_search" ADD CONSTRAINT "hh_saved_search_segment_id_fk" FOREIGN KEY ("search_map_segment_id") REFERENCES "job_search_map_segment"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
