-- ─────────────────────────────────────────────
-- candidate: храним сырой payload резюме с hh.ru + AI-саммари
-- - hh_resume_id        : "родной" id резюме на hh (последний пришедший)
-- - hh_resume_raw       : полный JSON resume с hh (для красивого рендеринга UI и PDF)
-- - hh_resume_fetched_at: когда последний раз обновили snapshot
-- - ai_summary          : короткое резюме от модели (3-5 строк)
-- - ai_summary_at       : когда сгенерировано
-- ─────────────────────────────────────────────

ALTER TABLE "candidate"
  ADD COLUMN IF NOT EXISTS "hh_resume_id" text,
  ADD COLUMN IF NOT EXISTS "hh_resume_raw" jsonb,
  ADD COLUMN IF NOT EXISTS "hh_resume_fetched_at" timestamp,
  ADD COLUMN IF NOT EXISTS "ai_summary" text,
  ADD COLUMN IF NOT EXISTS "ai_summary_at" timestamp;

CREATE INDEX IF NOT EXISTS "candidate_hh_resume_id_idx" ON "candidate" ("organization_id", "hh_resume_id");
