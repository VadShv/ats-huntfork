-- Migration 0049: Тумблер push-синхронизации hh.ru + красные оттенки отказных этапов
--
-- 1. hh_vacancy_link.push_sync_enabled — вкл/выкл пуш смены этапа на hh.ru
--    (autoSyncEnabled управляет pull-синком откликов, push_sync_enabled — обратным пушем).
-- 2. Отказные этапы (bucket=rejected) переводятся на оттенки красного:
--       not_fit     #ef4444 (red-500)  — без изменений
--       withdrawn   #f97316 → #f87171 (red-400)
--       no_show     #e11d48 (rose-600) — без изменений
--       job_closed  #71717a → #b91c1c (red-700)
--       transferred #8b5cf6 → #9f1239 (rose-800)
--    Обновляем только этапы со старым дефолтным цветом — пользовательские
--    кастомные цвета не трогаем.

ALTER TABLE "hh_vacancy_link" ADD COLUMN IF NOT EXISTS "push_sync_enabled" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
UPDATE "pipeline_stage" SET "color" = '#f87171' WHERE "type" = 'withdrawn' AND "color" = '#f97316';
--> statement-breakpoint
UPDATE "pipeline_stage" SET "color" = '#b91c1c' WHERE "type" = 'job_closed' AND "color" = '#71717a';
--> statement-breakpoint
UPDATE "pipeline_stage" SET "color" = '#9f1239' WHERE "type" = 'transferred' AND "color" = '#8b5cf6';
