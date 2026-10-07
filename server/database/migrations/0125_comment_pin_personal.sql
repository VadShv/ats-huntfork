-- Личные закрепления сообщений обсуждения (docs/tz-discussion-shell.md).
-- Закрепление «для всех» остаётся в application_comment.is_pinned / pinned_at / pinned_by_id;
-- закрепление «для себя» — отдельная таблица, видна только владельцу. Аддитивно и идемпотентно.

CREATE TABLE IF NOT EXISTS "comment_pin_personal" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "application_id" text NOT NULL REFERENCES "application"("id") ON DELETE cascade,
  "comment_id" text NOT NULL REFERENCES "application_comment"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_comment_pin_personal" ON "comment_pin_personal" ("comment_id", "user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comment_pin_personal_app_user" ON "comment_pin_personal" ("application_id", "user_id");
