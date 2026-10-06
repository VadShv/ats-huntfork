-- Учёт и аналитика расхода ИИ — docs/tz-ai-usage.md §4, §11
-- Журнал вызовов модели, настройки валюты/курса, бюджеты и пороги.
-- Аддитивно + идемпотентно. Backfill истории из analysis_run, resume_risk,
-- meeting_report, candidate_duplicate_candidate (is_backfilled = true).

-- ── ai_config: валюта и цена кэша ─────────────────────────────────

ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "cached_input_price_per_1m" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN IF NOT EXISTS "price_currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint

-- ── Уведомление о бюджете ─────────────────────────────────────────

ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'ai_budget';--> statement-breakpoint

-- ── ai_usage_event ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ai_usage_event" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "trace_id" text NOT NULL,
  "step_no" smallint DEFAULT 1 NOT NULL,
  "operation" text NOT NULL,
  "feature" text NOT NULL,
  "trigger" text DEFAULT 'user' NOT NULL,
  "source" text,
  "user_id" text REFERENCES "user"("id") ON DELETE set null,
  "job_id" text REFERENCES "job"("id") ON DELETE set null,
  "entity_type" text,
  "entity_id" text,
  "ai_config_id" text REFERENCES "ai_config"("id") ON DELETE set null,
  "ai_config_name" text,
  "purpose" text,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "response_model" text,
  "mode" text DEFAULT 'generate' NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "cached_input_tokens" integer DEFAULT 0 NOT NULL,
  "cache_write_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "reasoning_tokens" integer DEFAULT 0 NOT NULL,
  "tokens_estimated" boolean DEFAULT false NOT NULL,
  "prompt_chars" integer,
  "completion_chars" integer,
  "system_prompt_hash" text,
  "duration_ms" integer,
  "ttft_ms" integer,
  "status" text DEFAULT 'ok' NOT NULL,
  "error_code" text,
  "error_message" text,
  "finish_reason" text,
  "price_currency" text DEFAULT 'USD' NOT NULL,
  "input_price_per_1m" numeric(12, 4),
  "cached_input_price_per_1m" numeric(12, 4),
  "output_price_per_1m" numeric(12, 4),
  "cost" numeric(14, 6),
  "cost_base" numeric(14, 6),
  "base_currency" text DEFAULT 'RUB' NOT NULL,
  "fx_rate" numeric(12, 6),
  "is_backfilled" boolean DEFAULT false NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_usage_event_org_created_idx" ON "ai_usage_event" ("organization_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_event_org_feature_idx" ON "ai_usage_event" ("organization_id", "feature", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_event_org_operation_idx" ON "ai_usage_event" ("organization_id", "operation", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_event_org_job_idx" ON "ai_usage_event" ("organization_id", "job_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_event_org_user_idx" ON "ai_usage_event" ("organization_id", "user_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_event_trace_idx" ON "ai_usage_event" ("trace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_event_entity_idx" ON "ai_usage_event" ("organization_id", "entity_type", "entity_id");--> statement-breakpoint

-- ── ai_usage_settings ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ai_usage_settings" (
  "organization_id" text PRIMARY KEY NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "base_currency" text DEFAULT 'RUB' NOT NULL,
  "usd_rub_rate" numeric(12, 4),
  "rate_updated_at" timestamp,
  "retention_days" integer DEFAULT 400 NOT NULL,
  "updated_by_id" text REFERENCES "user"("id") ON DELETE set null,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- ── ai_usage_budget ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ai_usage_budget" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "scope" text DEFAULT 'org' NOT NULL,
  "scope_key" text,
  "period" text DEFAULT 'month' NOT NULL,
  "limit_amount" numeric(14, 2) NOT NULL,
  "currency" text DEFAULT 'RUB' NOT NULL,
  "thresholds" jsonb DEFAULT '[50,80,100]'::jsonb NOT NULL,
  "on_exceed" text DEFAULT 'notify' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_id" text REFERENCES "user"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_usage_budget_org_idx" ON "ai_usage_budget" ("organization_id");--> statement-breakpoint

-- ── ai_usage_alert ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ai_usage_alert" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "budget_id" text NOT NULL REFERENCES "ai_usage_budget"("id") ON DELETE cascade,
  "period_start" timestamp NOT NULL,
  "threshold" integer NOT NULL,
  "spent_amount" numeric(14, 2) NOT NULL,
  "limit_amount" numeric(14, 2) NOT NULL,
  "currency" text NOT NULL,
  "message" text NOT NULL,
  "notified_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ai_usage_alert_unique" ON "ai_usage_alert" ("budget_id", "period_start", "threshold");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_alert_org_idx" ON "ai_usage_alert" ("organization_id", "notified_at");--> statement-breakpoint

-- ── Backfill истории (§11) ────────────────────────────────────────
-- Цена — текущая цена конфигурации с тем же provider+model (если нет — дефолт анализа).
-- Курс USD→RUB для перенесённых данных — 90 (как в подсказках цен провайдеров);
-- после ввода реального курса в настройках cost_base пересчитывается.
-- id события = 'bf:<источник>:<id>' — повторный запуск ничего не дублирует.

INSERT INTO "ai_usage_event" (
  "id", "organization_id", "created_at", "trace_id", "step_no", "operation", "feature", "trigger", "source",
  "user_id", "job_id", "entity_type", "entity_id", "ai_config_id", "ai_config_name", "purpose",
  "provider", "model", "input_tokens", "output_tokens", "status", "error_message",
  "price_currency", "input_price_per_1m", "cached_input_price_per_1m", "output_price_per_1m",
  "cost", "cost_base", "base_currency", "fx_rate", "is_backfilled"
)
SELECT
  'bf:analysis_run:' || ar.id, ar.organization_id, ar.created_at, 'bf:analysis_run:' || ar.id, 1,
  'scoring.scoreApplication', 'screening', CASE WHEN ar.scored_by_id IS NULL THEN 'background' ELSE 'user' END, 'backfill:analysis_run',
  ar.scored_by_id, app.job_id, 'application', ar.application_id, cfg.id, cfg.name, 'analysis',
  ar.provider, ar.model, COALESCE(ar.prompt_tokens, 0), COALESCE(ar.completion_tokens, 0),
  CASE WHEN ar.status = 'failed' THEN 'error' ELSE 'ok' END, LEFT(ar.error_message, 300),
  COALESCE(cfg.price_currency, 'USD'), cfg.input_price_per_1m, cfg.cached_input_price_per_1m, cfg.output_price_per_1m,
  CASE WHEN cfg.input_price_per_1m IS NULL AND cfg.output_price_per_1m IS NULL THEN NULL
       ELSE ROUND((COALESCE(ar.prompt_tokens, 0) * COALESCE(cfg.input_price_per_1m, 0) + COALESCE(ar.completion_tokens, 0) * COALESCE(cfg.output_price_per_1m, 0)) / 1000000.0, 6) END,
  CASE WHEN cfg.input_price_per_1m IS NULL AND cfg.output_price_per_1m IS NULL THEN NULL
       ELSE ROUND((COALESCE(ar.prompt_tokens, 0) * COALESCE(cfg.input_price_per_1m, 0) + COALESCE(ar.completion_tokens, 0) * COALESCE(cfg.output_price_per_1m, 0)) / 1000000.0
            * CASE WHEN COALESCE(cfg.price_currency, 'USD') = 'RUB' THEN 1 ELSE 90 END, 6) END,
  'RUB', CASE WHEN COALESCE(cfg.price_currency, 'USD') = 'RUB' THEN 1 ELSE 90 END, true
FROM "analysis_run" ar
LEFT JOIN "application" app ON app.id = ar.application_id
LEFT JOIN LATERAL (
  SELECT c.* FROM "ai_config" c
  WHERE c.organization_id = ar.organization_id
  ORDER BY (c.provider = ar.provider AND c.model = ar.model) DESC, c.is_default_analysis DESC, c.created_at ASC
  LIMIT 1
) cfg ON true
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

INSERT INTO "ai_usage_event" (
  "id", "organization_id", "created_at", "trace_id", "step_no", "operation", "feature", "trigger", "source",
  "user_id", "entity_type", "entity_id", "ai_config_id", "ai_config_name", "purpose",
  "provider", "model", "input_tokens", "output_tokens", "status", "error_message",
  "price_currency", "input_price_per_1m", "cached_input_price_per_1m", "output_price_per_1m",
  "cost", "cost_base", "base_currency", "fx_rate", "is_backfilled"
)
SELECT
  'bf:resume_risk:' || rr.id, rr.organization_id, rr.created_at, 'bf:resume_risk:' || rr.id, 1,
  'risk.assessResumeRisk', 'verification', 'background', 'backfill:resume_risk',
  rr.triggered_by_id, 'candidate', rr.candidate_id, cfg.id, cfg.name, 'analysis',
  COALESCE(rr.provider, cfg.provider, 'unknown'), COALESCE(rr.model, cfg.model, 'unknown'),
  COALESCE(rr.prompt_tokens, 0), COALESCE(rr.completion_tokens, 0),
  CASE WHEN rr.status::text = 'failed' THEN 'error' ELSE 'ok' END, LEFT(rr.error_message, 300),
  COALESCE(cfg.price_currency, 'USD'), cfg.input_price_per_1m, cfg.cached_input_price_per_1m, cfg.output_price_per_1m,
  CASE WHEN cfg.input_price_per_1m IS NULL AND cfg.output_price_per_1m IS NULL THEN NULL
       ELSE ROUND((COALESCE(rr.prompt_tokens, 0) * COALESCE(cfg.input_price_per_1m, 0) + COALESCE(rr.completion_tokens, 0) * COALESCE(cfg.output_price_per_1m, 0)) / 1000000.0, 6) END,
  CASE WHEN cfg.input_price_per_1m IS NULL AND cfg.output_price_per_1m IS NULL THEN NULL
       ELSE ROUND((COALESCE(rr.prompt_tokens, 0) * COALESCE(cfg.input_price_per_1m, 0) + COALESCE(rr.completion_tokens, 0) * COALESCE(cfg.output_price_per_1m, 0)) / 1000000.0
            * CASE WHEN COALESCE(cfg.price_currency, 'USD') = 'RUB' THEN 1 ELSE 90 END, 6) END,
  'RUB', CASE WHEN COALESCE(cfg.price_currency, 'USD') = 'RUB' THEN 1 ELSE 90 END, true
FROM "resume_risk" rr
LEFT JOIN LATERAL (
  SELECT c.* FROM "ai_config" c
  WHERE c.organization_id = rr.organization_id
  ORDER BY (c.model = rr.model) DESC, c.is_default_analysis DESC, c.created_at ASC
  LIMIT 1
) cfg ON true
WHERE COALESCE(rr.prompt_tokens, 0) + COALESCE(rr.completion_tokens, 0) > 0
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

INSERT INTO "ai_usage_event" (
  "id", "organization_id", "created_at", "trace_id", "step_no", "operation", "feature", "trigger", "source",
  "user_id", "job_id", "entity_type", "entity_id", "ai_config_id", "ai_config_name", "purpose",
  "provider", "model", "input_tokens", "output_tokens", "status",
  "price_currency", "input_price_per_1m", "cached_input_price_per_1m", "output_price_per_1m",
  "cost", "cost_base", "base_currency", "fx_rate", "is_backfilled"
)
SELECT
  'bf:meeting_report:' || mr.id, mr.organization_id, COALESCE(mr.imported_at, mr.created_at), 'bf:meeting_report:' || mr.id, 1,
  'interview.report', 'interview', 'background', 'backfill:meeting_report',
  mr.imported_by_id, app.job_id, 'meeting_report', mr.id, cfg.id, cfg.name, 'analysis',
  COALESCE(mr.ai_provider, cfg.provider, 'unknown'), COALESCE(mr.generated_by_model, cfg.model, 'unknown'),
  COALESCE(mr.usage_input_tokens, 0), COALESCE(mr.usage_output_tokens, 0), 'ok',
  COALESCE(cfg.price_currency, 'USD'), cfg.input_price_per_1m, cfg.cached_input_price_per_1m, cfg.output_price_per_1m,
  CASE WHEN cfg.input_price_per_1m IS NULL AND cfg.output_price_per_1m IS NULL THEN NULL
       ELSE ROUND((COALESCE(mr.usage_input_tokens, 0) * COALESCE(cfg.input_price_per_1m, 0) + COALESCE(mr.usage_output_tokens, 0) * COALESCE(cfg.output_price_per_1m, 0)) / 1000000.0, 6) END,
  CASE WHEN cfg.input_price_per_1m IS NULL AND cfg.output_price_per_1m IS NULL THEN NULL
       ELSE ROUND((COALESCE(mr.usage_input_tokens, 0) * COALESCE(cfg.input_price_per_1m, 0) + COALESCE(mr.usage_output_tokens, 0) * COALESCE(cfg.output_price_per_1m, 0)) / 1000000.0
            * CASE WHEN COALESCE(cfg.price_currency, 'USD') = 'RUB' THEN 1 ELSE 90 END, 6) END,
  'RUB', CASE WHEN COALESCE(cfg.price_currency, 'USD') = 'RUB' THEN 1 ELSE 90 END, true
FROM "meeting_report" mr
LEFT JOIN "application" app ON app.id = mr.application_id
LEFT JOIN LATERAL (
  SELECT c.* FROM "ai_config" c
  WHERE c.organization_id = mr.organization_id
  ORDER BY (c.model = mr.generated_by_model) DESC, c.is_default_analysis DESC, c.created_at ASC
  LIMIT 1
) cfg ON true
WHERE COALESCE(mr.usage_input_tokens, 0) + COALESCE(mr.usage_output_tokens, 0) > 0
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

INSERT INTO "ai_usage_event" (
  "id", "organization_id", "created_at", "trace_id", "step_no", "operation", "feature", "trigger", "source",
  "entity_type", "entity_id", "ai_config_id", "ai_config_name", "purpose",
  "provider", "model", "input_tokens", "output_tokens", "status",
  "price_currency", "input_price_per_1m", "cached_input_price_per_1m", "output_price_per_1m",
  "cost", "cost_base", "base_currency", "fx_rate", "is_backfilled"
)
SELECT
  'bf:duplicate:' || d.id, ca.organization_id, COALESCE(d.ai_checked_at, d.updated_at), 'bf:duplicate:' || d.id, 1,
  'dedup.aiArbiter', 'verification', 'user', 'backfill:candidate_duplicate_candidate',
  'duplicate_pair', d.id, cfg.id, cfg.name, 'analysis',
  COALESCE(cfg.provider, 'unknown'), COALESCE(cfg.model, 'unknown'),
  COALESCE(d.ai_usage_input_tokens, 0), COALESCE(d.ai_usage_output_tokens, 0), 'ok',
  COALESCE(cfg.price_currency, 'USD'), cfg.input_price_per_1m, cfg.cached_input_price_per_1m, cfg.output_price_per_1m,
  CASE WHEN cfg.input_price_per_1m IS NULL AND cfg.output_price_per_1m IS NULL THEN NULL
       ELSE ROUND((COALESCE(d.ai_usage_input_tokens, 0) * COALESCE(cfg.input_price_per_1m, 0) + COALESCE(d.ai_usage_output_tokens, 0) * COALESCE(cfg.output_price_per_1m, 0)) / 1000000.0, 6) END,
  CASE WHEN cfg.input_price_per_1m IS NULL AND cfg.output_price_per_1m IS NULL THEN NULL
       ELSE ROUND((COALESCE(d.ai_usage_input_tokens, 0) * COALESCE(cfg.input_price_per_1m, 0) + COALESCE(d.ai_usage_output_tokens, 0) * COALESCE(cfg.output_price_per_1m, 0)) / 1000000.0
            * CASE WHEN COALESCE(cfg.price_currency, 'USD') = 'RUB' THEN 1 ELSE 90 END, 6) END,
  'RUB', CASE WHEN COALESCE(cfg.price_currency, 'USD') = 'RUB' THEN 1 ELSE 90 END, true
FROM "candidate_duplicate_candidate" d
JOIN "candidate" ca ON ca.id = d.candidate_id_a
LEFT JOIN LATERAL (
  SELECT c.* FROM "ai_config" c
  WHERE c.organization_id = ca.organization_id
  ORDER BY c.is_default_analysis DESC, c.created_at ASC
  LIMIT 1
) cfg ON true
WHERE COALESCE(d.ai_usage_input_tokens, 0) + COALESCE(d.ai_usage_output_tokens, 0) > 0
ON CONFLICT ("id") DO NOTHING;
