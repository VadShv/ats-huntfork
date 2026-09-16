-- 0118: applicant_comments integration — switch «Обсуждение» from negotiation messages to applicant comments

-- candidate.hh_applicant_id (extracted from hh_resume_raw.owner.id)
ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "hh_applicant_id" text;
CREATE INDEX IF NOT EXISTS "candidate_hh_applicant_id_idx" ON "candidate"("hh_applicant_id");

-- application_comment: hh_comment_id (applicant_comments ID) + denormalized hh_applicant_id
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "hh_comment_id" text;
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "hh_applicant_id" text;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_app_comment_hh_comment_id" ON "application_comment"("application_id", "hh_comment_id");

-- Backfill candidate.hh_applicant_id from stored raw JSON
UPDATE "candidate"
  SET "hh_applicant_id" = ("hh_resume_raw"->'owner'->'id')::text
  WHERE "hh_resume_raw" IS NOT NULL
    AND ("hh_resume_raw"->'owner'->'id') IS NOT NULL
    AND "hh_applicant_id" IS NULL;

-- Backfill application_comment.hh_applicant_id via application → candidate join
UPDATE "application_comment" ac
  SET "hh_applicant_id" = c."hh_applicant_id"
  FROM "application" a, "candidate" c
  WHERE ac."application_id" = a."id"
    AND a."candidate_id" = c."id"
    AND c."hh_applicant_id" IS NOT NULL
    AND ac."hh_applicant_id" IS NULL;
