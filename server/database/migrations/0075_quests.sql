CREATE TABLE "quest_template" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"metric" text NOT NULL,
	"target" integer NOT NULL,
	"sxp_reward" integer NOT NULL,
	"is_quality" boolean DEFAULT false NOT NULL,
	"weight" integer DEFAULT 5 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "quest_template_key_unique" UNIQUE("key")
);--> statement-breakpoint
CREATE TABLE "user_quest" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"quest_template_id" text NOT NULL,
	"period_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"claimed_at" timestamp,
	"assigned_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "user_quest_user_period_idx" ON "user_quest" ("organization_id", "user_id", "period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "user_quest_unique_idx" ON "user_quest" ("organization_id", "user_id", "quest_template_id", "period_key");--> statement-breakpoint
ALTER TABLE "user_quest" ADD CONSTRAINT "user_quest_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_quest" ADD CONSTRAINT "user_quest_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_quest" ADD CONSTRAINT "user_quest_quest_template_id_quest_template_id_fk" FOREIGN KEY ("quest_template_id") REFERENCES "quest_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_season_progress" ADD COLUMN "bonus_sxp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
