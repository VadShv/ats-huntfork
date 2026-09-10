-- Prompt Sandbox: пользовательские промпты для тестирования и экспериментов.
-- Используется разделом «Песочница промптов» в /dashboard/prompts/sandbox.

CREATE TABLE IF NOT EXISTS "prompt_sandbox" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "category" text DEFAULT 'custom' NOT NULL,
  "system_prompt" text NOT NULL,
  "user_prompt_template" text,
  "variables" jsonb,
  "ai_config_id" text REFERENCES "ai_config"("id") ON DELETE SET NULL,
  "temperature" numeric(3,2) DEFAULT '0.30',
  "model_override" text,
  "is_shared" boolean DEFAULT false NOT NULL,
  "tags" text[],
  "last_test_result" jsonb,
  "last_tested_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "prompt_sandbox_org_idx" ON "prompt_sandbox" ("organization_id");
CREATE INDEX IF NOT EXISTS "prompt_sandbox_org_user_idx" ON "prompt_sandbox" ("organization_id", "user_id");
