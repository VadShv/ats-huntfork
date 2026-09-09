-- Центр аналитики (Блок C3): headcount вакансии для multi-hire позиций.
-- 1 = обычная вакансия. Метрика «закрыто N из M» = hires vs headcount.

ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "headcount" integer DEFAULT 1 NOT NULL;
