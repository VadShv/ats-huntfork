-- Спринт 23 (фундамент аналитики, O3): опциональные SLA-настройки этапа.
-- sla_days — целевой срок нахождения кандидата на этапе (дней). NULL = SLA не задан,
--   тогда «Замедления сейчас» считаются по p90 длительности этапа за 90 дней.
-- sla_alert_days — порог «жёлтой зоны» (предупреждение до нарушения SLA). NULL = не задан.
-- Дефолтов в сиде НЕТ (решение O3): оба поля заполняются вручную в настройках воронки.

ALTER TABLE "pipeline_stage"
  ADD COLUMN IF NOT EXISTS "sla_days" integer;

ALTER TABLE "pipeline_stage"
  ADD COLUMN IF NOT EXISTS "sla_alert_days" integer;
