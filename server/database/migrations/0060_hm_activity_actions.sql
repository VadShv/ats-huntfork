-- Спринт 20.3: активность решений НМ.
-- Расширяем enum activity_action новыми значениями:
--   hm_approved  — НМ одобрил кандидата
--   hm_rejected  — НМ отклонил кандидата
--   hm_cancelled — рекрутёр отменил ранее вынесенное решение НМ
--
-- ALTER TYPE ... ADD VALUE выполняется вне транзакции в Postgres,
-- поэтому статэменты разбиты breakpoint'ами и IF NOT EXISTS.

ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'hm_approved';--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'hm_rejected';--> statement-breakpoint
ALTER TYPE "public"."activity_action" ADD VALUE IF NOT EXISTS 'hm_cancelled';
