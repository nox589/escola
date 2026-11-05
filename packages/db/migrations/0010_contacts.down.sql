-- (enum value 'new_message' stays: Postgres cannot drop enum values)
ALTER TABLE families DROP COLUMN IF EXISTS labels_lang;
DROP TABLE IF EXISTS contacts;
