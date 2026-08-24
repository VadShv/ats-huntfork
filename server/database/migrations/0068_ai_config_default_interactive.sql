-- П2 (Sidekick, ускорение ИИ): назначение «интерактивного» конфига ИИ.
-- is_default_interactive — конфиг для быстрых задач панели Sidekick
--   (саммари, чат, верификация, карточка интервью). NULL-семантики нет:
--   false по умолчанию; пока флаг не выставлен ни у одной строки,
--   loadAiConfig прозрачно падает обратно на дефолт «анализа» — поведение
--   системы не меняется.
-- Частичный уникальный индекс — не более одного интерактивного дефолта на организацию
--   (та же схема, что ai_config_default_chatbot_idx / ai_config_default_analysis_idx).

ALTER TABLE "ai_config"
  ADD COLUMN IF NOT EXISTS "is_default_interactive" boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "ai_config_default_interactive_idx"
  ON "ai_config" ("organization_id")
  WHERE "is_default_interactive" = true;
