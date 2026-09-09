-- Центр аналитики (доработка): сохранённые пресеты фильтров пользователя.

CREATE TABLE IF NOT EXISTS "analytics_saved_view" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "filters" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "analytics_saved_view" ADD CONSTRAINT "analytics_saved_view_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "analytics_saved_view" ADD CONSTRAINT "analytics_saved_view_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "analytics_saved_view_org_user_idx" ON "analytics_saved_view" ("organization_id","user_id");
