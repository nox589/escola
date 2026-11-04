DROP TABLE IF EXISTS absences;
ALTER TABLE calendar_entries DROP COLUMN IF EXISTS source_ref;
ALTER TABLE children DROP COLUMN IF EXISTS timetable, DROP COLUMN IF EXISTS details_synced_at;
