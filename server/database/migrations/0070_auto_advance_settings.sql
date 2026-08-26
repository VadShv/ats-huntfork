-- 0070_auto_advance_settings
-- Добавляем настройки авто-передвижения кандидата на подэтап hm_review
-- при получении composite-score >= autoAdvanceAboveScore.
-- По аналогии с autoReject_*.

ALTER TABLE "job"
  ADD COLUMN IF NOT EXISTS "auto_advance_enabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "job"
  ADD COLUMN IF NOT EXISTS "auto_advance_above_score" integer;

ALTER TABLE "job"
  ADD COLUMN IF NOT EXISTS "auto_advance_reason_note" text;
