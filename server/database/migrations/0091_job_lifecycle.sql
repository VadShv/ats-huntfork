-- Центр аналитики (Фаза 1): фундамент lifecycle-таймстампов вакансии.
-- До этой миграции срок закрытия реконструировался из fire-and-forget activity_log.
-- Теперь job хранит openedAt/closedAt/firstOpenedAt/reopenCount/closeReason/filledAt,
-- а каждый переход статуса дублируется в append-only job_status_history транзакционно.
--
-- Бэкфилл (идемпотентный) восстанавливает историю и таймстампы из activity_log
-- (action='status_changed', resource_type='job', metadata->>'from'/'to').

-- ── 1. Новые колонки job ──
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "opened_at" timestamp;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "closed_at" timestamp;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "first_opened_at" timestamp;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "reopen_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "close_reason" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "filled_at" timestamp;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "job_status_idx" ON "job" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_opened_at_idx" ON "job" ("opened_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_closed_at_idx" ON "job" ("closed_at");--> statement-breakpoint

-- ── 2. Таблица истории статусов ──
CREATE TABLE IF NOT EXISTS "job_status_history" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "job_id" text NOT NULL,
  "from_status" "job_status",
  "to_status" "job_status" NOT NULL,
  "changed_by_user_id" text,
  "reason" text,
  "changed_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_job_id_job_id_fk"
    FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_changed_by_user_id_user_id_fk"
    FOREIGN KEY ("changed_by_user_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "job_status_history_job_id_idx" ON "job_status_history" ("job_id","changed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_status_history_organization_id_idx" ON "job_status_history" ("organization_id","changed_at");--> statement-breakpoint

-- ── 3. Бэкфилл job_status_history из activity_log (идемпотентно) ──
-- Вставляем только для вакансий, у которых истории ещё нет (защита от повторного прогона).
INSERT INTO "job_status_history" ("id","organization_id","job_id","from_status","to_status","changed_by_user_id","reason","changed_at")
SELECT
  gen_random_uuid()::text,
  al.organization_id,
  al.resource_id,
  NULLIF(al.metadata->>'from','')::"job_status",
  NULLIF(al.metadata->>'to','')::"job_status",
  al.actor_id,
  'backfill:activity_log',
  al.created_at
FROM "activity_log" al
JOIN "job" j ON j.id = al.resource_id
WHERE al.action = 'status_changed'
  AND al.resource_type = 'job'
  AND al.metadata->>'to' IN ('draft','open','closed','archived')
  AND NOT EXISTS (SELECT 1 FROM "job_status_history" h WHERE h.job_id = al.resource_id);--> statement-breakpoint

-- ── 4. Пересчёт job.* из восстановленной истории ──
-- firstOpenedAt = первый переход в open; openedAt = последний переход в open;
-- closedAt = последний переход в closed (позже последнего open); reopenCount = число open минус 1.
WITH agg AS (
  SELECT
    h.job_id,
    MIN(h.changed_at) FILTER (WHERE h.to_status = 'open')  AS first_open,
    MAX(h.changed_at) FILTER (WHERE h.to_status = 'open')  AS last_open,
    MAX(h.changed_at) FILTER (WHERE h.to_status = 'closed') AS last_close,
    COUNT(*)          FILTER (WHERE h.to_status = 'open')  AS open_count
  FROM "job_status_history" h
  GROUP BY h.job_id
)
UPDATE "job" j SET
  first_opened_at = COALESCE(agg.first_open, CASE WHEN j.status IN ('open','closed','archived') THEN j.created_at END),
  opened_at = COALESCE(agg.last_open, CASE WHEN j.status = 'open' THEN j.created_at END),
  closed_at = CASE
                WHEN j.status = 'closed'
                THEN COALESCE(agg.last_close, j.updated_at)
                ELSE agg.last_close
              END,
  reopen_count = GREATEST(COALESCE(agg.open_count, 0) - 1, 0)
FROM agg
WHERE j.id = agg.job_id;--> statement-breakpoint

-- Вакансии без событий в логе, но уже открытые/закрытые — грубая инициализация от created_at/updated_at.
UPDATE "job" j SET
  first_opened_at = COALESCE(j.first_opened_at, CASE WHEN j.status IN ('open','closed','archived') THEN j.created_at END),
  opened_at = COALESCE(j.opened_at, CASE WHEN j.status = 'open' THEN j.created_at END),
  closed_at = COALESCE(j.closed_at, CASE WHEN j.status = 'closed' THEN j.updated_at END)
WHERE j.status IN ('open','closed','archived')
  AND (j.first_opened_at IS NULL OR (j.status = 'open' AND j.opened_at IS NULL) OR (j.status = 'closed' AND j.closed_at IS NULL));
