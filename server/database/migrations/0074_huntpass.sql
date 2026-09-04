CREATE TABLE "season" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"quarter" integer NOT NULL,
	"year" integer NOT NULL,
	"theme" text DEFAULT 'default' NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "user_season_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"season_id" text NOT NULL,
	"is_premium" boolean DEFAULT false NOT NULL,
	"claimed_tiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "season_quarter_year_idx" ON "season" ("quarter", "year");--> statement-breakpoint
CREATE UNIQUE INDEX "user_season_progress_org_user_season_idx" ON "user_season_progress" ("organization_id", "user_id", "season_id");--> statement-breakpoint
CREATE INDEX "user_season_progress_season_idx" ON "user_season_progress" ("season_id");--> statement-breakpoint
ALTER TABLE "user_season_progress" ADD CONSTRAINT "user_season_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_season_progress" ADD CONSTRAINT "user_season_progress_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_season_progress" ADD CONSTRAINT "user_season_progress_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
