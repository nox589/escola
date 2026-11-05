-- Teachers and tutors a parent can write to in GestIB, per child (docs/capture/13-new-message.json).
CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  portal_account_id uuid NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
  child_id uuid REFERENCES children(id) ON DELETE SET NULL,
  portal_ref text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('tutor','teacher')),
  female boolean NOT NULL DEFAULT false,
  child_label text NOT NULL DEFAULT '',
  sender_note text NOT NULL DEFAULT '',
  accepts boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX contacts_key ON contacts (portal_account_id, portal_ref, child_label);
GRANT SELECT, INSERT, UPDATE, DELETE ON contacts TO escola_app;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY family_isolation ON contacts USING (family_id = app_family_id()) WITH CHECK (family_id = app_family_id());

-- Which language calendar/subject labels were last translated into (re-translate on change).
ALTER TABLE families ADD COLUMN labels_lang text;

-- Writing a new message to a teacher.
ALTER TYPE submission_kind ADD VALUE IF NOT EXISTS 'new_message';
