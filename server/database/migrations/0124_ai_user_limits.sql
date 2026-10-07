-- Персональные лимиты на ИИ (docs/design-profile-and-token-limits.md §3).
--  • ai_usage_budget: scope 'member_default' (лимит по умолчанию для всех участников)
--    и on_exceed 'block_all' (останавливает и ручные вызовы) — значения text, схема без изменений;
--    один активный лимит на (организация, scope, участник, период).
--  • ai_usage_alert.user_id — пороги персональных лимитов фиксируются на каждого участника.
--  • ai_usage_settings.fallback_price_per_1m — резервная цена для событий без цены,
--    чтобы вызовы через конфигурацию без цен не обходили лимит.

ALTER TABLE "ai_usage_settings" ADD COLUMN IF NOT EXISTS "fallback_price_per_1m" numeric(10, 4);--> statement-breakpoint

ALTER TABLE "ai_usage_alert" ADD COLUMN IF NOT EXISTS "user_id" text REFERENCES "user"("id") ON DELETE cascade;--> statement-breakpoint
DROP INDEX IF EXISTS "ai_usage_alert_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_usage_alert_unique" ON "ai_usage_alert" ("budget_id", "period_start", "threshold", COALESCE("user_id", ''));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_alert_user_idx" ON "ai_usage_alert" ("organization_id", "user_id", "period_start");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ai_usage_budget_member_limit_unique"
  ON "ai_usage_budget" ("organization_id", "scope", COALESCE("scope_key", ''), "period")
  WHERE "is_active" = true AND "scope" IN ('user', 'member_default');
