-- 0047_candidate_name_trgm.sql
-- Sprint 4: pg_trgm fuzzy fallback по ФИО кандидатов.
--
-- Зачем:
--   • Основной FTS (Sprint 2, russian config) отлично находит точные совпадения
--     и словоформы, но НЕ ловит опечатки в ФИО:
--       «Слусарэнко» (вместо «Слусаренко») → 0 результатов
--       «Чичинина»   (вместо «Чиченина»)   → 0 результатов
--   • pg_trgm даёт триграммный similarity, который устойчив к опечаткам.
--   • Используем как fallback ТОЛЬКО когда основной FTS вернул мало результатов
--     (<5) — чтобы не платить за trgm в каждом запросе.
--
-- Дизайн:
--   • Индексируем нормализованную конкатенацию ФИО:
--       lower(first_name || ' ' || last_name || ' ' || display_name)
--     coalesce(...,'') чтобы NULL поля не ломали выражение.
--   • GIN + gin_trgm_ops — стандарт для % оператора и similarity().
--   • IF NOT EXISTS на extension и индекс — миграция идемпотентна.
--   • НЕ включаем aiSummary/notes/resume в trgm — там слишком много шума
--     (упоминание ≠ владение). Только ФИО.
--
-- Производительность:
--   • Индекс ~5-10MB на 100k кандидатов (триграммы ФИО короткие).
--   • Запрос с `text % $q` использует индекс, ~5-20ms на 100k строках.
--   • Применяется только при q.length >= 3 и data.length < 5 — частота низкая.
--
-- Откат: DROP INDEX idx_candidate_name_trgm; DROP EXTENSION pg_trgm;
--        (extension не дропаем, может использоваться в будущих миграциях).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "idx_candidate_name_trgm"
  ON "candidate"
  USING GIN (
    (
      lower(
        coalesce("first_name", '') || ' ' ||
        coalesce("last_name",  '') || ' ' ||
        coalesce("display_name", '')
      )
    ) gin_trgm_ops
  );
