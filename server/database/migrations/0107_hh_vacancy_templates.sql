-- 0107: hh.ru vacancy templates — reusable vacancy drafts
-- Stores full /vacancies POST body as JSON for one-click publishing with overrides.

CREATE TABLE IF NOT EXISTS "hh_vacancy_template" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE set null,
  "name" text NOT NULL,
  "description" text,
  "vacancy_data" jsonb NOT NULL,
  "hh_area_id" text,
  "hh_prof_area" text[],
  "is_shared" boolean NOT NULL DEFAULT true,
  "last_used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hh_tpl_org_idx" ON "hh_vacancy_template"("organization_id");
CREATE INDEX IF NOT EXISTS "hh_tpl_org_shared_idx" ON "hh_vacancy_template"("organization_id", "is_shared");
