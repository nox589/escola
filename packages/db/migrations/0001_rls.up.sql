-- SPEC §6/§13: Postgres RLS scoped by the `app.family_id` session variable.
-- The API and worker connect as `escola_app` (no BYPASSRLS) and run every request/job inside
-- withFamily(familyId, ...), which does SET LOCAL app.family_id. With no family set, nothing is visible.
-- Admin tooling uses `escola_admin`, which can read operational tables but NOT credentials/sessions.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'escola_app') THEN
    CREATE ROLE escola_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'escola_admin') THEN
    CREATE ROLE escola_admin NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO escola_app, escola_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO escola_app;
REVOKE UPDATE, DELETE ON audit_log FROM escola_app; -- append-only

-- Admin: health/sync-run/parser-drift only. No credentials, sessions or child content.
GRANT SELECT ON sync_runs, portal_accounts, audit_log TO escola_admin;

CREATE OR REPLACE FUNCTION app_family_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.family_id', true), '')::uuid $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'family_members','portal_accounts','credentials','portal_sessions','children','items',
    'item_translations','item_actions','attachments','calendar_entries','submissions',
    'submission_confirmations','receipts','notifications','digests','embeddings','chat_threads',
    'chat_messages','sync_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY family_isolation ON %I USING (family_id = app_family_id()) WITH CHECK (family_id = app_family_id())',
      t);
  END LOOP;
END $$;

ALTER TABLE families ENABLE ROW LEVEL SECURITY;
ALTER TABLE families FORCE ROW LEVEL SECURITY;
CREATE POLICY family_isolation ON families USING (id = app_family_id()) WITH CHECK (id = app_family_id());

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_isolation_app ON audit_log TO escola_app
  USING (family_id = app_family_id()) WITH CHECK (family_id IS NULL OR family_id = app_family_id());
CREATE POLICY admin_read ON audit_log FOR SELECT TO escola_admin USING (true);

-- Admin can see sync health across families.
CREATE POLICY admin_read ON sync_runs FOR SELECT TO escola_admin USING (true);
CREATE POLICY admin_read ON portal_accounts FOR SELECT TO escola_admin USING (true);

-- Hard invariant (golden rule 3): a submission can only move to queued/submitting with a valid,
-- non-invalidated confirmation whose preview_hash was recorded. Enforced in the DB as a backstop.
CREATE OR REPLACE FUNCTION enforce_submission_confirmation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('confirmed','queued','submitting','verifying','succeeded')
     AND NEW.state IS DISTINCT FROM OLD.state
     AND NOT EXISTS (
       SELECT 1 FROM submission_confirmations c
       WHERE c.submission_id = NEW.id AND c.invalidated_at IS NULL
     ) THEN
    RAISE EXCEPTION 'submission % has no valid parent confirmation', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER submissions_require_confirmation
  BEFORE UPDATE OF state ON submissions
  FOR EACH ROW EXECUTE FUNCTION enforce_submission_confirmation();

CREATE OR REPLACE FUNCTION forbid_insert_past_draft() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state NOT IN ('draft','awaiting_confirmation') THEN
    RAISE EXCEPTION 'submissions must be created as draft' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER submissions_insert_as_draft
  BEFORE INSERT ON submissions
  FOR EACH ROW EXECUTE FUNCTION forbid_insert_past_draft();
