-- 0110: bulk action tracking
CREATE TABLE IF NOT EXISTS "hh_bulk_action" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "initiated_by_user_id" text REFERENCES "user"("id") ON DELETE set null,
  "action_type" text NOT NULL,
  "target_type" text NOT NULL,
  "item_ids" text[],
  "filter" jsonb,
  "params" jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "total_items" integer NOT NULL DEFAULT 0,
  "processed_items" integer NOT NULL DEFAULT 0,
  "succeeded_items" integer NOT NULL DEFAULT 0,
  "failed_items" integer NOT NULL DEFAULT 0,
  "results" jsonb,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hh_ba_org_status_idx" ON "hh_bulk_action"("organization_id", "status");
