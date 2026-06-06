-- ─────────────────────────────────────────────
-- Дедупликация кандидатов — фундамент (Этап 1)
--
-- Концепция:
--   • organization_group — «группа компаний» (Astra Group), внутри которой кандидаты
--     считаются общими и проверяются на дубли. Несколько orgs (юрлиц) могут быть в одной группе.
--   • candidate_identity — нормализованные идентификаторы кандидата (phone E.164, email lowercase,
--     hh owner.id, linkedin slug, telegram id). Уникальны в рамках группы.
--   • candidate.merged_into_id + merge_status — soft-delete при ручном/авто слиянии.
--   • candidate_merge_log — аудит каждого слияния, с поддержкой rollback за N дней.
-- ─────────────────────────────────────────────

-- 1) Группа компаний
CREATE TABLE IF NOT EXISTS "organization_group" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "merge_strategy" text NOT NULL DEFAULT 'oldest',         -- oldest | most_complete | manual
  "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- 2) Привязка organization к группе (nullable: миграция позже backfill'нёт)
ALTER TABLE "organization"
  ADD COLUMN IF NOT EXISTS "group_id" text REFERENCES "organization_group"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "organization_group_id_idx" ON "organization" ("group_id");

-- 3) Кандидат: статус слияния + ссылка на primary
ALTER TABLE "candidate"
  ADD COLUMN IF NOT EXISTS "merge_status" text NOT NULL DEFAULT 'active',  -- active | merged
  ADD COLUMN IF NOT EXISTS "merged_into_id" text REFERENCES "candidate"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "merged_at" timestamp,
  ADD COLUMN IF NOT EXISTS "fraud_flag" boolean NOT NULL DEFAULT false;   -- для Д1: «возможно повторный после отказа»

CREATE INDEX IF NOT EXISTS "candidate_merge_status_idx" ON "candidate" ("organization_id", "merge_status");
CREATE INDEX IF NOT EXISTS "candidate_merged_into_idx" ON "candidate" ("merged_into_id") WHERE "merged_into_id" IS NOT NULL;

-- 4) Identity-таблица (мульти-ключи кандидата)
CREATE TABLE IF NOT EXISTS "candidate_identity" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "candidate_id" text NOT NULL REFERENCES "candidate"("id") ON DELETE CASCADE,
  "group_id" text REFERENCES "organization_group"("id") ON DELETE SET NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,                  -- email | phone | hh_owner | hh_resume | linkedin | telegram | manual_external
  "value_raw" text NOT NULL,             -- как пришло
  "value_normalized" text NOT NULL,      -- нормализованный ключ (для поиска)
  "confidence" text NOT NULL DEFAULT 'claimed',  -- verified | claimed | inferred
  "source" text NOT NULL,                -- hh | telegram | manual | csv | career_form | import
  "first_seen_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "candidate_identity_candidate_id_idx" ON "candidate_identity" ("candidate_id");
CREATE INDEX IF NOT EXISTS "candidate_identity_org_id_idx" ON "candidate_identity" ("organization_id");
-- Главный индекс дедупликации: ищем по (group_id, kind, value_normalized)
CREATE INDEX IF NOT EXISTS "candidate_identity_group_lookup_idx" ON "candidate_identity" ("group_id", "kind", "value_normalized");
-- Партиальный уникальный (когда group_id заполнен — пара не может повторяться):
CREATE UNIQUE INDEX IF NOT EXISTS "candidate_identity_group_unique_idx"
  ON "candidate_identity" ("group_id", "kind", "value_normalized")
  WHERE "group_id" IS NOT NULL;

-- 5) Журнал слияний (для аудита и rollback)
CREATE TABLE IF NOT EXISTS "candidate_merge_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "group_id" text REFERENCES "organization_group"("id") ON DELETE SET NULL,
  "primary_candidate_id" text NOT NULL REFERENCES "candidate"("id") ON DELETE CASCADE,
  "merged_candidate_id" text NOT NULL,         -- НЕ FK: запись остаётся даже если кандидата удалили после rollback
  "performed_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "action" text NOT NULL,                       -- merge | rollback
  "merge_kind" text NOT NULL,                   -- auto | manual
  "reason" text,                                -- произвольный комментарий рекрутёра
  "signals" jsonb NOT NULL DEFAULT '[]'::jsonb, -- какие сигналы совпали: [{kind, value, score}]
  "score" integer,                              -- общий score сходства
  "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,-- снимок состояния обоих кандидатов до слияния (для rollback)
  "rollback_until" timestamp,                   -- до когда можно откатить через UI
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "candidate_merge_log_primary_idx" ON "candidate_merge_log" ("primary_candidate_id");
CREATE INDEX IF NOT EXISTS "candidate_merge_log_merged_idx" ON "candidate_merge_log" ("merged_candidate_id");
CREATE INDEX IF NOT EXISTS "candidate_merge_log_org_idx" ON "candidate_merge_log" ("organization_id", "created_at" DESC);
