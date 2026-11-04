-- SECURITY DEFINER lookups (user_families, accounts_due_for_sync) run as their owner.
-- On managed Postgres (Render, RDS) the owner is a non-superuser without BYPASSRLS, and
-- FORCE ROW LEVEL SECURITY then hides every row because app.family_id is unset.
-- Fix: a dedicated NOLOGIN role owns the two functions and may read only the columns
-- they return. Nothing can log in as it, and escola_app is not a member of it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'escola_lookup') THEN
    CREATE ROLE escola_lookup NOLOGIN;
  END IF;
END $$;
GRANT escola_lookup TO CURRENT_USER; -- needed to hand it ownership (PG16 SET option)
-- CREATE is required by ALTER ... OWNER TO; the role cannot log in, so this grants no one anything new.
GRANT USAGE, CREATE ON SCHEMA public TO escola_lookup;
GRANT SELECT (family_id, user_id, role, can_submit) ON family_members TO escola_lookup;
GRANT SELECT (id, family_id, last_sync_at, status) ON portal_accounts TO escola_lookup;
CREATE POLICY lookup_read ON family_members FOR SELECT TO escola_lookup USING (true);
CREATE POLICY lookup_read ON portal_accounts FOR SELECT TO escola_lookup USING (true);
ALTER FUNCTION user_families(uuid) OWNER TO escola_lookup;
ALTER FUNCTION accounts_due_for_sync() OWNER TO escola_lookup;
GRANT EXECUTE ON FUNCTION user_families(uuid) TO escola_app;
GRANT EXECUTE ON FUNCTION accounts_due_for_sync() TO escola_app;
