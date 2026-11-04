import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDevKms } from '@escola/crypto';
import { createPool, schema, withFamily } from '@escola/db';
import { FakeEmbedder, FakeProvider } from '@escola/llm';
import { LocalBlobStore } from '@escola/storage';
import { createTestDatabase } from '../../../packages/db/src/testing.js';
import { buildApp } from './app.js';
import { ConsoleMailer } from './services/mail.js';

const base = process.env.TEST_DATABASE_URL;
const d = base ? describe : describe.skip;

d('API', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let pool: pg.Pool;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const mailer = new ConsoleMailer(false);
  const queued: { kind: string; job: Record<string, unknown> }[] = [];
  const logs: string[] = [];
  const PASSWORD = 'Secreta2026x';

  beforeAll(async () => {
    db = await createTestDatabase(base!);
    pool = createPool(db.url);
    const stream = new Writable({ write: (c, _e, cb) => (logs.push(c.toString()), cb()) });
    app = await buildApp(
      {
        pool,
        kms: new LocalDevKms(randomBytes(32).toString('base64')),
        blobs: new LocalBlobStore(await mkdtemp(join(tmpdir(), 'b-')), 'http://api', 'blob-secret'),
        llm: new FakeProvider(),
        chatLlm: new FakeProvider(),
        embedder: new FakeEmbedder(),
        queue: {
          sync: async (job) => void queued.push({ kind: 'sync', job }),
          submit: async (job) => void queued.push({ kind: 'submit', job }),
        },
        mailer,
        oauth: { verify: async (_p, t) => ({ email: `${t.slice(0, 6)}@oauth.test`, subject: 'x' }) },
        config: {
          jwtSecret: 'test-secret-'.repeat(4),
          appUrl: 'escola://',
          blobSecret: 'blob-secret',
          enabledWriters: ['reply_message'],
          adminToken: 'admintoken123',
          assistantDailyLimit: 3,
        },
      },
      { logger: { level: 'debug', stream } },
    );
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await db?.drop();
  });

  async function signIn(email: string) {
    await app.inject({ method: 'POST', url: '/v1/auth/magic-link', payload: { email } });
    const token = /token=([\w-]+)/.exec(mailer.sent.at(-1)!.text)![1]!;
    const r = await app.inject({ method: 'POST', url: '/v1/auth/verify', payload: { token, locale: 'en' } });
    expect(r.statusCode).toBe(200);
    return r.json() as { accessToken: string; refreshToken: string; user: { id: string } };
  }
  const as = (t: string) => ({ authorization: `Bearer ${t}` });

  let A: Awaited<ReturnType<typeof signIn>>;
  let B: Awaited<ReturnType<typeof signIn>>;
  let accountId: string;
  let familyA: string;

  it('magic link sign-in creates a user and family; links work once', async () => {
    A = await signIn('anna@example.test');
    const me = (await app.inject({ url: '/v1/me', headers: as(A.accessToken) })).json();
    expect(me).toMatchObject({ email: 'anna@example.test', role: 'owner', canSubmit: true });
    familyA = me.familyId;
    const token = /token=([\w-]+)/.exec(mailer.sent.at(-1)!.text)![1]!;
    expect(
      (await app.inject({ method: 'POST', url: '/v1/auth/verify', payload: { token } })).statusCode,
    ).toBe(401);
    expect((await app.inject({ url: '/v1/me' })).statusCode).toBe(401);
  });

  it('refresh tokens rotate; a near-simultaneous reuse (two tabs) is allowed, a late reuse revokes the chain', async () => {
    const r1 = (
      await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: A.refreshToken } })
    ).json();
    expect(r1.refreshToken).toBeTruthy();
    const twin = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: A.refreshToken } });
    expect(twin.statusCode).toBe(200);
    await pool.query(`UPDATE refresh_tokens SET rotated_at = now() - interval '5 minutes' WHERE rotated_at IS NOT NULL`);
    const reuse = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: A.refreshToken },
    });
    expect(reuse.json().error).toBe('refresh_reused');
    const r2 = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: r1.refreshToken },
    });
    expect(r2.statusCode).toBe(401); // whole chain revoked
  });

  it('linking GestIB needs the read mandate, encrypts at once, queues one check, never echoes or logs the password', async () => {
    const body = { portal: 'gestib', username: 'anna.parent', password: PASSWORD };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/portal-accounts',
          headers: as(A.accessToken),
          payload: body,
        })
      ).statusCode,
    ).toBe(403);
    await app.inject({
      method: 'POST',
      url: '/v1/consents',
      headers: as(A.accessToken),
      payload: { kind: 'mandate_read', version: '1' },
    });
    const r = await app.inject({
      method: 'POST',
      url: '/v1/portal-accounts',
      headers: as(A.accessToken),
      payload: body,
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(PASSWORD);
    expect(r.json()).toMatchObject({ usernameHint: 'a******t', status: 'active' });
    accountId = r.json().id;
    expect(queued.at(-1)).toMatchObject({ kind: 'sync', job: { portalAccountId: accountId } });

    const raw = await pool.query('SELECT ciphertext FROM credentials');
    expect(Buffer.from(raw.rows[0].ciphertext).toString()).not.toContain(PASSWORD);
    expect(logs.join('')).not.toContain(PASSWORD);
    expect(logs.join('')).not.toContain('anna.parent');
  });

  it('updating credentials is the only reset of the lockout counter', async () => {
    await pool.query(`UPDATE portal_accounts SET status='credentials_invalid', consecutive_auth_failures=2`);
    const r = await app.inject({
      method: 'PUT',
      url: `/v1/portal-accounts/${accountId}/credentials`,
      headers: as(A.accessToken),
      payload: { username: 'anna.parent', password: 'Nova2026y' },
    });
    expect(r.json().status).toBe('active');
    const row = (
      await pool.query('SELECT consecutive_auth_failures, credential_version FROM portal_accounts')
    ).rows[0];
    expect(row).toEqual({ consecutive_auth_failures: 0, credential_version: 2 });
    expect(logs.join('')).not.toContain('Nova2026y');
  });

  it('another family cannot see or touch this account', async () => {
    B = await signIn('bob@example.test');
    expect(
      (await app.inject({ url: `/v1/portal-accounts/${accountId}`, headers: as(B.accessToken) })).statusCode,
    ).toBe(404);
    expect((await app.inject({ url: '/v1/portal-accounts', headers: as(B.accessToken) })).json()).toEqual([]);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/v1/portal-accounts/${accountId}`,
          headers: as(B.accessToken),
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ url: '/v1/portal-accounts', headers: as(A.accessToken) })).json(),
    ).toHaveLength(1); // untouched
  });

  let itemId: string;
  let childId: string;
  it('feed returns translation WITH original, needs-action filter, read state, calendar', async () => {
    const ids = await withFamily(pool, familyA, async (tx) => {
      const [c] = await tx
        .insert(schema.children)
        .values({
          familyId: familyA,
          portalAccountId: accountId,
          portalChildRef: 'child-a',
          displayName: 'Maya',
        })
        .returning();
      const [i] = await tx
        .insert(schema.items)
        .values({
          familyId: familyA,
          portalAccountId: accountId,
          childId: c!.id,
          section: 'message',
          portalItemRef: 'msg-1',
          contentHash: 'h',
          originalTitle: 'Reunió',
          originalBodyHtml: 'x',
          originalBodyText: 'Us proposam una reunió.',
          originalLang: 'ca',
          postedAt: new Date('2026-11-02T12:00:00Z'),
        })
        .returning();
      await tx
        .insert(schema.items)
        .values({
          familyId: familyA,
          portalAccountId: accountId,
          childId: c!.id,
          section: 'circular',
          portalItemRef: 'c-1',
          contentHash: 'h',
          originalTitle: 'Menú',
          originalBodyHtml: 'x',
          originalBodyText: 'Menú',
          postedAt: new Date('2026-11-01T12:00:00Z'),
        });
      await tx
        .insert(schema.itemTranslations)
        .values({
          familyId: familyA,
          itemId: i!.id,
          lang: 'en',
          title: 'Meeting',
          body: 'We propose a meeting.',
          summary: 'Teacher proposes a meeting',
          model: 'fake',
          promptVersion: 'v1',
        });
      await tx
        .insert(schema.itemActions)
        .values({
          familyId: familyA,
          itemId: i!.id,
          kind: 'reply',
          deadlineAt: new Date('2026-11-10T22:59:00Z'),
          confidence: 0.9,
        });
      await tx
        .insert(schema.calendarEntries)
        .values({
          familyId: familyA,
          childId: c!.id,
          itemId: i!.id,
          titleOriginal: 'Reunió',
          titleTranslated: 'Meeting',
          startsAt: new Date('2026-11-10T00:00:00Z'),
          allDay: true,
          kind: 'deadline',
        });
      return { child: c!.id, item: i!.id };
    });
    itemId = ids.item;
    childId = ids.child;

    const feed = (await app.inject({ url: '/v1/items?limit=1', headers: as(A.accessToken) })).json();
    expect(feed.items[0]).toMatchObject({
      title: 'Meeting',
      original: { title: 'Reunió', lang: 'ca' },
      action: { kind: 'reply' },
      read: false,
    });
    expect(feed.nextCursor).toBeTruthy();
    const page2 = (
      await app.inject({ url: `/v1/items?limit=1&cursor=${feed.nextCursor}`, headers: as(A.accessToken) })
    ).json();
    expect(page2.items[0].original.title).toBe('Menú');
    expect(
      (await app.inject({ url: '/v1/items?needs_action=true', headers: as(A.accessToken) })).json().items,
    ).toHaveLength(1);

    const detail = (await app.inject({ url: `/v1/items/${itemId}`, headers: as(A.accessToken) })).json();
    expect(detail.original.body).toBe('Us proposam una reunió.');
    expect(detail.translation.body).toBe('We propose a meeting.');

    await app.inject({ method: 'POST', url: `/v1/items/${itemId}/read`, headers: as(A.accessToken) });
    expect((await app.inject({ url: '/v1/items', headers: as(A.accessToken) })).json().items[0].read).toBe(
      true,
    );
    expect((await app.inject({ url: `/v1/items/${itemId}`, headers: as(B.accessToken) })).statusCode).toBe(
      404,
    );

    const cal = (
      await app.inject({
        url: '/v1/calendar?from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z',
        headers: as(A.accessToken),
      })
    ).json();
    expect(cal[0]).toMatchObject({ title: 'Meeting', kind: 'deadline', child: { name: 'Maya' } });
  });

  it('reception: preview hash, submit mandate, edit invalidates, confirm queues exactly once', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: as(A.accessToken),
      payload: {
        kind: 'reply_message',
        child_id: childId,
        item_id: itemId,
        user_input: { text: 'Yes, Tuesday works.' },
      },
    });
    expect(create.statusCode).toBe(200);
    const sub = create.json();
    expect(sub).toMatchObject({ state: 'awaiting_confirmation', draftOriginal: expect.any(String) });
    expect(sub.previewHash).toMatch(/^[a-f0-9]{64}$/);

    const confirm = (hash: string) =>
      app.inject({
        method: 'POST',
        url: `/v1/submissions/${sub.id}/confirm`,
        headers: as(A.accessToken),
        payload: { preview_hash: hash },
      });
    expect((await confirm(sub.previewHash)).json().error).toBe('mandate_submit_consent_required');
    await app.inject({
      method: 'POST',
      url: '/v1/consents',
      headers: as(A.accessToken),
      payload: { kind: 'mandate_submit', version: '1' },
    });

    const edited = (
      await app.inject({
        method: 'PATCH',
        url: `/v1/submissions/${sub.id}`,
        headers: as(A.accessToken),
        payload: { user_input: { text: 'Yes, Wednesday works.' } },
      })
    ).json();
    expect(edited.previewHash).not.toBe(sub.previewHash);
    expect((await confirm(sub.previewHash)).json().error).toBe('preview_changed'); // stale preview refused

    const before = queued.length;
    const ok = await confirm(edited.previewHash);
    expect(ok.json()).toMatchObject({ state: 'queued' });
    expect(queued.slice(before)).toEqual([
      { kind: 'submit', job: { familyId: familyA, submissionId: sub.id } },
    ]);
    expect((await confirm(edited.previewHash)).statusCode).toBe(409); // no double confirm
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/submissions/${sub.id}`,
          headers: as(A.accessToken),
          payload: { user_input: { text: 'x' } },
        })
      ).statusCode,
    ).toBe(409);

    // Kinds not verified on a real portal are refused.
    const auth = await app.inject({
      method: 'POST',
      url: '/v1/submissions',
      headers: as(A.accessToken),
      payload: { kind: 'authorisation', child_id: childId, user_input: { decision: 'approve' } },
    });
    expect(auth.json().error).toBe('kind_not_enabled');
  });

  it('invites: a co-parent joins, sees the family, cannot submit until allowed, never sees credentials', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/family/invites',
      headers: as(A.accessToken),
      payload: { email: 'bob@example.test', role: 'guardian' },
    });
    const token = /token=([\w-]+)/.exec(mailer.sent.at(-1)!.text)![1]!;
    const acc = await app.inject({
      method: 'POST',
      url: `/v1/family/invites/${token}/accept`,
      headers: as(B.accessToken),
    });
    expect(acc.json().familyId).toBe(familyA);
    const meB = (await app.inject({ url: '/v1/me', headers: as(B.accessToken) })).json();
    expect(meB).toMatchObject({ familyId: familyA, role: 'guardian', canSubmit: false });
    expect((await app.inject({ url: '/v1/items', headers: as(B.accessToken) })).json().items).toHaveLength(2);
    const accts = await app.inject({ url: '/v1/portal-accounts', headers: as(B.accessToken) });
    expect(accts.body).not.toMatch(/password|ciphertext/i);
  });

  it('assistant streams an answer and is rate limited per family', async () => {
    const t = (
      await app.inject({ method: 'POST', url: '/v1/assistant/threads', headers: as(A.accessToken) })
    ).json();
    const r = await app.inject({
      method: 'POST',
      url: `/v1/assistant/threads/${t.id}/messages`,
      headers: as(A.accessToken),
      payload: { content: 'When is the meeting?' },
    });
    expect(r.headers['content-type']).toContain('text/event-stream');
    expect(r.body).toContain('event: delta');
    expect(r.body).toContain('event: done');
    for (let i = 0; i < 2; i++)
      await app.inject({
        method: 'POST',
        url: `/v1/assistant/threads/${t.id}/messages`,
        headers: as(A.accessToken),
        payload: { content: 'again' },
      });
    const limited = await app.inject({
      method: 'POST',
      url: `/v1/assistant/threads/${t.id}/messages`,
      headers: as(A.accessToken),
      payload: { content: 'again' },
    });
    expect(limited.statusCode).toBe(429);
  });

  it('admin endpoints need the admin token and expose no content', async () => {
    expect((await app.inject({ url: '/v1/admin/sync-runs' })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/v1/admin/sync-runs', headers: { authorization: 'Bearer admintoken123' } }))
        .statusCode,
    ).toBe(200);
  });

  it('GDPR export and delete (delete wipes credentials immediately)', async () => {
    const ex = (
      await app.inject({ method: 'POST', url: '/v1/data-requests/export', headers: as(A.accessToken) })
    ).json();
    expect(ex.url).toContain('/v1/files/');
    const u = new URL(ex.url);
    const file = await app.inject({ url: u.pathname + u.search });
    expect(file.body).toContain('Reunió');
    expect(file.body).not.toContain(PASSWORD);

    const del = await app.inject({
      method: 'POST',
      url: '/v1/data-requests/delete',
      headers: as(A.accessToken),
    });
    expect(del.json()).toEqual({ deleted: true });
    expect((await pool.query('SELECT count(*)::int n FROM credentials')).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int n FROM items')).rows[0].n).toBe(0);
  });
});
