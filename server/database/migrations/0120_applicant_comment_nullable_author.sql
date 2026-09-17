-- 0120: make application_comment.author_user_id nullable (for hh.ru imported comments with no local author)

ALTER TABLE "application_comment" ALTER COLUMN "author_user_id" DROP NOT NULL;
ALTER TABLE "application_comment" ALTER COLUMN "author_user_id" SET DEFAULT NULL;
