CREATE TABLE "gamification_team" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#01696f' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "gamification_team_member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL
);--> statement-breakpoint
CREATE TABLE "gamification_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"mvp_enabled" boolean DEFAULT false NOT NULL,
	"mvp_telegram_chat_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "gamification_team_org_idx" ON "gamification_team" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gamification_team_member_org_user_idx" ON "gamification_team_member" ("organization_id", "user_id");--> statement-breakpoint
CREATE INDEX "gamification_team_member_team_idx" ON "gamification_team_member" ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gamification_settings_org_idx" ON "gamification_settings" ("organization_id");--> statement-breakpoint
ALTER TABLE "gamification_team" ADD CONSTRAINT "gamification_team_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gamification_team_member" ADD CONSTRAINT "gamification_team_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gamification_team_member" ADD CONSTRAINT "gamification_team_member_team_id_gamification_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "gamification_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gamification_team_member" ADD CONSTRAINT "gamification_team_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gamification_settings" ADD CONSTRAINT "gamification_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
