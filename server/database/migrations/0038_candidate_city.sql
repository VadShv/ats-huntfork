-- ─────────────────────────────────────────────────────────────────────────────
-- 0038: Колонка candidate.city (Sprint 3.3, P2.2)
--
-- Для manual-кандидатов (без hh_resume_raw) нужно явное поле «Город» в форме,
-- чтобы fuzzy-сравнение по городу работало.
-- Для hh-кандидатов колонка может быть пустой — fuzzy-матчер всё ещё
-- использует hh_resume_raw.area.name через extractCityFromHhRaw как fallback.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "city" text;

-- Лёгкий индекс по lower(city) для возможной фильтрации по городу в дашборде.
-- Используем text_pattern_ops для prefix-LIKE.
CREATE INDEX IF NOT EXISTS "candidate_org_lower_city_idx"
  ON "candidate" ("organization_id", lower("city") text_pattern_ops)
  WHERE "city" IS NOT NULL AND "merge_status" = 'active';
