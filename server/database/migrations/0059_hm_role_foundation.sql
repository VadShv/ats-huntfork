-- Спринт 20.1: Фундамент роли «Нанимающий менеджер».
-- См. docs/tz-hiring-manager-role-v1.md
--
-- Содержимое:
--   1. Per-org HM-флаги на member: hm_can_view_salary, must_change_password, password_updated_at.
--   2. Таблица job_member — назначение НМ (и в будущем watcher/assignee) на вакансию.
--   3. Таблица hm_decision — решения НМ на канонической фазе `new`.
--   4. Partial unique index: одно эффективное решение на application.
--
-- Роль 'hiring_manager' регистрируется в Better Auth AC (shared/permissions.ts + server/utils/auth.ts).
-- Существующие записи member при миграции получают hm_can_view_salary=false, must_change_password=false —
-- это верно для owner/admin/member; для новых hiring_manager флаги задаются при создании учётки.

-- ── 1. Per-org HM-флаги на member ──────────────────────────────
ALTER TABLE "member"
  ADD COLUMN IF NOT EXISTS "hm_can_view_salary" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "must_change_password" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "password_updated_at" timestamp;
--> statement-breakpoint

-- ── 2. job_member ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "job_member" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"job_id" text NOT NULL,
	"user_id" text NOT NULL,
	"member_role" text NOT NULL,
	"added_by_user_id" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "job_member"
  ADD CONSTRAINT "job_member_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "job_member"
  ADD CONSTRAINT "job_member_job_id_job_id_fk"
  FOREIGN KEY ("job_id") REFERENCES "public"."job"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "job_member"
  ADD CONSTRAINT "job_member_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "job_member"
  ADD CONSTRAINT "job_member_added_by_user_id_user_id_fk"
  FOREIGN KEY ("added_by_user_id") REFERENCES "public"."user"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_job_member_job_user_role"
  ON "job_member" ("job_id", "user_id", "member_role");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_job_member_user"
  ON "job_member" ("user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_job_member_job"
  ON "job_member" ("job_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_job_member_org"
  ON "job_member" ("organization_id");
--> statement-breakpoint

-- ── 3. hm_decision ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "hm_decision" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"organization_id" text NOT NULL,
	"application_id" text NOT NULL,
	"job_id" text NOT NULL,
	"hm_user_id" text NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"cancel_reason" text,
	"is_effective" boolean DEFAULT true NOT NULL,
	CONSTRAINT "hm_decision_decision_check" CHECK ("decision" IN ('approved', 'rejected'))
);
--> statement-breakpoint

ALTER TABLE "hm_decision"
  ADD CONSTRAINT "hm_decision_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "hm_decision"
  ADD CONSTRAINT "hm_decision_application_id_application_id_fk"
  FOREIGN KEY ("application_id") REFERENCES "public"."application"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "hm_decision"
  ADD CONSTRAINT "hm_decision_job_id_job_id_fk"
  FOREIGN KEY ("job_id") REFERENCES "public"."job"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "hm_decision"
  ADD CONSTRAINT "hm_decision_hm_user_id_user_id_fk"
  FOREIGN KEY ("hm_user_id") REFERENCES "public"."user"("id")
  ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "hm_decision"
  ADD CONSTRAINT "hm_decision_cancelled_by_user_id_user_id_fk"
  FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."user"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_hm_decision_application"
  ON "hm_decision" ("application_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_hm_decision_hm_user"
  ON "hm_decision" ("hm_user_id", "decided_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_hm_decision_org"
  ON "hm_decision" ("organization_id");
--> statement-breakpoint

-- ── 4. Partial unique index: одно эффективное решение на application ─────
-- Ключевой инвариант first-decision-wins.
-- Атомарно предотвращает гонку двух НМ.
CREATE UNIQUE INDEX IF NOT EXISTS "ux_hm_decisions_effective_per_app"
  ON "hm_decision" ("application_id")
  WHERE "is_effective" = true AND "cancelled_at" IS NULL;
