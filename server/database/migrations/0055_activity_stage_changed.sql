-- Миграция 0055: добавить 'stage_changed' в enum activity_action.
-- Файл 0030_stage_changed_action.sql существовал, но не был внесён в journal
-- и потому никогда не применялся — записи recordActivity('stage_changed')
-- молча падали (fire-and-forget). Идемпотентно.
ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'stage_changed';
