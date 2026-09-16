-- 0116: application_comment hh.ru sync columns

ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "hh_message_id" text;
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "hh_direction" text;
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "hh_sync_status" text NOT NULL DEFAULT 'local';
ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "hh_synced_at" timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_app_comment_hh_message_id" ON "application_comment"("hh_message_id");
