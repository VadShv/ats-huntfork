-- Migration 0048: Pipeline model 1-to-1 с hh.ru/Talantix
--
-- Расширяет модель воронок для поддержки:
--   1. Канонические этапы 1-в-1 с hh.ru (Неразобранные / Подумать / Первичный контакт /
--      Скрининг / Тестовое / Собеседование / Оффер / Выход на работу / 5 отказных)
--   2. Bucket «В работе» vs «Отказы» для UI-разделения
--   3. Подстатусы (parent_stage_id) — 1 уровень иерархии, как «Звонок/Мессенджер» под «Первичным контактом»
--   4. isSystemStage — read-only базовые этапы в системных воронках
--   5. isHidden — скрытие системного этапа без удаления
--   6. job.pipeline_snapshot_json — per-vacancy кастомизация без изменения материнской воронки
--
-- Data migration:
--   • Все существующие pipeline_stage получают bucket по каноническому маппингу типов
--   • Стадии в системных воронках (pipeline.is_system=true) помечаются is_system_stage=true
--
-- Legacy типы (applied, screening с текущей семантикой, rejected) сохранены в enum
-- для retro-совместимости. Новые сиды используют новые типы.

-- ── 1. Расширение enum pipeline_stage_type новыми значениями ──
-- PostgreSQL требует ADD VALUE вне транзакции, но drizzle-kit migrate использует одну транзакцию
-- на всю миграцию. ALTER TYPE ADD VALUE поддерживается внутри транзакции с PG 12+, но новые значения
-- НЕ доступны до COMMIT. Мы не используем их в этой же миграции (data migration работает со старыми),
-- поэтому это безопасно.

ALTER TYPE "public"."pipeline_stage_type" ADD VALUE IF NOT EXISTS 'new';--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage_type" ADD VALUE IF NOT EXISTS 'on_hold';--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage_type" ADD VALUE IF NOT EXISTS 'contact';--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage_type" ADD VALUE IF NOT EXISTS 'assessment';--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage_type" ADD VALUE IF NOT EXISTS 'not_fit';--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage_type" ADD VALUE IF NOT EXISTS 'withdrawn';--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage_type" ADD VALUE IF NOT EXISTS 'no_show';--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage_type" ADD VALUE IF NOT EXISTS 'job_closed';--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage_type" ADD VALUE IF NOT EXISTS 'transferred';--> statement-breakpoint

-- ── 2. Новый enum для bucket ──
DO $$ BEGIN
    CREATE TYPE "public"."stage_bucket" AS ENUM('working', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- ── 3. Новые колонки в pipeline_stage ──
ALTER TABLE "pipeline_stage"
    ADD COLUMN IF NOT EXISTS "bucket" "stage_bucket" NOT NULL DEFAULT 'working';--> statement-breakpoint

ALTER TABLE "pipeline_stage"
    ADD COLUMN IF NOT EXISTS "is_system_stage" boolean NOT NULL DEFAULT false;--> statement-breakpoint

ALTER TABLE "pipeline_stage"
    ADD COLUMN IF NOT EXISTS "is_hidden" boolean NOT NULL DEFAULT false;--> statement-breakpoint

ALTER TABLE "pipeline_stage"
    ADD COLUMN IF NOT EXISTS "parent_stage_id" text;--> statement-breakpoint

-- Note: parent_stage_id намеренно без FK constraint — самореференс на ту же таблицу
-- часто вызывает проблемы с cascade-delete. Валидация ссылок делается на уровне приложения.

-- ── 4. Новая колонка в job ──
ALTER TABLE "job"
    ADD COLUMN IF NOT EXISTS "pipeline_snapshot_json" jsonb;--> statement-breakpoint

-- ── 5. Индексы ──
CREATE INDEX IF NOT EXISTS "pipeline_stage_parent_id_idx"
    ON "pipeline_stage" ("parent_stage_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "pipeline_stage_bucket_idx"
    ON "pipeline_stage" ("pipeline_id", "bucket", "display_order");--> statement-breakpoint

-- ── 6. Data migration: заполняем bucket и is_system_stage для существующих строк ──
-- rejected-типы → bucket='rejected', остальные → 'working' (уже default)
UPDATE "pipeline_stage"
   SET "bucket" = 'rejected'
 WHERE "type" IN ('rejected');--> statement-breakpoint

-- Помечаем все этапы в системных воронках как системные (read-only)
UPDATE "pipeline_stage" ps
   SET "is_system_stage" = true
  FROM "pipeline" p
 WHERE ps."pipeline_id" = p."id"
   AND p."is_system" = true;--> statement-breakpoint
