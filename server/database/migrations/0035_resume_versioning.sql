-- ─────────────────────────────────────────────
-- Версионирование резюме (Этап 2)
--
-- Концепция:
--   • При каждом fetch hh-резюме считаем стабильный content_hash (без волатильных полей)
--   • Если hash отличается от текущей версии И прошло > 1 часа с последней версии — append v(N+1)
--   • Старые версии не удаляются: хранят snapshot целиком (jsonb)
--   • Поле is_current помечает «активную» версию (одну на кандидата)
--   • Поле delta_summary — краткое описание изменений ({ added_jobs: 1, salary_changed: true, ... })
--   • При слиянии кандидатов версии из мерджимого кандидата НЕ удаляются (merged_into_candidate_id),
--     а доступны через primary → можно посмотреть всю историю
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "candidate_resume_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "candidate_id" text NOT NULL REFERENCES "candidate"("id") ON DELETE CASCADE,
  "version_number" integer NOT NULL,                     -- 1, 2, 3... в рамках кандидата
  "source" text NOT NULL DEFAULT 'hh',                   -- hh | manual_upload | api_import | merged_from
  "content_hash" text NOT NULL,                          -- sha256 от нормализованного snapshot
  "snapshot" jsonb NOT NULL,                             -- полный raw hh-резюме на момент версии
  "delta_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,    -- { added_experience_count, salary_changed, contacts_changed, ... }
  "hh_updated_at" timestamp,                             -- resume.updated_at от hh
  "fetched_at" timestamp NOT NULL DEFAULT now(),
  "is_current" boolean NOT NULL DEFAULT false,
  "triggered_by" text,                                   -- 'auto-sync' | 'manual-refresh' | user_id
  -- Если эта версия пришла из мерджимого кандидата, тут id того кандидата:
  "merged_from_candidate_id" text REFERENCES "candidate"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Только одна current версия на кандидата
CREATE UNIQUE INDEX IF NOT EXISTS "uq_candidate_resume_version_current"
  ON "candidate_resume_version" ("candidate_id")
  WHERE "is_current" = true;

-- Уникальный номер версии в рамках кандидата
CREATE UNIQUE INDEX IF NOT EXISTS "uq_candidate_resume_version_number"
  ON "candidate_resume_version" ("candidate_id", "version_number");

-- Быстрый поиск по hash (для проверки «не было ли уже такой версии»)
CREATE INDEX IF NOT EXISTS "idx_candidate_resume_version_hash"
  ON "candidate_resume_version" ("candidate_id", "content_hash");

-- Список версий кандидата отсортирован по дате
CREATE INDEX IF NOT EXISTS "idx_candidate_resume_version_fetched"
  ON "candidate_resume_version" ("candidate_id", "fetched_at" DESC);
