-- Managed Postgres (Render, RDS...) runs as a non-superuser that created the roles in 0001.
-- On PG16 the creator gets ADMIN on those roles but not SET, so `SET LOCAL ROLE escola_app`
-- would fail. Grant the connecting user membership explicitly (a no-op for superusers).
GRANT escola_app TO CURRENT_USER;
GRANT escola_admin TO CURRENT_USER;
