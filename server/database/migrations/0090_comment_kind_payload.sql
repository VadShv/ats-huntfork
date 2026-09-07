-- =====================================================
-- 0090_comment_kind_payload.sql
-- Collaboration Hub (Этап 3): pin-снимки результатов ИИ в ленте обсуждения.
-- Аддитивно: kind (NULL = обычный текстовый комментарий) + payload_json (снимок).
-- =====================================================
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "kind" text;--> statement-breakpoint
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "payload_json" jsonb;
