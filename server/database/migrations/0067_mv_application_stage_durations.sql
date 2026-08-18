-- Спринт 23 (фундамент аналитики, М2): материализованное представление «посещения этапов».
-- Одна строка = один визит отклика на этап (первоисточник — application_stage_history,
-- который пишется единым moveApplicationStage для всех путей, включая систему и авто-отказ).
--   entered_at     — момент входа на этап (moved_at записи, где to_stage_id = этап)
--   exited_at      — момент следующего перехода отклика (NULL = кандидат сейчас на этапе)
--   duration_hours — длительность завершённого визита в часах (NULL для открытых визитов;
--                    «сейчас на этапе» считается в запросах как now() - entered_at)
--   root_stage_id  — корневой этап (подэтап схлопывается в родителя) — аналитика по корням
--   next_stage_id  — куда ушёл (для матрицы переходов from→to)
--   is_terminal_exit — уход на терминальный этап (nайм/отказ)
-- Рефреш: REFRESH MATERIALIZED VIEW CONCURRENTLY каждые 15 минут (Nitro-плагин mv-refresh).

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_application_stage_durations AS
WITH visits AS (
  SELECT
    h.id AS history_id,
    h.organization_id,
    h.application_id,
    a.candidate_id,
    a.job_id,
    ps.pipeline_id,
    h.to_stage_id AS stage_id,
    COALESCE(ps.parent_stage_id, ps.id) AS root_stage_id,
    ps.type::text AS stage_type,
    ps.bucket::text AS bucket,
    h.moved_at AS entered_at,
    LEAD(h.moved_at) OVER w AS exited_at,
    EXTRACT(EPOCH FROM (LEAD(h.moved_at) OVER w - h.moved_at)) / 3600.0 AS duration_hours,
    h.moved_by_user_id AS moved_by,
    a.source AS source,
    LEAD(h.to_stage_id) OVER w AS next_stage_id
  FROM application_stage_history h
  JOIN pipeline_stage ps ON ps.id = h.to_stage_id
  JOIN application a ON a.id = h.application_id
  WINDOW w AS (PARTITION BY h.application_id ORDER BY h.moved_at, h.id)
)
SELECT
  v.*,
  COALESCE(next_ps.is_terminal, false) AS is_terminal_exit
FROM visits v
LEFT JOIN pipeline_stage next_ps ON next_ps.id = v.next_stage_id
WITH DATA;

-- Уникальный индекс обязателен для REFRESH ... CONCURRENTLY.
-- history_id гарантированно уникален (строже, чем (application_id, stage_id, entered_at) из ТЗ —
-- защищает от коллизий при двух переходах в один и тот же момент времени).
CREATE UNIQUE INDEX IF NOT EXISTS mv_asd_history_id_uidx
  ON mv_application_stage_durations (history_id);

CREATE INDEX IF NOT EXISTS mv_asd_org_entered_idx
  ON mv_application_stage_durations (organization_id, entered_at);

CREATE INDEX IF NOT EXISTS mv_asd_job_idx
  ON mv_application_stage_durations (job_id);

CREATE INDEX IF NOT EXISTS mv_asd_root_stage_idx
  ON mv_application_stage_durations (root_stage_id);
