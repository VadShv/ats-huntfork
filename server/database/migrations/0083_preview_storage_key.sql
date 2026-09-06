ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "preview_storage_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_preview_storage_key_unique" ON "document" ("preview_storage_key") WHERE "preview_storage_key" IS NOT NULL;
