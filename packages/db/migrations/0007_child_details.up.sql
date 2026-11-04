-- Per-child details read from GestIB: weekly timetable (with teachers) and absences.
ALTER TABLE children
  ADD COLUMN timetable jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN details_synced_at timestamptz;

-- Agenda events (evaluations, parent meetings, trips) are replaced per child on each sync.
ALTER TABLE calendar_entries ADD COLUMN source_ref text;

CREATE TABLE absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  portal_ref text NOT NULL,
  day date NOT NULL,
  period text,
  subject text,
  kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('justified','pending','unjustified')),
  reason text,
  school_note text,
  can_justify boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX absences_key ON absences (child_id, portal_ref);
CREATE INDEX absences_family_day ON absences (family_id, day DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON absences TO escola_app;
ALTER TABLE absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE absences FORCE ROW LEVEL SECURITY;
CREATE POLICY family_isolation ON absences USING (family_id = app_family_id()) WITH CHECK (family_id = app_family_id());
