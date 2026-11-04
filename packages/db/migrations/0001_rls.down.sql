DROP TRIGGER IF EXISTS submissions_insert_as_draft ON submissions;
DROP TRIGGER IF EXISTS submissions_require_confirmation ON submissions;
DROP FUNCTION IF EXISTS forbid_insert_past_draft();
DROP FUNCTION IF EXISTS enforce_submission_confirmation();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'families','family_members','portal_accounts','credentials','portal_sessions','children','items',
    'item_translations','item_actions','attachments','calendar_entries','submissions',
    'submission_confirmations','receipts','notifications','digests','embeddings','chat_threads',
    'chat_messages','sync_runs','audit_log'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS family_isolation ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS family_isolation_app ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS admin_read ON %I', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS app_family_id();
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM escola_app, escola_admin;
REVOKE USAGE ON SCHEMA public FROM escola_app, escola_admin;
