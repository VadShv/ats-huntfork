-- 0119: add hh_author_name for incoming applicant comments from hh.ru

ALTER TABLE "application_comment" ADD COLUMN IF NOT EXISTS "hh_author_name" text;
