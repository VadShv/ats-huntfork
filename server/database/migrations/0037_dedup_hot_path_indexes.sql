-- ─────────────────────────────────────────────────────────────────────────────
-- 0037: Индексы под hot-path дедупа (Sprint 1.5 perf-фундамент)
--
-- Цели:
--   1. candidate_identity(kind, value_normalized) — для случая, когда у организации
--      НЕТ group_id (single-org). Существующий group_lookup_idx требует group_id.
--   2. candidate(organization_id, lower(last_name)) — для fuzzy pre-filter
--      `lower(last_name) LIKE 'xx%'` (substring 2 первых букв).
--   3. candidate(organization_id, merge_status, lower(last_name)) — для cross-org
--      выборки через innerJoin organizationExt в findFuzzyDuplicatesForCandidate.
--
-- Все индексы CREATE IF NOT EXISTS — миграция безопасно повторяется.
-- Используем text_pattern_ops для prefix-LIKE — обычный btree на lower() с
-- text_pattern_ops ловит запросы вида `lower(x) LIKE 'pref%'`.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Identity без group (single-org дедуп)
CREATE INDEX IF NOT EXISTS "candidate_identity_kind_value_idx"
  ON "candidate_identity" ("kind", "value_normalized");

-- 2. Fuzzy pre-filter внутри одной организации (case-insensitive prefix LIKE)
CREATE INDEX IF NOT EXISTS "candidate_org_lower_last_name_idx"
  ON "candidate" ("organization_id", lower("last_name") text_pattern_ops)
  WHERE "merge_status" = 'active';

-- 3. Fuzzy pre-filter в cross-org (через group_id, доходим join-ом).
--    Для кросс-орг случая критичен индекс на candidate(merge_status, lower(last_name))
--    без orgId — потому что планер сначала идёт через organization.group_id idx,
--    потом nested loop по candidate.
CREATE INDEX IF NOT EXISTS "candidate_active_lower_last_name_idx"
  ON "candidate" (lower("last_name") text_pattern_ops)
  WHERE "merge_status" = 'active';

-- 4. Hot-path для backlog «активные заявки»: candidate_merge_status
--    уже есть, но добавим updated_at desc для сортировки журнала.
CREATE INDEX IF NOT EXISTS "candidate_merge_log_org_created_idx"
  ON "candidate_merge_log" ("organization_id", "created_at" DESC);
-- ↑ дубль того, что в 0034, но IF NOT EXISTS делает миграцию идемпотентной.
