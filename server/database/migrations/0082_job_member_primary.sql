ALTER TABLE "job_member" ADD COLUMN IF NOT EXISTS "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_job_member_primary_recruiter" ON "job_member" ("job_id") WHERE ("member_role" = 'recruiter' AND "is_primary" = true);--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "job_id" ORDER BY "added_at" ASC, "id" ASC) AS rn
  FROM "job_member"
  WHERE "member_role" = 'recruiter'
)
UPDATE "job_member" jm SET "is_primary" = true
FROM ranked r
WHERE jm."id" = r."id" AND r.rn = 1;
