-- 0071_org_structure
-- Справочники организационной структуры: компании (юрлица) и подразделения.
-- Компания — юрлицо внутри одной организации-тенанта (Группа Астра → дочерние юрлица).
-- Подразделение — узел иерархии произвольной глубины (дирекция → департамент → отдел → сектор → …).
-- Вакансия получает необязательные ссылки company_id / department_id (set null).
-- Backfill: каждой организации создаётся компания по умолчанию с именем организации,
-- все существующие вакансии привязываются к ней — поведение системы не меняется.

CREATE TABLE IF NOT EXISTS "company" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "legal_name" text,
  "inn" text,
  "logo_url" text,
  "is_default" boolean NOT NULL DEFAULT false,
  "is_archived" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "company_organization_id_idx" ON "company" ("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "company_default_idx" ON "company" ("organization_id") WHERE "is_default" = true;

CREATE TABLE IF NOT EXISTS "department" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "company_id" text REFERENCES "company"("id") ON DELETE SET NULL,
  "parent_id" text REFERENCES "department"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_archived" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "department_organization_id_idx" ON "department" ("organization_id");
CREATE INDEX IF NOT EXISTS "department_company_id_idx" ON "department" ("company_id");
CREATE INDEX IF NOT EXISTS "department_parent_id_idx" ON "department" ("parent_id");

ALTER TABLE "job"
  ADD COLUMN IF NOT EXISTS "company_id" text REFERENCES "company"("id") ON DELETE SET NULL;

ALTER TABLE "job"
  ADD COLUMN IF NOT EXISTS "department_id" text REFERENCES "department"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "job_company_id_idx" ON "job" ("company_id");
CREATE INDEX IF NOT EXISTS "job_department_id_idx" ON "job" ("department_id");

-- Backfill: компания по умолчанию для каждой организации (идемпотентно)
INSERT INTO "company" ("id", "organization_id", "name", "is_default")
SELECT gen_random_uuid()::text, o."id", o."name", true
FROM "organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "company" c WHERE c."organization_id" = o."id"
);

UPDATE "job" j
SET "company_id" = c."id"
FROM "company" c
WHERE c."organization_id" = j."organization_id"
  AND c."is_default" = true
  AND j."company_id" IS NULL;
