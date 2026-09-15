-- 0111: coverage gap detection
CREATE TABLE IF NOT EXISTS "hh_coverage_gap" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "vacancy_link_id" text NOT NULL REFERENCES "hh_vacancy_link"("id") ON DELETE cascade,
  "hh_negotiation_id" text NOT NULL,
  "gap_reason" text NOT NULL,
  "hh_collection" text,
  "hh_candidate_name" text,
  "hh_created_at" timestamp,
  "detected_at" timestamp NOT NULL DEFAULT now(),
  "resolved_at" timestamp
);

CREATE INDEX IF NOT EXISTS "hh_cg_link_idx" ON "hh_coverage_gap"("vacancy_link_id");
CREATE INDEX IF NOT EXISTS "hh_cg_org_unresolved_idx" ON "hh_coverage_gap"("organization_id", "resolved_at");
