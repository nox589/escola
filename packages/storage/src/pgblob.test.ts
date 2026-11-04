import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../db/src/testing.js';
import { createBlobStore, verifyLocalSignature } from './index.js';

const base = process.env.TEST_DATABASE_URL;
const d = base ? describe : describe.skip;

d('PgBlobStore (beta storage)', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let pool: pg.Pool;
  beforeAll(async () => {
    db = await createTestDatabase(base!);
    pool = new pg.Pool({ connectionString: db.url });
  });
  afterAll(async () => {
    await pool?.end();
    await db?.drop();
  });

  it('stores files in Postgres so API and worker containers share them', async () => {
    const env = { BLOB_STORE: 'postgres', BLOB_SECRET: 's3cret', PUBLIC_API_URL: 'https://api.test' };
    const worker = createBlobStore(env, pool);
    const api = createBlobStore(env, pool);
    await worker.put('fam/att/abc', Buffer.from('%PDF-1.4'), 'application/pdf');
    expect((await api.get('fam/att/abc')).toString()).toBe('%PDF-1.4');
    const u = new URL(await api.signedUrl('fam/att/abc'));
    expect(
      verifyLocalSignature(
        's3cret',
        'fam/att/abc',
        Number(u.searchParams.get('exp')),
        u.searchParams.get('sig')!,
      ),
    ).toBe(true);
    await expect(worker.put('../etc', Buffer.from(''), 'x')).rejects.toThrow();
    expect(() => createBlobStore({ BLOB_STORE: 'postgres' }, pool)).toThrow(/BLOB_SECRET/);
  });
});
