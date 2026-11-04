ALTER FUNCTION user_families(uuid) OWNER TO CURRENT_USER;
ALTER FUNCTION accounts_due_for_sync() OWNER TO CURRENT_USER;
DROP POLICY IF EXISTS lookup_read ON family_members;
DROP POLICY IF EXISTS lookup_read ON portal_accounts;
REVOKE ALL ON family_members, portal_accounts FROM escola_lookup;
REVOKE USAGE, CREATE ON SCHEMA public FROM escola_lookup;
REVOKE escola_lookup FROM CURRENT_USER;
