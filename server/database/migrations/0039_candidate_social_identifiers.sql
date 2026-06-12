-- ─────────────────────────────────────────────────────────────────────────────
-- 0039: Колонки candidate.linkedin, telegram, github (Sprint 3.4, P2.3)
--
-- Явные social-идентификаторы кандидата. Хранятся в raw-форме,
-- нормализованные значения попадают в candidate_identity (для дедупа).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "linkedin" text;
ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "telegram" text;
ALTER TABLE "candidate" ADD COLUMN IF NOT EXISTS "github" text;
