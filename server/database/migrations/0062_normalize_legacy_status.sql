-- Спринт 22 (M2): нормализация legacy application.status из currentStageId.
-- Ранее часть путей (авто-отказ до Спринта 16, ручные ходы по custom-этапам)
-- могла оставлять status рассинхронизированным с этапом воронки.
-- Правило: status = проекция типа этапа (custom-подэтап → тип корневого родителя).
UPDATE application a
SET status = mapped.status::application_status,
    updated_at = now()
FROM (
  SELECT
    s.id AS stage_id,
    CASE (CASE WHEN s.type::text = 'custom' AND p.type IS NOT NULL THEN p.type::text ELSE s.type::text END)
      WHEN 'hired' THEN 'hired'
      WHEN 'offer' THEN 'offer'
      WHEN 'interview' THEN 'interview'
      WHEN 'screening' THEN 'screening'
      WHEN 'applied' THEN 'new'
      WHEN 'new' THEN 'new'
      WHEN 'on_hold' THEN 'screening'
      WHEN 'contact' THEN 'screening'
      WHEN 'assessment' THEN 'screening'
      WHEN 'rejected' THEN 'rejected'
      WHEN 'not_fit' THEN 'rejected'
      WHEN 'withdrawn' THEN 'rejected'
      WHEN 'no_show' THEN 'rejected'
      WHEN 'job_closed' THEN 'rejected'
      WHEN 'transferred' THEN 'rejected'
      ELSE NULL
    END AS status
  FROM pipeline_stage s
  LEFT JOIN pipeline_stage p ON p.id = s.parent_stage_id
) mapped
WHERE a.current_stage_id = mapped.stage_id
  AND mapped.status IS NOT NULL
  AND a.status::text IS DISTINCT FROM mapped.status;
