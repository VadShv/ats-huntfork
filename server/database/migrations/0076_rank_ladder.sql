CREATE TABLE "user_rank" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"season_id" text NOT NULL,
	"division" text DEFAULT 'bronze' NOT NULL,
	"subrank" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'placement' NOT NULL,
	"placement_weeks_left" integer DEFAULT 2 NOT NULL,
	"promo_progress" integer DEFAULT 0 NOT NULL,
	"inactive_weeks" integer DEFAULT 0 NOT NULL,
	"peak_rp" integer DEFAULT 0 NOT NULL,
	"last_rp" integer DEFAULT 0 NOT NULL,
	"last_tick_week" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "rank_history" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"season_id" text NOT NULL,
	"week_key" text NOT NULL,
	"rp" integer NOT NULL,
	"division" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "user_rank_org_user_season_idx" ON "user_rank" ("organization_id", "user_id", "season_id");--> statement-breakpoint
CREATE INDEX "user_rank_season_idx" ON "user_rank" ("season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rank_history_unique_idx" ON "rank_history" ("organization_id", "user_id", "season_id", "week_key");--> statement-breakpoint
CREATE INDEX "rank_history_user_season_idx" ON "rank_history" ("organization_id", "user_id", "season_id");--> statement-breakpoint
ALTER TABLE "user_rank" ADD CONSTRAINT "user_rank_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_rank" ADD CONSTRAINT "user_rank_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_rank" ADD CONSTRAINT "user_rank_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_history" ADD CONSTRAINT "rank_history_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_history" ADD CONSTRAINT "rank_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_history" ADD CONSTRAINT "rank_history_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
