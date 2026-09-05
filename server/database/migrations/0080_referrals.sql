CREATE TABLE "referral" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"suggested_job_id" text,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_application_id" text,
	"assist_paid" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);--> statement-breakpoint
CREATE INDEX "referral_org_idx" ON "referral" ("organization_id");--> statement-breakpoint
CREATE INDEX "referral_from_idx" ON "referral" ("from_user_id");--> statement-breakpoint
CREATE INDEX "referral_to_idx" ON "referral" ("to_user_id");--> statement-breakpoint
CREATE INDEX "referral_status_idx" ON "referral" ("organization_id", "status");--> statement-breakpoint
CREATE INDEX "referral_result_app_idx" ON "referral" ("result_application_id");--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "candidate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_suggested_job_id_job_id_fk" FOREIGN KEY ("suggested_job_id") REFERENCES "job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
