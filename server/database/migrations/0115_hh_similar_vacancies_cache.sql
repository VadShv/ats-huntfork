-- 0115: hh.ru similar-vacancies search cache (TTL ~1h)

CREATE TABLE IF NOT EXISTS "hh_similar_vacancies_cache" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "resume_hash" text NOT NULL,
  "results" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS "hh_svc_org_hash_idx" ON "hh_similar_vacancies_cache"("organization_id", "resume_hash");
