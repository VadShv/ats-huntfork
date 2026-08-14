-- Спринт 18.5: AI-ассистент в переписке — профиль организации + режим per-диалог
CREATE TABLE "comms_assistant_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"persona_name" text,
	"persona_role" text,
	"tone" text DEFAULT 'neutral' NOT NULL,
	"language" text DEFAULT 'ru' NOT NULL,
	"knowledge_base" text,
	"rules" text,
	"signature_enabled" boolean DEFAULT true NOT NULL,
	"ai_config_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "comms_assistant_profile" ADD CONSTRAINT "comms_assistant_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_assistant_profile" ADD CONSTRAINT "comms_assistant_profile_ai_config_id_ai_config_id_fk" FOREIGN KEY ("ai_config_id") REFERENCES "public"."ai_config"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comms_assistant_profile_org_idx" ON "comms_assistant_profile" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "comms_conversation" ADD COLUMN "assistant_mode" text DEFAULT 'off' NOT NULL;
