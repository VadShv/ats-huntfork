-- 0112: hh.ru stats snapshots — daily funnel metrics for trend charts
CREATE TABLE IF NOT EXISTS "hh_stats_snapshot" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "vacancy_link_id" text REFERENCES "hh_vacancy_link"("id") ON DELETE cascade,
  "snapshot_type" text NOT NULL,
  "total_responses" integer NOT NULL DEFAULT 0,
  "in_consider" integer NOT NULL DEFAULT 0,
  "in_interview" integer NOT NULL DEFAULT 0,
  "in_offer" integer NOT NULL DEFAULT 0,
  "hired" integer NOT NULL DEFAULT 0,
  "discarded" integer NOT NULL DEFAULT 0,
  "avg_time_to_response" integer,
  "avg_time_to_interview" integer,
  "avg_time_to_offer" integer,
  "avg_time_to_hire" integer,
  "conversion_rate" integer,
  "source_breakdown" jsonb,
  "snapshot_date" date NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hh_ss_org_date_idx" ON "hh_stats_snapshot"("organization_id", "snapshot_date");
CREATE INDEX IF NOT EXISTS "hh_ss_link_date_idx" ON "hh_stats_snapshot"("vacancy_link_id", "snapshot_date");
