-- RBAC v2 §1 — HRBP org-scope assignments.
-- Many-to-many: member (HRBP) ↔ company OR department. Scope is derived from
-- these rows. Exactly one of company_id / department_id per row.

CREATE TABLE IF NOT EXISTS "org_scope_assignment" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "member_id" text NOT NULL REFERENCES "member"("id") ON DELETE CASCADE,
  "company_id" text REFERENCES "company"("id") ON DELETE CASCADE,
  "department_id" text REFERENCES "department"("id") ON DELETE CASCADE,
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "org_scope_assignment_target_chk"
    CHECK (("company_id" IS NOT NULL) <> ("department_id" IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS "org_scope_assignment_member_idx" ON "org_scope_assignment" ("member_id");
CREATE INDEX IF NOT EXISTS "org_scope_assignment_org_idx" ON "org_scope_assignment" ("organization_id");
CREATE INDEX IF NOT EXISTS "org_scope_assignment_company_idx" ON "org_scope_assignment" ("company_id");
CREATE INDEX IF NOT EXISTS "org_scope_assignment_department_idx" ON "org_scope_assignment" ("department_id");
CREATE UNIQUE INDEX IF NOT EXISTS "org_scope_assignment_member_company_uq"
  ON "org_scope_assignment" ("member_id", "company_id") WHERE "company_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "org_scope_assignment_member_department_uq"
  ON "org_scope_assignment" ("member_id", "department_id") WHERE "department_id" IS NOT NULL;
