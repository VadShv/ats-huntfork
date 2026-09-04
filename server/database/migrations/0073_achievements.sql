CREATE TYPE "achievement_tier" AS ENUM('bronze', 'silver', 'gold', 'platinum');--> statement-breakpoint
CREATE TABLE "achievement" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"tier" "achievement_tier" DEFAULT 'bronze' NOT NULL,
	"icon" text DEFAULT '🏆' NOT NULL,
	"metric" text NOT NULL,
	"threshold" integer NOT NULL,
	"threshold2" integer,
	"points" integer DEFAULT 10 NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "achievement_key_unique" UNIQUE("key")
);--> statement-breakpoint
CREATE TABLE "user_achievement" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"achievement_id" text NOT NULL,
	"earned_at" timestamp NOT NULL DEFAULT now(),
	"metadata" jsonb
);--> statement-breakpoint
CREATE UNIQUE INDEX "user_achievement_org_user_ach_idx" ON "user_achievement" ("organization_id", "user_id", "achievement_id");--> statement-breakpoint
CREATE INDEX "user_achievement_user_id_idx" ON "user_achievement" ("user_id");--> statement-breakpoint
ALTER TABLE "user_achievement" ADD CONSTRAINT "user_achievement_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievement" ADD CONSTRAINT "user_achievement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievement" ADD CONSTRAINT "user_achievement_achievement_id_achievement_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "achievement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
