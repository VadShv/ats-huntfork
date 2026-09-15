-- hh.ru: org-level OAuth application credentials (UI-entered).
-- Таблица hh_oauth_config — позволяет админу настроить hh.ru через UI
-- (Settings → Integrations) без доступа к серверным env-переменным.
-- Client secret шифруется AES-256-GCM (как токены в hh_account).
-- DB-конфиг имеет приоритет над env HH_CLIENT_ID/SECRET/REDIRECT_URI.
-- Аддитивно + идемпотентно.

CREATE TABLE IF NOT EXISTS "hh_oauth_config" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_encrypted" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"oauth_base" text,
	"api_base" text,
	"user_agent" text,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint

DO $$ BEGIN
 CREATE UNIQUE INDEX IF NOT EXISTS "hh_oauth_config_org_idx" ON "hh_oauth_config" ("organization_id");
EXCEPTION WHEN duplicate_table THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "hh_oauth_config"
  ADD CONSTRAINT "hh_oauth_config_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id")
  ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
