-- 0117: Code review fixes — scope hh_message_id unique index to (application_id, hh_message_id)
--        and make similar-vacancies cache (organization_id, resume_hash) unique.

-- Fix C3: Replace global unique index on hh_message_id with (application_id, hh_message_id)
DROP INDEX IF EXISTS "idx_app_comment_hh_message_id";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_app_comment_hh_message_id"
  ON "application_comment" ("application_id", "hh_message_id");

-- Fix H9: Replace non-unique index on similar-vacancies cache with unique constraint
DROP INDEX IF EXISTS "hh_svc_org_hash_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "hh_svc_org_hash_idx"
  ON "hh_similar_vacancies_cache" ("organization_id", "resume_hash");
