-- Чат 2.0: живучая генерация черновиков + настройки ИИ-чата под вакансию
ALTER TYPE "comms_message_status" ADD VALUE IF NOT EXISTS 'generating';--> statement-breakpoint
CREATE TABLE "comms_job_assistant_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"goals" text,
	"extra_context" text,
	"tone_override" text,
	"default_assistant_mode" text DEFAULT 'off' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "comms_job_assistant_settings" ADD CONSTRAINT "comms_job_assistant_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_job_assistant_settings" ADD CONSTRAINT "comms_job_assistant_settings_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comms_job_assistant_settings_job_idx" ON "comms_job_assistant_settings" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "comms_job_assistant_settings_org_idx" ON "comms_job_assistant_settings" USING btree ("organization_id");
