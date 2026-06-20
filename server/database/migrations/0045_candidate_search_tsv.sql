-- 0045_candidate_search_tsv.sql
-- Full-text поиск кандидатов по содержимому резюме (Sprint 11).
--
-- Зачем: чат-ассистент (search_candidates) должен находить кандидатов по
-- навыкам ("Python", "React"), должностям, городам — а не только по
-- ФИО/email. Иначе модель присылает пустой query и получает Zod-ошибку.
--
-- Дизайн:
--   • Колонка candidate.search_tsv (tsvector) хранит конкатенированный
--     текст: ФИО + email + phone + city + текст всех резюме кандидата
--     (document.parsedContent.text + hh_resume_raw как JSON в виде текста).
--   • Конфигурация — 'simple': без стемминга, безопасно для смешанных RU/EN
--     текстов и технических терминов (Python остаётся Python, React — React).
--   • GIN-индекс для быстрого поиска через @@ to_tsquery / plainto_tsquery.
--   • Композитный индекс (organization_id, search_tsv) чтобы поиск всегда
--     был org-scoped и не плодился false-positive из чужих орг.
--   • Без триггера: tsvector заполняется явно из application-кода в
--     refreshCandidateSearchTsv(). Это безопаснее (один источник правды,
--     один путь обновления), хотя для существующих кандидатов нужен
--     backfill через /api/admin/backfill-candidate-search-tsv.

ALTER TABLE "candidate"
  ADD COLUMN IF NOT EXISTS "search_tsv" tsvector;

-- GIN-индекс для @@ запросов. org_id отдельным фильтром в WHERE — composite
-- (btree+gin) в одном индексе требует extension btree_gin, который не всегда
-- доступен; делаем два индекса для гибкости.
CREATE INDEX IF NOT EXISTS "candidate_search_tsv_idx"
  ON "candidate" USING GIN ("search_tsv");

-- Composite index для быстрой связки org_id + наличие tsv.
-- Используется в плане после фильтрации по GIN.
CREATE INDEX IF NOT EXISTS "candidate_org_search_tsv_idx"
  ON "candidate" ("organization_id")
  WHERE "search_tsv" IS NOT NULL;
