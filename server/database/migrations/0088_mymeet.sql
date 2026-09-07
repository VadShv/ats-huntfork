DO $$ BEGIN
 CREATE TYPE "meeting_report_status" AS ENUM('importing', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mymeet_account" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"last_tools_json" jsonb,
	"last_checked_at" timestamp,
	"connected_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_report" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"interview_id" text,
	"application_id" text,
	"status" "meeting_report_status" DEFAULT 'importing' NOT NULL,
	"external_meeting_id" text NOT NULL,
	"title" text,
	"meeting_date" timestamp,
	"duration_sec" integer,
	"transcript_text" text,
	"report_json" jsonb,
	"summary" text,
	"participants_json" jsonb,
	"source_url" text,
	"error_message" text,
	"imported_by_id" text,
	"imported_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mymeet_account" ADD CONSTRAINT "mymeet_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mymeet_account" ADD CONSTRAINT "mymeet_account_connected_by_id_user_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_report" ADD CONSTRAINT "meeting_report_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_report" ADD CONSTRAINT "meeting_report_interview_id_interview_id_fk" FOREIGN KEY ("interview_id") REFERENCES "interview"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meeting_report" ADD CONSTRAINT "meeting_report_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mymeet_account_organization_id_unique" ON "mymeet_account" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_report_org_external_unique" ON "meeting_report" ("organization_id","external_meeting_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_report_interview_id_idx" ON "meeting_report" ("interview_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_report_organization_id_idx" ON "meeting_report" ("organization_id");
