CREATE TABLE "duel" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"challenger_id" text NOT NULL,
	"opponent_id" text NOT NULL,
	"metric" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"winner_id" text,
	"challenger_score" integer DEFAULT 0 NOT NULL,
	"opponent_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);--> statement-breakpoint
CREATE INDEX "duel_org_idx" ON "duel" ("organization_id");--> statement-breakpoint
CREATE INDEX "duel_challenger_idx" ON "duel" ("challenger_id");--> statement-breakpoint
CREATE INDEX "duel_opponent_idx" ON "duel" ("opponent_id");--> statement-breakpoint
CREATE INDEX "duel_status_idx" ON "duel" ("organization_id", "status");--> statement-breakpoint
ALTER TABLE "duel" ADD CONSTRAINT "duel_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel" ADD CONSTRAINT "duel_challenger_id_user_id_fk" FOREIGN KEY ("challenger_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel" ADD CONSTRAINT "duel_opponent_id_user_id_fk" FOREIGN KEY ("opponent_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
