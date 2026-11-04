/**
 * End-to-end pipeline vs mock portal, real Postgres, real Chromium, fake LLM, in-memory queue + push.
 * scheduler tick → sync → enrich → notify, and confirmed submission → portal → receipt.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDevKms, sealCredentials } from '@escola/crypto';
import { createPool, eq, schema, withFamily } from '@escola/db';
import { FakeEmbedder, FakeProvider } from '@escola/llm';
import { LocalBlobStore } from '@escola/storage';
import { createMockPortal, type MockState } from '../../../../apps/mock-portal/src/app.js';
import { createTestDatabase } from '../../../../packages/db/src/testing.js';
import { createGestibAdapter } from '../adapters/gestib/adapter.js';
import { mockSelectors } from '../adapters/gestib/selectors.mock.js';
import { computePreviewHash } from '../core/writeback.js';
import { MemoryPushSender } from '../notify/push.js';
import { processSubmit } from '../submit/job.js';
import { processEnrich, processNotify, processSync, processTick, type Deps } from './processors.js';

const base = process.env.TEST_DATABASE_URL;
const CHROME = process.env.CHROME_PATH ?? ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const d = base && CHROME ? describe : describe.skip;

d('pipeline', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let pool: pg.Pool;
  let browser: Browser;
  let server: Server;
  let portal: MockState;
  let deps: Deps;
  const queue: { kind: string; job: never; delay?: number }[] = [];
  const sender = new MemoryPushSender();
  const kms = new LocalDevKms(randomBytes(32).toString('base64'));
  const familyId = crypto.randomUUID();
  let userId: string;
  let accountId: string;
  const noon = new Date('2026-11-04T11:00:00Z'); // 12:00 Madrid, not quiet hours

  async function addAccount(password: string) {
    const [acc] = await withFamily(pool, familyId, (tx) =>
      tx.insert(schema.portalAccounts).values({ familyId, usernameHint: 'p*****1' }).returning(),
    );
    const env = await sealCredentials(kms, { username: 'parent1', password }, acc!.id);
    await withFamily(pool, familyId, (tx) =>
      tx.insert(schema.credentials).values({
        familyId,
        portalAccountId: acc!.id,
        ciphertext: Buffer.from(env.ciphertext),
        iv: Buffer.from(env.iv),
        authTag: Buffer.from(env.authTag),
        wrappedDek: Buffer.from(env.wrappedDek),
        kmsKeyId: env.kmsKeyId,
        keyVersion: env.keyVersion,
      }),
    );
    return acc!.id;
  }

  async function drain() {
    while (queue.length) {
      const { kind, job } = queue.shift()!;
      if (kind === 'sync') await processSync(deps, job);
      if (kind === 'enrich') await processEnrich(deps, job);
      if (kind === 'notify') await processNotify(deps, job);
      if (kind === 'submit') await processSubmit(deps, job);
    }
  }

  beforeAll(async () => {
    db = await createTestDatabase(base!);
    pool = createPool(db.url);
    const admin = new pg.Client({ connectionString: db.url });
    await admin.connect();
    userId = (await admin.query(`INSERT INTO users(email, locale) VALUES ('p@x.test','en') RETURNING id`))
      .rows[0].id;
    await admin.query(`INSERT INTO families(id,name,owner_user_id) VALUES ($1,'F',$2)`, [familyId, userId]);
    await admin.query(
      `INSERT INTO family_members(family_id,user_id,role,can_submit) VALUES ($1,$2,'owner',true)`,
      [familyId, userId],
    );
    await admin.query(
      `INSERT INTO devices(user_id,expo_push_token,platform,locale) VALUES ($1,'ExponentPushToken[test]','ios','en')`,
      [userId],
    );
    await admin.end();

    const mp = createMockPortal();
    portal = mp.state;
    server = mp.app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    const adapter = createGestibAdapter({ selectors: mockSelectors(url), enabledWriters: ['reply_message'] });

    deps = {
      pool,
      browser: async () => browser,
      kms,
      llm: new FakeProvider(),
      embedder: new FakeEmbedder(),
      blobs: new LocalBlobStore(await mkdtemp(join(tmpdir(), 'b-')), 'http://api', 's'),
      sender,
      adapterFor: () => adapter,
      now: () => noon,
      enqueue: {
        sync: async (job, delay) => void queue.push({ kind: 'sync', job: job as never, delay }),
        enrich: async (job) => void queue.push({ kind: 'enrich', job: job as never }),
        notify: async (job, delay) => void queue.push({ kind: 'notify', job: job as never, delay }),
        submit: async (job) => void queue.push({ kind: 'submit', job: job as never }),
      },
    };
    accountId = await addAccount('escola123');
  });

  afterAll(async () => {
    server?.close();
    await browser?.close();
    await pool?.end();
    await db?.drop();
  });

  it('tick → sync → enrich: backfill stores translations, actions, embeddings and sends ONE summary', async () => {
    expect(await processTick(deps)).toBe(1);
    await drain();

    const data = await withFamily(pool, familyId, async (tx) => ({
      items: await tx.select().from(schema.items),
      tr: await tx.select().from(schema.itemTranslations),
      actions: await tx.select().from(schema.itemActions),
      cal: await tx.select().from(schema.calendarEntries),
      emb: await tx.select({ id: schema.embeddings.id }).from(schema.embeddings),
      runs: await tx.select().from(schema.syncRuns),
      acc: (await tx.select().from(schema.portalAccounts))[0]!,
    }));
    expect(data.items).toHaveLength(3);
    expect(data.items.every((i) => i.enrichedHash?.startsWith(`${i.contentHash}@`))).toBe(true);
    expect(data.tr).toHaveLength(3);
    expect(data.items.every((i) => i.originalTitle && i.originalBodyText)).toBe(true); // original kept
    const trip = data.items.find((i) => i.portalItemRef === 'circ-1')!;
    const action = data.actions.find((a) => a.itemId === trip.id)!;
    expect(action.kind).toBe('consent');
    expect(action.deadlineSource).toBe('portal_field');
    expect(action.deadlineAt!.toISOString().slice(0, 10)).toBe('2026-11-12');
    expect(data.cal).toHaveLength(1);
    expect(data.emb.length).toBeGreaterThan(0);
    expect(data.runs[0]!.result).toBe('ok');
    expect(data.acc.lastSyncAt).not.toBeNull();

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.msg.title).toBe("You're set up");
    expect(sender.sent[0]!.msg.body).toContain('1 thing needs');
  });

  it('second sync reuses the saved session: no password sent, nothing new, no pushes', async () => {
    const before = portal.loginAttempts.length;
    await processSync(deps, { familyId, portalAccountId: accountId });
    await drain();
    expect(portal.loginAttempts.length).toBe(before);
    expect(sender.sent).toHaveLength(1);
  });

  it('a confirmed reply is sent once, verified, receipted and the parent is told', async () => {
    const [child, item] = await withFamily(pool, familyId, async (tx) => [
      (await tx.select().from(schema.children).where(eq(schema.children.portalChildRef, 'child-a')))[0]!,
      (await tx.select().from(schema.items).where(eq(schema.items.portalItemRef, 'msg-1')))[0]!,
    ]);
    const text = 'Gràcies, hi serem.';
    const hash = computePreviewHash({
      kind: 'reply_message',
      itemRef: 'msg-1',
      childRef: 'child-a',
      text,
      fields: {},
    });
    const sub = await withFamily(pool, familyId, async (tx) => {
      const [s] = await tx
        .insert(schema.submissions)
        .values({
          familyId,
          childId: child.id,
          itemId: item.id,
          kind: 'reply_message',
          userInput: { text: 'Thanks, we will be there.' },
          userLang: 'en',
          draftOriginal: text,
          payload: {},
        })
        .returning();
      await tx
        .insert(schema.submissionConfirmations)
        .values({ familyId, submissionId: s!.id, userId, previewHash: hash });
      await tx.update(schema.submissions).set({ state: 'queued' }).where(eq(schema.submissions.id, s!.id));
      return s!;
    });
    await deps.enqueue.submit({ familyId, submissionId: sub.id });
    await drain();

    const after = await withFamily(pool, familyId, async (tx) => ({
      sub: (await tx.select().from(schema.submissions).where(eq(schema.submissions.id, sub.id)))[0]!,
      receipt: (await tx.select().from(schema.receipts))[0],
      audit: (await tx.select().from(schema.auditLog)).map((a) => a.action),
    }));
    expect(after.sub.state).toBe('succeeded');
    expect(after.receipt?.screenshotS3Key).toBeTruthy();
    expect(after.audit).toEqual(expect.arrayContaining(['submission_started', 'submission_succeeded']));
    expect(portal.submissions).toHaveLength(1);
    expect(portal.submissions[0]!.text).toBe(text);
    expect(sender.sent.at(-1)!.msg.title).toBe('Sent ✓');

    // Re-queuing the same submission never sends again.
    await processSubmit(deps, { familyId, submissionId: sub.id });
    expect(portal.submissions).toHaveLength(1);
  });

  it('wrong password: one attempt, account stops, parent is told to update it', async () => {
    const badId = await addAccount('wrong123');
    const before = portal.loginAttempts.length;
    const r = await processSync(deps, { familyId, portalAccountId: badId });
    expect(r.result).toBe('stopped_credentials_invalid');
    expect(portal.loginAttempts.length - before).toBe(1);
    expect(sender.sent.at(-1)!.msg.title).toBe('GestIB login stopped');
    expect((await processSync(deps, { familyId, portalAccountId: badId })).result).toBe(
      'skipped_credentials_invalid',
    );
    expect(portal.loginAttempts.length - before).toBe(1);
  });
});
