import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, eq, schema, withFamily } from '@escola/db';
import { createTestDatabase } from '../../../../packages/db/src/testing.js';
import { LocalBlobStore } from '@escola/storage';
import { createMockPortal } from '../../../../apps/mock-portal/src/app.js';
import { createGestibAdapter } from '../adapters/gestib/adapter.js';
import { mockSelectors } from '../adapters/gestib/selectors.mock.js';
import { guardedLogin } from '../core/lockoutGuard.js';
import { runSync } from '../core/sync.js';
import { PgItemStore, PgLockoutStore } from './pg.js';

const base = process.env.TEST_DATABASE_URL;
const CHROME = process.env.CHROME_PATH ?? ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const d = base && CHROME ? describe : describe.skip;

d('Postgres stores', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let pool: pg.Pool;
  let browser: Browser;
  let server: Server;
  let portalBase: string;
  const familyId = crypto.randomUUID();
  let accountId: string;

  beforeAll(async () => {
    db = await createTestDatabase(base!);
    pool = createPool(db.url);
    pool.on('error', () => undefined); // idle clients killed by db.drop() in teardown
    const admin = new pg.Client({ connectionString: db.url });
    await admin.connect();
    const u = await admin.query(`INSERT INTO users(email) VALUES ('p@x.test') RETURNING id`);
    await admin.query(`INSERT INTO families(id,name,owner_user_id) VALUES ($1,'F',$2)`, [
      familyId,
      u.rows[0].id,
    ]);
    await admin.end();
    accountId = await withFamily(pool, familyId, async (tx) => {
      const [a] = await tx
        .insert(schema.portalAccounts)
        .values({ familyId, usernameHint: 'p*****1' })
        .returning();
      return a!.id;
    });
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    const portal = createMockPortal();
    server = portal.app.listen(0);
    await new Promise((r) => server.once('listening', r));
    portalBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server?.close();
    await browser?.close();
    await pool?.end();
    await db?.drop();
  });

  it('full sync persists children, items and attachments; rerun is a no-op', async () => {
    const blobs = new LocalBlobStore(await mkdtemp(join(tmpdir(), 'b-')), 'http://api', 's');
    const adapter = createGestibAdapter({ selectors: mockSelectors(portalBase) });
    const opts = {
      adapter,
      browser,
      accountId,
      lockout: new PgLockoutStore(pool, familyId),
      items: new PgItemStore(pool, familyId, blobs),
      withCredentials: <R>(fn: (c: { username: string; password: string }) => Promise<R>) =>
        fn({ username: 'parent1', password: 'escola123' }),
    };
    const r1 = await runSync(opts);
    expect(r1.ok).toBe(true);
    expect(r1.saved).toHaveLength(4);
    await withFamily(pool, familyId, (tx) =>
      tx.update(schema.portalAccounts).set({ lastSyncAt: new Date() }),
    );

    const counts = await withFamily(pool, familyId, async (tx) => ({
      children: (await tx.select().from(schema.children)).length,
      items: (await tx.select().from(schema.items)).length,
      attachments: await tx.select().from(schema.attachments),
    }));
    expect(counts.children).toBe(2);
    expect(counts.items).toBe(4);
    expect(counts.attachments).toHaveLength(1);
    expect((await blobs.get(counts.attachments[0]!.s3Key)).toString()).toContain('%PDF');

    const r2 = await runSync(opts);
    expect(r2.saved).toHaveLength(0);
    expect(r2.counts.unchanged).toBe(4);
  });

  it('lockout store persists failures immediately and serialises concurrent logins', async () => {
    const store = new PgLockoutStore(pool, familyId);
    let calls = 0;
    const attempt = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 50));
      return { ok: false as const, code: 'INVALID_CREDENTIALS' as const, ambiguous: false };
    };
    const outcomes = await Promise.allSettled([
      guardedLogin(store, accountId, attempt),
      guardedLogin(store, accountId, attempt),
    ]);
    expect(calls).toBe(1);
    expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
    const [acc] = await withFamily(pool, familyId, (tx) => tx.select().from(schema.portalAccounts));
    expect(acc!.status).toBe('credentials_invalid');
    expect(acc!.consecutiveAuthFailures).toBe(1);
  });

  it('stores child details under RLS; a failed part keeps the stored data', async () => {
    const blobs = new LocalBlobStore(await mkdtemp(join(tmpdir(), 'b-')), 'http://api', 's');
    const store = new PgItemStore(pool, familyId, blobs);
    const child = { ref: 'DET1', displayName: 'Det Kid' };
    await store.save(accountId, child, [], []);
    const tt = [{ day: 1, start: '09:00', end: '10:00', subject: 'Matemàtiques', subjectShort: 'MAT', room: null, teachers: ['T One'] }];
    const abs = (status: 'justified' | 'unjustified') => ({
      ref: 'F1', day: '2026-11-03', period: '2', subject: null, kind: 'Asistencia', status, reason: null, schoolNote: null, canJustify: status === 'unjustified',
    });
    const ev = { ref: 'evaluation:1', kind: 'evaluation', title: '1a avaluació', start: '2026-12-18T00:00:00+0100', end: null, allDay: true, place: null };
    await store.saveChildDetails(accountId, child, { timetable: tt, absences: [abs('unjustified')], agenda: [ev], errors: [] });
    await store.saveChildDetails(accountId, child, { timetable: null, absences: [abs('justified')], agenda: [ev], errors: [] });

    await withFamily(pool, familyId, async (tx) => {
      const [k] = await tx.select().from(schema.children).where(eq(schema.children.portalChildRef, 'DET1'));
      expect(k!.timetable).toEqual(tt);
      const a = await tx.select().from(schema.absences).where(eq(schema.absences.childId, k!.id));
      expect(a.map((x) => [x.portalRef, x.status, x.canJustify])).toEqual([['F1', 'justified', false]]);
      const e = await tx.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.childId, k!.id));
      expect(e.map((x) => [x.kind, x.sourceRef])).toEqual([['evaluation', 'evaluation:1']]);
    });
    // Another family sees nothing.
    const other = await withFamily(pool, crypto.randomUUID(), (tx) => tx.select().from(schema.absences));
    expect(other).toEqual([]);
  });
});
