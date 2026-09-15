-- 0113: two-way sync support

-- Add outbound tracking to hh_negotiation
ALTER TABLE "hh_negotiation" ADD COLUMN IF NOT EXISTS "sync_direction" text NOT NULL DEFAULT 'inbound';
ALTER TABLE "hh_negotiation" ADD COLUMN IF NOT EXISTS "last_outbound_sync_at" timestamp;
ALTER TABLE "hh_negotiation" ADD COLUMN IF NOT EXISTS "last_outbound_sync_status" text;
ALTER TABLE "hh_negotiation" ADD COLUMN IF NOT EXISTS "outbound_sync_error" text;

-- Add two-way sync toggle to hh_vacancy_link
ALTER TABLE "hh_vacancy_link" ADD COLUMN IF NOT EXISTS "two_way_sync_enabled" boolean NOT NULL DEFAULT false;

-- Outbound sync queue
CREATE TABLE IF NOT EXISTS "hh_sync_queue" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "negotiation_id" text NOT NULL,
  "hh_negotiation_id" text NOT NULL,
  "action_type" text NOT NULL,
  "payload" jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "processed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "hh_sq_status_idx" ON "hh_sync_queue"("status", "created_at");
CREATE INDEX IF NOT EXISTS "hh_sq_negotiation_idx" ON "hh_sync_queue"("negotiation_id");
