-- =====================================================
-- 0041_collaboration_thread.sql
-- Collaboration Thread: комментарии на откликах + reactions,
-- attachments, watchers, mentions, notifications
-- =====================================================

-- -----------------------------------------------------
-- application_comment
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS "application_comment" (
  "id"                TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organization_id"   TEXT        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "application_id"    TEXT        NOT NULL REFERENCES "application"("id") ON DELETE CASCADE,
  "candidate_id"      TEXT        NOT NULL REFERENCES "candidate"("id") ON DELETE CASCADE,
  "author_user_id"    TEXT        NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "body"              TEXT        NOT NULL,
  "body_html"         TEXT,
  "is_internal"       BOOLEAN     NOT NULL DEFAULT FALSE,
  "parent_comment_id" TEXT        REFERENCES "application_comment"("id") ON DELETE SET NULL,
  "edited_at"         TIMESTAMPTZ,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at"        TIMESTAMPTZ
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_app_comment_application_id"
  ON "application_comment"("application_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_app_comment_organization_id"
  ON "application_comment"("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_app_comment_author"
  ON "application_comment"("author_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_app_comment_parent"
  ON "application_comment"("parent_comment_id") WHERE "parent_comment_id" IS NOT NULL;
--> statement-breakpoint

-- -----------------------------------------------------
-- comment_mention
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS "comment_mention" (
  "id"                TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "comment_id"        TEXT        NOT NULL REFERENCES "application_comment"("id") ON DELETE CASCADE,
  "mentioned_user_id" TEXT        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "read_at"           TIMESTAMPTZ,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_comment_mention"
  ON "comment_mention"("comment_id", "mentioned_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comment_mention_user"
  ON "comment_mention"("mentioned_user_id", "read_at");
--> statement-breakpoint

-- -----------------------------------------------------
-- comment_reaction
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS "comment_reaction" (
  "id"         TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "comment_id" TEXT        NOT NULL REFERENCES "application_comment"("id") ON DELETE CASCADE,
  "user_id"    TEXT        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "emoji"      TEXT        NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_comment_reaction"
  ON "comment_reaction"("comment_id", "user_id", "emoji");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comment_reaction_comment"
  ON "comment_reaction"("comment_id");
--> statement-breakpoint

-- -----------------------------------------------------
-- comment_attachment
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS "comment_attachment" (
  "id"                  TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "comment_id"          TEXT        NOT NULL REFERENCES "application_comment"("id") ON DELETE CASCADE,
  "file_name"           TEXT        NOT NULL,
  "storage_key"         TEXT        NOT NULL,
  "mime_type"           TEXT        NOT NULL,
  "size_bytes"          INTEGER     NOT NULL,
  "uploaded_by_user_id" TEXT        NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comment_attachment_comment"
  ON "comment_attachment"("comment_id");
--> statement-breakpoint

-- -----------------------------------------------------
-- application_watcher
-- -----------------------------------------------------
CREATE TYPE "watcher_source" AS ENUM (
  'manual',
  'auto_mention',
  'auto_author',
  'auto_assignee'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "application_watcher" (
  "id"              TEXT             NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organization_id" TEXT             NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "application_id"  TEXT             NOT NULL REFERENCES "application"("id") ON DELETE CASCADE,
  "user_id"         TEXT             NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "source"          "watcher_source" NOT NULL DEFAULT 'manual',
  "created_at"      TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_watcher"
  ON "application_watcher"("application_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_app_watcher_application"
  ON "application_watcher"("application_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_app_watcher_user"
  ON "application_watcher"("user_id");
--> statement-breakpoint

-- -----------------------------------------------------
-- notification
-- -----------------------------------------------------
CREATE TYPE "notification_type" AS ENUM (
  'mention',
  'reply',
  'reaction',
  'new_comment_on_watched'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification" (
  "id"              TEXT                NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organization_id" TEXT                NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id"         TEXT                NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "type"            "notification_type" NOT NULL,
  "entity_type"     TEXT                NOT NULL,
  "entity_id"       TEXT                NOT NULL,
  "comment_id"      TEXT                REFERENCES "application_comment"("id") ON DELETE CASCADE,
  "actor_user_id"   TEXT                REFERENCES "user"("id") ON DELETE SET NULL,
  "read_at"         TIMESTAMPTZ,
  "created_at"      TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_user_unread"
  ON "notification"("user_id", "read_at") WHERE "read_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_user_created"
  ON "notification"("user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notification_organization"
  ON "notification"("organization_id");
