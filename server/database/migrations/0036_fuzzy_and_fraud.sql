-- ─────────────────────────────────────────────
-- Этап 3: fuzzy-матчинг и фрод-предупреждение
-- ─────────────────────────────────────────────

-- 1. Очередь fuzzy-дублей на ручное ревью
CREATE TABLE IF NOT EXISTS "candidate_duplicate_candidate" (
  "id" text PRIMARY KEY,
  -- organization_group.id — text (см. 0034)
  "group_id" text REFERENCES "organization_group"("id") ON DELETE SET NULL,
  -- Канонический порядок: candidate_id_a < candidate_id_b (по строковому сравнению),
  -- чтобы пара (A,B) и (B,A) были одной записью.
  "candidate_id_a" text NOT NULL REFERENCES "candidate"("id") ON DELETE CASCADE,
  "candidate_id_b" text NOT NULL REFERENCES "candidate"("id") ON DELETE CASCADE,
  "score" integer NOT NULL,            -- 0..100, fuzzy-оценка
  -- Раскладка по факторам, что именно совпало:
  -- { name: 95, city: 100, dob: 100, title: 60 }
  "signals" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- pending — ждёт ревью; merged — слиты; dismissed — отметили как «не дубль»
  "status" text NOT NULL DEFAULT 'pending',
  "decided_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "decided_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "candidate_duplicate_canonical_order" CHECK ("candidate_id_a" < "candidate_id_b")
);

-- Уникальность пары (после dismissed создавать новую запись не нужно — переиспользуем)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_candidate_duplicate_pair"
  ON "candidate_duplicate_candidate" ("candidate_id_a", "candidate_id_b");

CREATE INDEX IF NOT EXISTS "idx_candidate_duplicate_status"
  ON "candidate_duplicate_candidate" ("status", "score" DESC);

CREATE INDEX IF NOT EXISTS "idx_candidate_duplicate_group"
  ON "candidate_duplicate_candidate" ("group_id", "status");

-- Быстрый lookup «есть ли pending-дубли у кандидата X»
CREATE INDEX IF NOT EXISTS "idx_candidate_duplicate_a"
  ON "candidate_duplicate_candidate" ("candidate_id_a", "status");
CREATE INDEX IF NOT EXISTS "idx_candidate_duplicate_b"
  ON "candidate_duplicate_candidate" ("candidate_id_b", "status");


-- 2. Жёсткие причины отказа на уровне application
-- Опциональный enum-подобный text-поле; null = обычный отказ
ALTER TABLE "application"
  ADD COLUMN IF NOT EXISTS "fraud_reason" text;

CREATE INDEX IF NOT EXISTS "idx_application_fraud_reason"
  ON "application" ("fraud_reason") WHERE "fraud_reason" IS NOT NULL;


-- 3. Историчность фрод-флага на уровне кандидата
-- candidate.fraud_flag уже создано в 0034.
-- Дополнительно: причина и кто проставил.
ALTER TABLE "candidate"
  ADD COLUMN IF NOT EXISTS "fraud_reason" text,
  ADD COLUMN IF NOT EXISTS "fraud_flagged_at" timestamp,
  ADD COLUMN IF NOT EXISTS "fraud_flagged_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "fraud_notes" text;
