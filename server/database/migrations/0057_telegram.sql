-- Спринт 19: Telegram-канал — бот организации и пригласительные токены
CREATE TABLE "comms_telegram_bot" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"bot_token_encrypted" text NOT NULL,
	"bot_username" text NOT NULL,
	"bot_tg_id" text,
	"webhook_secret" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"welcome_message" text,
	"webhook_last_event_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "comms_telegram_link_token" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"token" text NOT NULL,
	"candidate_id" text NOT NULL,
	"application_id" text,
	"job_id" text,
	"created_by_id" text,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"used_by_tg_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "comms_telegram_bot" ADD CONSTRAINT "comms_telegram_bot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_telegram_link_token" ADD CONSTRAINT "comms_telegram_link_token_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_telegram_link_token" ADD CONSTRAINT "comms_telegram_link_token_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_telegram_link_token" ADD CONSTRAINT "comms_telegram_link_token_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_telegram_link_token" ADD CONSTRAINT "comms_telegram_link_token_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_telegram_link_token" ADD CONSTRAINT "comms_telegram_link_token_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comms_telegram_bot_org_idx" ON "comms_telegram_bot" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "comms_telegram_bot_webhook_secret_idx" ON "comms_telegram_bot" USING btree ("webhook_secret");--> statement-breakpoint
CREATE UNIQUE INDEX "comms_telegram_link_token_token_idx" ON "comms_telegram_link_token" USING btree ("token");--> statement-breakpoint
CREATE INDEX "comms_telegram_link_token_org_idx" ON "comms_telegram_link_token" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "comms_telegram_link_token_candidate_idx" ON "comms_telegram_link_token" USING btree ("candidate_id");
