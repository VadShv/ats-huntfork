-- Спринт 22 (M4): перевод отклика на другую вакансию.
-- Ссылка со «старого» отклика (этап transferred) на новый отклик,
-- созданный на целевой вакансии. NULL для обычных откликов.

ALTER TABLE "application"
  ADD COLUMN IF NOT EXISTS "transferred_to_application_id" text;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "application"
    ADD CONSTRAINT "application_transferred_to_application_id_fk"
    FOREIGN KEY ("transferred_to_application_id")
    REFERENCES "public"."application"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "application_transferred_to_idx"
  ON "application" ("transferred_to_application_id");
