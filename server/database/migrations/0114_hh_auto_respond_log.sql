-- 0114: hh.ru auto-respond execution log

CREATE TABLE IF NOT EXISTS "hh_auto_respond_log" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "rule_id" text REFERENCES "hh_auto_respond_rule"("id") ON DELETE set null,
  "application_id" text REFERENCES "application"("id") ON DELETE set null,
  "negotiation_id" text,
  "hh_account_id" text REFERENCES "hh_account"("id") ON DELETE cascade,
  "status" text NOT NULL,
  "message_preview" text,
  "error" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hh_arl_org_created_idx" ON "hh_auto_respond_log"("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "hh_arl_rule_idx" ON "hh_auto_respond_log"("rule_id");
CREATE INDEX IF NOT EXISTS "hh_arl_app_idx" ON "hh_auto_respond_log"("application_id");
