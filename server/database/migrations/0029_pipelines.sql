-- Migration 0029: Configurable Pipelines (Stage B1)
-- Adds pipeline, pipeline_stage, and application_stage_history tables.
-- Adds pipeline_id to job and current_stage_id / stage_changed_at to application.
-- The existing application_status enum and application.status column are NOT touched.

CREATE TYPE "public"."pipeline_stage_type" AS ENUM('applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'custom');--> statement-breakpoint
CREATE TABLE "pipeline" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_stage" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"pipeline_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text NOT NULL,
	"type" "pipeline_stage_type" DEFAULT 'custom' NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_stage_history" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"application_id" text NOT NULL,
	"from_stage_id" text,
	"to_stage_id" text NOT NULL,
	"moved_by_user_id" text,
	"comment" text,
	"moved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "pipeline_id" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "current_stage_id" text;--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN "stage_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD CONSTRAINT "pipeline_stage_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_stage_history" ADD CONSTRAINT "application_stage_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_stage_history" ADD CONSTRAINT "application_stage_history_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_stage_history" ADD CONSTRAINT "application_stage_history_from_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_stage_history" ADD CONSTRAINT "application_stage_history_to_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_stage_history" ADD CONSTRAINT "application_stage_history_moved_by_user_id_user_id_fk" FOREIGN KEY ("moved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_current_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("current_stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipeline_organization_id_idx" ON "pipeline" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_org_name_idx" ON "pipeline" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "pipeline_stage_pipeline_id_idx" ON "pipeline_stage" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "pipeline_stage_organization_id_idx" ON "pipeline_stage" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "application_stage_history_application_id_idx" ON "application_stage_history" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "application_stage_history_organization_id_idx" ON "application_stage_history" USING btree ("organization_id");
