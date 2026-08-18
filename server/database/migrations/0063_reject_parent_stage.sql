-- Спринт 22 (M1): системный родитель «Отказ» + группировка отказных причин.
-- Модель hh.ru: один терминальный родитель «Отказ» (type='rejected'), причины —
-- подэтапы (not_fit / withdrawn / no_show / job_closed / transferred).
-- Id существующих этапов НЕ меняются — заявки и hh-маппинги не затрагиваются.

-- Случай B: у воронки уже есть корневой этап type='rejected' И есть корневые
-- отказные причины → переиспользуем его как родителя.
UPDATE pipeline_stage parent
SET is_system_stage = true,
    is_terminal = true,
    bucket = 'rejected',
    updated_at = now()
WHERE parent.type = 'rejected'
  AND parent.parent_stage_id IS NULL
  AND parent.is_archived = false
  AND EXISTS (
    SELECT 1 FROM pipeline_stage r
    WHERE r.pipeline_id = parent.pipeline_id
      AND r.parent_stage_id IS NULL
      AND r.is_archived = false
      AND r.type IN ('not_fit', 'withdrawn', 'no_show', 'job_closed', 'transferred')
  );

-- Случай A: есть корневые отказные причины, но нет корневого 'rejected' → создаём родителя.
INSERT INTO pipeline_stage (
  id, organization_id, pipeline_id, name, description, type, bucket, color,
  display_order, is_terminal, is_system_stage, is_hidden, is_archived,
  parent_stage_id, created_at, updated_at
)
SELECT
  gen_random_uuid()::text,
  pl.organization_id,
  pl.pipeline_id,
  'Отказ',
  'Терминальный этап: причины отказа — подэтапы',
  'rejected',
  'rejected',
  '#ef4444',
  pl.max_order + 1,
  true,
  true,
  false,
  false,
  NULL,
  now(),
  now()
FROM (
  SELECT r.pipeline_id, r.organization_id, MAX(s.display_order) AS max_order
  FROM pipeline_stage r
  JOIN pipeline_stage s ON s.pipeline_id = r.pipeline_id
  WHERE r.parent_stage_id IS NULL
    AND r.is_archived = false
    AND r.type IN ('not_fit', 'withdrawn', 'no_show', 'job_closed', 'transferred')
  GROUP BY r.pipeline_id, r.organization_id
) pl
WHERE NOT EXISTS (
  SELECT 1 FROM pipeline_stage p
  WHERE p.pipeline_id = pl.pipeline_id
    AND p.type = 'rejected'
    AND p.parent_stage_id IS NULL
    AND p.is_archived = false
);

-- Перепривязка: корневые отказные причины становятся подэтапами родителя «Отказ».
UPDATE pipeline_stage r
SET parent_stage_id = p.id,
    updated_at = now()
FROM pipeline_stage p
WHERE r.pipeline_id = p.pipeline_id
  AND p.type = 'rejected'
  AND p.parent_stage_id IS NULL
  AND p.is_archived = false
  AND r.parent_stage_id IS NULL
  AND r.is_archived = false
  AND r.type IN ('not_fit', 'withdrawn', 'no_show', 'job_closed', 'transferred');

-- Per-vacancy снапшоты затеняют живую воронку (pipeline-view.get.ts) —
-- синхронизируем их: перепривязываем причины на родителя и добавляем его в список,
-- если его там ещё нет.
UPDATE job j
SET pipeline_snapshot_json = jsonb_set(
      j.pipeline_snapshot_json,
      '{stages}',
      (
        SELECT COALESCE(jsonb_agg(
                 CASE
                   WHEN st->>'parentStageId' IS NULL
                        AND st->>'type' IN ('not_fit', 'withdrawn', 'no_show', 'job_closed', 'transferred')
                     THEN jsonb_set(st, '{parentStageId}', to_jsonb(p.id))
                   ELSE st
                 END
                 ORDER BY (st->>'displayOrder')::int
               ), '[]'::jsonb)
        FROM jsonb_array_elements(j.pipeline_snapshot_json->'stages') st
      )
      ||
      CASE WHEN EXISTS (
             SELECT 1 FROM jsonb_array_elements(j.pipeline_snapshot_json->'stages') st2
             WHERE st2->>'id' = p.id
           )
        THEN '[]'::jsonb
        ELSE jsonb_build_array(jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'description', p.description,
          'type', 'rejected',
          'bucket', 'rejected',
          'color', p.color,
          'displayOrder', (
            SELECT COALESCE(MAX((st3->>'displayOrder')::int), 0) + 1
            FROM jsonb_array_elements(j.pipeline_snapshot_json->'stages') st3
          ),
          'isTerminal', true,
          'isSystemStage', true,
          'isHidden', false,
          'parentStageId', NULL
        ))
      END
    ),
    updated_at = now()
FROM pipeline_stage p
WHERE j.pipeline_snapshot_json IS NOT NULL
  AND p.pipeline_id = j.pipeline_id
  AND p.type = 'rejected'
  AND p.parent_stage_id IS NULL
  AND p.is_archived = false
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(j.pipeline_snapshot_json->'stages') st4
    WHERE st4->>'parentStageId' IS NULL
      AND st4->>'type' IN ('not_fit', 'withdrawn', 'no_show', 'job_closed', 'transferred')
  );
