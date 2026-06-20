-- 0044_auto_reject_by_ai_score.sql
-- Авто-отклонение кандидатов по AI-скору + защитный флаг manualReviewOnly у кандидата
-- + флаг "требует ручной проверки" у заявки (когда AI не уверен в скоринге).
--
-- Поля настройки правила на уровне вакансии:
--   auto_reject_enabled       — включено ли правило для конкретной вакансии
--   auto_reject_below_score   — порог: если score < этого значения → авто-отказ
--   auto_reject_reason_note   — опциональный комментарий рекрутера в карточке отклонения
--
-- Поле защиты кандидата:
--   manual_review_only        — VIP-флаг: всегда обрабатывать вручную, никакие авто-правила не применяются
--
-- Поле состояния заявки:
--   needs_manual_review       — взведено, если score ниже порога, но composite confidence < 50%
--                                 (AI не уверен → не отклоняем, подсвечиваем рекрутеру)

ALTER TABLE "job"
  ADD COLUMN IF NOT EXISTS "auto_reject_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "auto_reject_below_score" integer,
  ADD COLUMN IF NOT EXISTS "auto_reject_reason_note" text;

ALTER TABLE "candidate"
  ADD COLUMN IF NOT EXISTS "manual_review_only" boolean NOT NULL DEFAULT false;

ALTER TABLE "application"
  ADD COLUMN IF NOT EXISTS "needs_manual_review" boolean NOT NULL DEFAULT false;

-- Композитный частичный индекс: быстрый фильтр "Только требующие проверки" в рамках организации.
CREATE INDEX IF NOT EXISTS "application_needs_manual_review_idx"
  ON "application" ("organization_id", "needs_manual_review")
  WHERE "needs_manual_review" = true;
