import pg from 'pg';
import { migrateUp } from './migrate.js';

/**
 * Creates an isolated, migrated database for one test file (so files can run in parallel).
 * Requires TEST_DATABASE_URL pointing at a server where the user can CREATE DATABASE.
 */
export async function createTestDatabase(
  baseUrl: string,
): Promise<{ url: string; drop: () => Promise<void> }> {
  const name = `escola_t_${Math.random().toString(36).slice(2, 10)}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const u = new URL(baseUrl);
  u.pathname = `/${name}`;
  const url = u.toString();
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await migrateUp(c);
  await c.end();

  return {
    url,
    drop: async () => {
      const a = new pg.Client({ connectionString: baseUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
