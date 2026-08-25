-- ТЗ hm-review-substage (П1): подэтап «На рассмотрении» — очередь нанимающего менеджера.
-- 1. Колонка preset_key — machine-readable ключ этапа из сидливаемого пресета.
-- 2. Бэкфилл ключей в системных воронках («Стандартный hh.ru», «Простой») по имени+типу.
-- 3. Вставка подэтапа «На рассмотрении» (hm_review) под корень «Все неразобранные»
--    во все воронки, где есть unsorted и ещё нет hm_review.
-- Кандидатов НЕ перемещаем: очередь НМ стартует пустой. Id существующих этапов не меняются —
-- заявки и hh-маппинги не затрагиваются. Импорт с hh.ru не страдает (entry stage = корень).

ALTER TABLE "pipeline_stage" ADD COLUMN IF NOT EXISTS "preset_key" text;

CREATE UNIQUE INDEX IF NOT EXISTS "ux_pipeline_stage_preset_key"
  ON "pipeline_stage" ("pipeline_id", "preset_key")
  WHERE "preset_key" IS NOT NULL;

-- ── Бэкфилл: «Стандартный hh.ru», корневые этапы ──────────────────────────────
WITH cand AS (
  SELECT s.id, m.key,
         row_number() OVER (PARTITION BY s.pipeline_id, m.key ORDER BY s.display_order, s.created_at) AS rn
  FROM pipeline_stage s
  JOIN pipeline p ON p.id = s.pipeline_id
  JOIN (VALUES
    ('Все неразобранные',   'new',        'unsorted'),
    ('Подумать',            'on_hold',    'onhold'),
    ('Первичный контакт',   'contact',    'contact'),
    ('Тестовое задание',    'assessment', 'test'),
    ('Интервью',            'interview',  'interview'),
    ('Предложение о работе','offer',      'offer'),
    ('Выход на работу',     'hired',      'hired'),
    ('Отказ',               'rejected',   'reject')
  ) AS m(stage_name, stage_type, key)
    ON s.name = m.stage_name AND s.type::text = m.stage_type
  WHERE p.is_system = true
    AND p.name = 'Стандартный hh.ru'
    AND s.is_system_stage = true
    AND s.parent_stage_id IS NULL
    AND s.preset_key IS NULL
)
UPDATE pipeline_stage s
SET preset_key = cand.key, updated_at = now()
FROM cand
WHERE s.id = cand.id AND cand.rn = 1;

-- ── Бэкфилл: «Стандартный hh.ru», подэтапы (матчинг по имени родителя) ────────
WITH cand AS (
  SELECT s.id, m.key,
         row_number() OVER (PARTITION BY s.pipeline_id, m.key ORDER BY s.display_order, s.created_at) AS rn
  FROM pipeline_stage s
  JOIN pipeline p ON p.id = s.pipeline_id
  JOIN pipeline_stage par ON par.id = s.parent_stage_id
  JOIN (VALUES
    ('Подходящие',                 'new',         'Все неразобранные', 'suitable'),
    ('Вернуться позже',            'on_hold',     'Подумать',          'later'),
    ('Звонок',                     'contact',     'Первичный контакт', 'call'),
    ('Мессенджер',                 'contact',     'Первичный контакт', 'messenger'),
    ('Связаться ещё раз',          'contact',     'Первичный контакт', 'retry'),
    ('Не подходит',                'not_fit',     'Отказ',             'notfit'),
    ('Кандидат отказался',         'withdrawn',   'Отказ',             'withdrawn'),
    ('Не выходит на связь',        'no_show',     'Отказ',             'noshow'),
    ('Вакансия закрыта',           'job_closed',  'Отказ',             'closed'),
    ('Перевод на другую вакансию', 'transferred', 'Отказ',             'transfer')
  ) AS m(stage_name, stage_type, parent_name, key)
    ON s.name = m.stage_name AND s.type::text = m.stage_type AND par.name = m.parent_name
  WHERE p.is_system = true
    AND p.name = 'Стандартный hh.ru'
    AND s.is_system_stage = true
    AND s.preset_key IS NULL
)
UPDATE pipeline_stage s
SET preset_key = cand.key, updated_at = now()
FROM cand
WHERE s.id = cand.id AND cand.rn = 1;

-- ── Бэкфилл: «Простой» пресет ─────────────────────────────────────────────────
WITH cand AS (
  SELECT s.id, m.key,
         row_number() OVER (PARTITION BY s.pipeline_id, m.key ORDER BY s.display_order, s.created_at) AS rn
  FROM pipeline_stage s
  JOIN pipeline p ON p.id = s.pipeline_id
  JOIN (VALUES
    ('Новый',    'new',       'new'),
    ('Скрининг', 'screening', 'screen'),
    ('Интервью', 'interview', 'iv'),
    ('Оффер',    'offer',     'offer'),
    ('Принят',   'hired',     'hired'),
    ('Отказ',    'not_fit',   'rej')
  ) AS m(stage_name, stage_type, key)
    ON s.name = m.stage_name AND s.type::text = m.stage_type
  WHERE p.is_system = true
    AND p.name = 'Простой'
    AND s.is_system_stage = true
    AND s.parent_stage_id IS NULL
    AND s.preset_key IS NULL
)
UPDATE pipeline_stage s
SET preset_key = cand.key, updated_at = now()
FROM cand
WHERE s.id = cand.id AND cand.rn = 1;

-- ── Вставка «На рассмотрении»: сдвиг display_order (+1 после корня unsorted) ──
-- Только в воронках, где ещё нет hm_review (идемпотентность).
UPDATE pipeline_stage s
SET display_order = s.display_order + 1, updated_at = now()
FROM pipeline_stage root
WHERE root.pipeline_id = s.pipeline_id
  AND root.preset_key = 'unsorted'
  AND s.display_order > root.display_order
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_stage h
    WHERE h.pipeline_id = root.pipeline_id AND h.preset_key = 'hm_review'
  );

INSERT INTO pipeline_stage (
  id, organization_id, pipeline_id, name, description, type, bucket, color,
  display_order, is_terminal, is_system_stage, is_hidden, is_archived,
  parent_stage_id, preset_key, created_at, updated_at
)
SELECT
  gen_random_uuid()::text,
  root.organization_id,
  root.pipeline_id,
  'На рассмотрении',
  'Очередь нанимающего менеджера: кандидаты, отправленные рекрутёром на рассмотрение',
  'new',
  'working',
  '#94a3b8',
  root.display_order + 1,
  false,
  true,
  false,
  false,
  root.id,
  'hm_review',
  now(),
  now()
FROM pipeline_stage root
WHERE root.preset_key = 'unsorted'
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_stage h
    WHERE h.pipeline_id = root.pipeline_id AND h.preset_key = 'hm_review'
  );
