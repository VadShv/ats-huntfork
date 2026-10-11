-- «Передать коллеге» в обсуждении (docs/tz-discussion-referral.md).
-- Реферал получает ссылку на отклик-источник и на системные карточки в лентах;
-- уведомление нового типа 'referral'. Аддитивно и идемпотентно.

ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'referral';--> statement-breakpoint
ALTER TABLE "referral" ADD COLUMN IF NOT EXISTS "from_application_id" text REFERENCES "application"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "referral" ADD COLUMN IF NOT EXISTS "source_comment_id" text;--> statement-breakpoint
ALTER TABLE "referral" ADD COLUMN IF NOT EXISTS "target_comment_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_candidate_idx" ON "referral" ("organization_id", "candidate_id");
