-- ─────────────────────────────────────────────────────────────────────────────
-- 0040: AI-арбитр для fuzzy-пар дублей (Sprint 5.2, P5.2)
--
-- Хранит вердикт AI-арбитра по подозрительной паре кандидатов:
-- same | different | unsure (NULL = ещё не проверяли).
-- Используется для спорных пар (fuzzy score 85-94), чтобы предложить
-- рекрутеру второе мнение от модели.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "candidate_duplicate_candidate"
  ADD COLUMN IF NOT EXISTS "ai_verdict" text,
  ADD COLUMN IF NOT EXISTS "ai_confidence" integer,
  ADD COLUMN IF NOT EXISTS "ai_reasoning" text,
  ADD COLUMN IF NOT EXISTS "ai_checked_at" timestamp,
  ADD COLUMN IF NOT EXISTS "ai_usage_input_tokens" integer,
  ADD COLUMN IF NOT EXISTS "ai_usage_output_tokens" integer;

-- Частичный индекс для очереди арбитража (только pending без вердикта).
CREATE INDEX IF NOT EXISTS "candidate_duplicate_ai_pending_idx"
  ON "candidate_duplicate_candidate" ("status", "score")
  WHERE "ai_verdict" IS NULL AND "status" = 'pending';
