import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPool(connectionString: string) {
  return new pg.Pool({ connectionString, max: 10 });
}

/**
 * Runs `fn` in a transaction as the RLS-restricted `escola_app` role with app.family_id set.
 * Every API request and worker job that touches family data goes through here.
 */
export async function withFamily<T>(pool: pg.Pool, familyId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(familyId)) throw new Error('withFamily: invalid family id');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE escola_app');
    await client.query(`SELECT set_config('app.family_id', $1, true)`, [familyId]);
    const result = await fn(drizzle(client, { schema }));
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
