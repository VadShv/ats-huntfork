CREATE TABLE IF NOT EXISTS "job_brief" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text NOT NULL,
	"hard_must_have" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nice_to_have" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deal_breakers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"red_flags_to_watch" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"responsibilities" text,
	"team_context" text,
	"interview_process" text,
	"compensation_notes" text,
	"ideal_profile" text,
	"sourcing_hints" text,
	"freeform" text,
	"filled_by_id" text,
	"filled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_brief" ADD CONSTRAINT "job_brief_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_brief" ADD CONSTRAINT "job_brief_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_brief" ADD CONSTRAINT "job_brief_filled_by_id_user_id_fk" FOREIGN KEY ("filled_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_brief_job_id_unique" ON "job_brief" ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_brief_organization_id_idx" ON "job_brief" ("organization_id");
