-- Sprint 17: омниканальные коммуникации — MVP hh.ru чат
CREATE TYPE "public"."comms_channel" AS ENUM('hh', 'telegram', 'email', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."comms_message_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."comms_message_status" AS ENUM('received', 'pending', 'sent', 'failed', 'suggested', 'discarded');--> statement-breakpoint
CREATE TABLE "comms_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel" "comms_channel" NOT NULL,
	"external_chat_id" text NOT NULL,
	"candidate_id" text,
	"application_id" text,
	"job_id" text,
	"hh_negotiation_id" text,
	"hh_account_id" text,
	"state" text DEFAULT 'active' NOT NULL,
	"can_write" boolean DEFAULT true NOT NULL,
	"can_write_reason" text,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp,
	"last_message_preview" text,
	"last_message_direction" "comms_message_direction",
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "comms_message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"external_message_id" text,
	"direction" "comms_message_direction" NOT NULL,
	"sender_type" text DEFAULT 'recruiter' NOT NULL,
	"sender_user_id" text,
	"sender_name" text,
	"body" text,
	"attachments" jsonb,
	"status" "comms_message_status" DEFAULT 'received' NOT NULL,
	"error_message" text,
	"external_created_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "comms_conversation" ADD CONSTRAINT "comms_conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_conversation" ADD CONSTRAINT "comms_conversation_candidate_id_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidate"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_conversation" ADD CONSTRAINT "comms_conversation_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_conversation" ADD CONSTRAINT "comms_conversation_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_conversation" ADD CONSTRAINT "comms_conversation_hh_negotiation_id_hh_negotiation_id_fk" FOREIGN KEY ("hh_negotiation_id") REFERENCES "public"."hh_negotiation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_conversation" ADD CONSTRAINT "comms_conversation_hh_account_id_hh_account_id_fk" FOREIGN KEY ("hh_account_id") REFERENCES "public"."hh_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_message" ADD CONSTRAINT "comms_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_message" ADD CONSTRAINT "comms_message_conversation_id_comms_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."comms_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_message" ADD CONSTRAINT "comms_message_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comms_conversation_org_channel_ext_idx" ON "comms_conversation" USING btree ("organization_id","channel","external_chat_id");--> statement-breakpoint
CREATE INDEX "comms_conversation_org_idx" ON "comms_conversation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "comms_conversation_candidate_idx" ON "comms_conversation" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "comms_conversation_application_idx" ON "comms_conversation" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "comms_message_conversation_idx" ON "comms_message" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "comms_message_org_idx" ON "comms_message" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comms_message_conv_ext_idx" ON "comms_message" USING btree ("conversation_id","external_message_id") WHERE "external_message_id" IS NOT NULL;
