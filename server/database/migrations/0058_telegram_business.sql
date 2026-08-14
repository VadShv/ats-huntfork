-- Спринт 19.5: Telegram Business — подключение бота к личному аккаунту рекрутёра
CREATE TABLE "comms_telegram_business_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"tg_user_id" text NOT NULL,
	"tg_username" text,
	"display_name" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"can_reply" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "comms_telegram_business_connection" ADD CONSTRAINT "comms_telegram_business_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comms_tg_bizconn_org_user_idx" ON "comms_telegram_business_connection" USING btree ("organization_id","tg_user_id");--> statement-breakpoint
CREATE INDEX "comms_tg_bizconn_connection_idx" ON "comms_telegram_business_connection" USING btree ("connection_id");--> statement-breakpoint
ALTER TABLE "comms_conversation" ADD COLUMN "tg_business_connection_id" text;--> statement-breakpoint
ALTER TABLE "comms_conversation" ADD CONSTRAINT "comms_conversation_tg_business_connection_id_fk" FOREIGN KEY ("tg_business_connection_id") REFERENCES "public"."comms_telegram_business_connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comms_conversation_tg_bizconn_idx" ON "comms_conversation" USING btree ("tg_business_connection_id");
