-- 0121: fix incoming hh.ru comments where createdAt was overwritten with hh.ru time
-- For incoming comments, createdAt should be the DB insertion time (now()),
-- not the hh.ru comment time (which is stored in hh_synced_at).
-- Only fix records where created_at was set to hh_synced_at (the bug).

UPDATE "application_comment"
  SET "created_at" = NOW()
  WHERE "hh_direction" = 'incoming'
    AND "hh_synced_at" IS NOT NULL
    AND "created_at" = "hh_synced_at";
