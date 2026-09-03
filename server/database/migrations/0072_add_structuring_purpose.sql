ALTER TABLE "ai_config" ADD COLUMN "is_default_structuring" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_config_default_structuring_idx" ON "ai_config" ("organization_id") WHERE "is_default_structuring" = true;--> statement-breakpoint
