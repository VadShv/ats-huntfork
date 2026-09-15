-- 0108: hh.ru auto-respond rules + vacancy link toggle

-- Auto-respond rules table
CREATE TABLE IF NOT EXISTS "hh_auto_respond_rule" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE set null,
  "name" text NOT NULL,
  "trigger_collection" text NOT NULL,
  "trigger_delay_minutes" integer NOT NULL DEFAULT 0,
  "condition" jsonb,
  "message_template" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "priority" integer NOT NULL DEFAULT 100,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hh_ar_org_active_idx" ON "hh_auto_respond_rule"("organization_id", "is_active");

-- Add autoRespondEnabled to hh_vacancy_link
ALTER TABLE "hh_vacancy_link" ADD COLUMN IF NOT EXISTS "auto_respond_enabled" boolean NOT NULL DEFAULT false;
