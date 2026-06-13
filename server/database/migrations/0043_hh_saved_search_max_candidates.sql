-- 0043_hh_saved_search_max_candidates.sql
-- Добавляем лимит — сколько максимум кандидатов может набрать поиск.
-- При достижении лимита воркер перестаёт добавлять новых (старых не трогает).
ALTER TABLE "hh_saved_search"
  ADD COLUMN IF NOT EXISTS "max_candidates" integer NOT NULL DEFAULT 200;
