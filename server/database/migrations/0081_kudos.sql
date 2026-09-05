CREATE TABLE "kudos" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"reason" text,
	"week_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "kudos_from_week_idx" ON "kudos" ("organization_id", "from_user_id", "week_key");--> statement-breakpoint
CREATE INDEX "kudos_to_idx" ON "kudos" ("organization_id", "to_user_id");--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
