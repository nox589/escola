import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

/**
 * Minimal up/down migrator. Files: migrations/NNNN_name.up.sql + NNNN_name.down.sql.
 * Each migration runs in its own transaction and is recorded in schema_migrations.
 */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

async function listMigrations(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith('.up.sql'))
    .map((f) => f.replace(/\.up\.sql$/, ''))
    .sort();
}

async function ensureTable(client: pg.ClientBase) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
}

async function applied(client: pg.ClientBase): Promise<string[]> {
  const r = await client.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  return r.rows.map((x) => x.name);
}

export async function migrateUp(client: pg.ClientBase): Promise<string[]> {
  await ensureTable(client);
  const done = new Set(await applied(client));
  const ran: string[] = [];
  for (const name of await listMigrations()) {
    if (done.has(name)) continue;
    const sql = await readFile(`${MIGRATIONS_DIR}${name}.up.sql`, 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      ran.push(name);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }
  return ran;
}

/** Rolls back the last `steps` migrations (default: all). */
export async function migrateDown(client: pg.ClientBase, steps = Infinity): Promise<string[]> {
  await ensureTable(client);
  const done = (await applied(client)).reverse().slice(0, steps);
  for (const name of done) {
    const sql = await readFile(`${MIGRATIONS_DIR}${name}.down.sql`, 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('DELETE FROM schema_migrations WHERE name = $1', [name]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }
  return done;
}
