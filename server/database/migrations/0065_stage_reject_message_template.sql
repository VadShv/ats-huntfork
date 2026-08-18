-- Спринт 22 (todo 10): org-дефолтный шаблон отказного сообщения на этапе.
-- Используется при hh-пуше в discard, если для вакансии нет явного
-- hh_stage_mapping.message_template. Приоритет:
--   mapping.message_template → pipeline_stage.reject_message_template → DEFAULT_DISCARD_MESSAGE

ALTER TABLE "pipeline_stage"
  ADD COLUMN IF NOT EXISTS "reject_message_template" text;
