-- RBAC v2 — Sprint 1 foundation.
-- DB-driven roles/permissions/scopes/overrides that replace the static
-- Better Auth AC as the source of truth for permissions.
-- See docs/rbac-v2-master-plan.md §4. Idempotent (IF NOT EXISTS) per repo style.

-- ── member extensions ───────────────────────────────────────────────
ALTER TABLE "member" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp;
ALTER TABLE "member" ADD COLUMN IF NOT EXISTS "permissions_version" integer DEFAULT 0 NOT NULL;

-- ── permission catalog ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "permission" (
  "key" text PRIMARY KEY NOT NULL,
  "resource" text NOT NULL,
  "action" text NOT NULL,
  "field_set" text,
  "ui_level" smallint DEFAULT 0 NOT NULL,
  "risk_level" smallint DEFAULT 0 NOT NULL,
  "category" text DEFAULT 'general' NOT NULL,
  "label_ru" text DEFAULT '' NOT NULL,
  "label_en" text DEFAULT '' NOT NULL,
  "hint_ru" text,
  "hint_en" text
);

-- ── roles ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "role" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "organization_id" text REFERENCES "organization"("id") ON DELETE CASCADE,
  "key" text,
  "name" text NOT NULL,
  "description" text,
  "is_system" boolean DEFAULT false NOT NULL,
  "is_assignable" boolean DEFAULT true NOT NULL,
  "default_scope" text DEFAULT 'assigned' NOT NULL,
  "color" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "role_org_idx" ON "role" ("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "role_org_name_unique_idx" ON "role" ("organization_id", "name");
-- system presets have organization_id NULL; enforce unique key among them
CREATE UNIQUE INDEX IF NOT EXISTS "role_system_key_unique_idx" ON "role" ("key") WHERE "is_system" = true;

-- ── role ↔ permission ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "role_permission" (
  "role_id" text NOT NULL REFERENCES "role"("id") ON DELETE CASCADE,
  "permission" text NOT NULL REFERENCES "permission"("key"),
  CONSTRAINT "role_permission_pk" PRIMARY KEY ("role_id", "permission")
);
CREATE INDEX IF NOT EXISTS "role_permission_role_idx" ON "role_permission" ("role_id");

-- ── versioned role permission snapshots ─────────────────────────────
CREATE TABLE IF NOT EXISTS "role_permission_version" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "role_id" text NOT NULL REFERENCES "role"("id") ON DELETE CASCADE,
  "snapshot" jsonb NOT NULL,
  "scope_snapshot" jsonb,
  "changed_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "change_note" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "role_permission_version_role_idx" ON "role_permission_version" ("role_id");

-- ── member ↔ role ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "member_role" (
  "member_id" text NOT NULL REFERENCES "member"("id") ON DELETE CASCADE,
  "role_id" text NOT NULL REFERENCES "role"("id"),
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "is_primary" boolean DEFAULT true NOT NULL,
  CONSTRAINT "member_role_pk" PRIMARY KEY ("member_id", "role_id")
);
CREATE INDEX IF NOT EXISTS "member_role_member_idx" ON "member_role" ("member_id");
CREATE INDEX IF NOT EXISTS "member_role_org_idx" ON "member_role" ("organization_id");

-- ── member scope ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "member_scope" (
  "member_id" text PRIMARY KEY REFERENCES "member"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "scope_type" text DEFAULT 'assigned' NOT NULL,
  "department_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  "job_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  "updated_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "member_scope_org_idx" ON "member_scope" ("organization_id");

-- ── per-user permission overrides (deny wins) ───────────────────────
CREATE TABLE IF NOT EXISTS "member_permission_override" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "member_id" text NOT NULL REFERENCES "member"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "permission" text NOT NULL REFERENCES "permission"("key"),
  "effect" text NOT NULL,
  "reason" text,
  "expires_at" timestamptz,
  "created_by" text NOT NULL REFERENCES "user"("id"),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "member_permission_override_effect_chk" CHECK ("effect" IN ('allow','deny'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "member_permission_override_unique_idx" ON "member_permission_override" ("member_id", "permission");
CREATE INDEX IF NOT EXISTS "member_permission_override_member_idx" ON "member_permission_override" ("member_id");
CREATE INDEX IF NOT EXISTS "member_permission_override_org_idx" ON "member_permission_override" ("organization_id");

-- ── per-role limits ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "role_limit" (
  "role_id" text PRIMARY KEY REFERENCES "role"("id") ON DELETE CASCADE,
  "contacts_per_day" integer,
  "emails_per_day" integer,
  "export_rows_max" integer,
  "bulk_action_max" integer
);
