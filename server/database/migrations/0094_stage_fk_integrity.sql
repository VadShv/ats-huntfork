-- Migration 0094 (C2): целостность ссылок на этапы воронки при удалении этапа.
--
-- Проблемы, которые закрываем:
--   1. application.current_stage_id ON DELETE SET NULL — удаление этапа тихо обнуляло
--      позицию всех откликов на нём (массовый рассинхрон, проваливание на legacy status).
--   2. application_stage_history.to_stage_id NOT NULL + ON DELETE CASCADE — удаление этапа
--      стирало строки истории переходов → безвозвратные дыры в аналитике (MV).
--
-- Решение:
--   • current_stage_id → NO ACTION DEFERRABLE INITIALLY DEFERRED: нельзя удалить этап
--     с активными откликами (проверка на COMMIT). DEFERRABLE не ломает каскадное удаление
--     организации: к моменту COMMIT каскад уже удалил application-строки.
--   • to_stage_id → nullable + ON DELETE SET NULL: история переходов сохраняется, ссылка
--     на удалённый этап обнуляется. MV переписан на LEFT JOIN для NULL-безопасности.

-- ── 1. application_stage_history.to_stage_id: снять NOT NULL ──
ALTER TABLE "application_stage_history"
  ALTER COLUMN "to_stage_id" DROP NOT NULL;--> statement-breakpoint

-- ── 2. to_stage_id FK: CASCADE → SET NULL ──
ALTER TABLE "application_stage_history"
  DROP CONSTRAINT IF EXISTS "application_stage_history_to_stage_id_pipeline_stage_id_fk";--> statement-breakpoint
ALTER TABLE "application_stage_history"
  ADD CONSTRAINT "application_stage_history_to_stage_id_pipeline_stage_id_fk"
  FOREIGN KEY ("to_stage_id") REFERENCES "public"."pipeline_stage"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;--> statement-breakpoint

-- ── 3. application.current_stage_id FK: SET NULL → NO ACTION DEFERRABLE ──
ALTER TABLE "application"
  DROP CONSTRAINT IF EXISTS "application_current_stage_id_pipeline_stage_id_fk";--> statement-breakpoint
ALTER TABLE "application"
  ADD CONSTRAINT "application_current_stage_id_pipeline_stage_id_fk"
  FOREIGN KEY ("current_stage_id") REFERENCES "public"."pipeline_stage"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- ── 4. Пересоздать MV mv_application_stage_durations с LEFT JOIN на to_stage_id ──
-- Матвью нельзя ALTER — дропаем и создаём заново (индексы тоже).
DROP MATERIALIZED VIEW IF EXISTS mv_application_stage_durations;--> statement-breakpoint

CREATE MATERIALIZED VIEW mv_application_stage_durations AS
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
  -- C2: LEFT JOIN — строки истории с обнулённым to_stage_id (удалённый этап) сохраняются,
  -- но не участвуют в этапной аналитике (stage_id/type/bucket = NULL).
  LEFT JOIN pipeline_stage ps ON ps.id = h.to_stage_id
  JOIN application a ON a.id = h.application_id
  WINDOW w AS (PARTITION BY h.application_id ORDER BY h.moved_at, h.id)
)
SELECT
  v.*,
  COALESCE(next_ps.is_terminal, false) AS is_terminal_exit
FROM visits v
LEFT JOIN pipeline_stage next_ps ON next_ps.id = v.next_stage_id
-- Строки с NULL stage_id (этап удалён) исключаем из аналитики визитов,
-- но сама история перехода в application_stage_history сохранена.
WHERE v.stage_id IS NOT NULL
WITH DATA;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS mv_asd_history_id_uidx
  ON mv_application_stage_durations (history_id);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS mv_asd_org_entered_idx
  ON mv_application_stage_durations (organization_id, entered_at);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS mv_asd_job_idx
  ON mv_application_stage_durations (job_id);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS mv_asd_root_stage_idx
  ON mv_application_stage_durations (root_stage_id);
