-- Спринт 18.1: вебхуки hh.ru — журнал событий каналов + поля подписки на hh_account
CREATE TABLE "comms_channel_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel" "comms_channel" NOT NULL,
	"external_event_id" text,
	"type" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'received' NOT NULL,
	"error_message" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "comms_channel_event" ADD CONSTRAINT "comms_channel_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comms_channel_event_org_idx" ON "comms_channel_event" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "comms_channel_event_status_idx" ON "comms_channel_event" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "comms_channel_event_dedup_idx" ON "comms_channel_event" USING btree ("organization_id","channel","type","external_event_id") WHERE "external_event_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "hh_account" ADD COLUMN "webhook_secret" text;--> statement-breakpoint
ALTER TABLE "hh_account" ADD COLUMN "webhook_subscription_id" text;--> statement-breakpoint
ALTER TABLE "hh_account" ADD COLUMN "webhook_enabled_at" timestamp;--> statement-breakpoint
ALTER TABLE "hh_account" ADD COLUMN "webhook_last_event_at" timestamp;--> statement-breakpoint
CREATE INDEX "hh_account_webhook_secret_idx" ON "hh_account" USING btree ("webhook_secret");
