/**
 * Worker integration tests: real Chromium (Playwright) against apps/mock-portal.
 * Never touches real GestIB. Requires a Chromium; set CHROME_PATH or install Playwright browsers.
 */
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createMockPortal, type MockConfig } from '../../../../../apps/mock-portal/src/app.js';
import { SelectorNotDiscoveredError, WriteNotConfirmedError } from '../errors.js';
import { MemoryLockoutStore } from '../../core/lockoutGuard.js';
import { MemoryItemStore, runSync } from '../../core/sync.js';
import { computePreviewHash, runSubmission } from '../../core/writeback.js';
import { createGestibAdapter } from './adapter.js';
import { mockSelectors } from './selectors.mock.js';

const CHROME = process.env.CHROME_PATH ?? ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const d = CHROME || process.env.PLAYWRIGHT_BROWSERS_PATH ? describe : describe.skip;

d('GestIB adapter vs mock portal', () => {
  let browser: Browser;
  let server: Server | undefined;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  });
  afterAll(async () => browser?.close());
  afterEach(() => server?.close());

  async function setup(cfg: Partial<MockConfig> = {}, enabledWriters: 'reply_message'[] = []) {
    const portal = createMockPortal(cfg);
    server = portal.app.listen(0);
    await new Promise((r) => server!.once('listening', r));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const adapter = createGestibAdapter({ selectors: mockSelectors(base), enabledWriters });
    const lockout = new MemoryLockoutStore();
    lockout.accounts.set('acc', {
      id: 'acc',
      status: 'active',
      consecutiveAuthFailures: 0,
      credentialVersion: 1,
    });
    return { ...portal, base, adapter, lockout };
  }

  const creds =
    (password = 'escola123') =>
    async <R>(fn: (c: { username: string; password: string }) => Promise<R>) =>
      fn({ username: 'parent1', password });

  it('real selectors are placeholders and refuse to run', async () => {
    const adapter = createGestibAdapter(); // real selectors.ts, all TO_BE_DISCOVERED
    const ctx = await browser.newContext();
    await expect(adapter.login(ctx, { username: 'x', password: 'y' })).rejects.toBeInstanceOf(
      SelectorNotDiscoveredError,
    );
    await ctx.close();
  });

  it('full sync: two children, items attributed, attachments downloaded, backfill sends one summary', async () => {
    const { adapter, lockout } = await setup();
    const items = new MemoryItemStore();
    const r1 = await runSync({
      adapter,
      browser,
      accountId: 'acc',
      lockout,
      items,
      withCredentials: creds(),
    });
    expect(r1.ok).toBe(true);
    expect(r1.children.map((c) => c.ref)).toEqual(['child-a', 'child-b']);
    expect(r1.backfill).toBe(true);
    expect(r1.toNotify).toHaveLength(0);
    expect(r1.summary).toEqual({ openItems: 4 });
    const rows = items.rows.get('acc')!;
    expect(rows.find((x) => x.portalRef === 'circ-2')!.child).toBe('child-b');
    expect(rows.find((x) => x.portalRef === 'circ-1')!.child).toBe('child-a');
    expect(items.files).toHaveLength(1);
    expect(items.files[0]!.data.toString()).toContain('%PDF');

    // AC T2.4: rerun creates 0 new items
    const r2 = await runSync({
      adapter,
      browser,
      accountId: 'acc',
      lockout,
      items,
      withCredentials: creds(),
    });
    expect(r2.counts.new).toBe(0);
    expect(r2.counts.unchanged).toBe(4);
    expect(r2.backfill).toBe(false);
  });

  it('wrong password: exactly one portal attempt, account goes credentials_invalid', async () => {
    const { adapter, lockout, state } = await setup({ lockoutAfter: 3 });
    const items = new MemoryItemStore();
    const r = await runSync({
      adapter,
      browser,
      accountId: 'acc',
      lockout,
      items,
      withCredentials: creds('wrong1'),
    });
    expect(r.ok).toBe(false);
    expect(r.decision).toMatchObject({ action: 'stop', status: 'credentials_invalid' });
    expect(state.loginAttempts).toHaveLength(1);
    expect(lockout.accounts.get('acc')!.status).toBe('credentials_invalid');
    await expect(
      runSync({ adapter, browser, accountId: 'acc', lockout, items, withCredentials: creds('wrong1') }),
    ).rejects.toThrow(/Login blocked/);
    expect(state.loginAttempts).toHaveLength(1);
    expect(state.locked).toHaveLength(0); // we never got near the portal's own lockout
  });

  it('classifies forced password change, captcha and portal down', async () => {
    const forced = await setup({
      accounts: [{ username: 'parent1', password: 'escola123', mode: 'forced_change' }],
    });
    const ctx1 = await browser.newContext();
    expect(await forced.adapter.login(ctx1, { username: 'parent1', password: 'escola123' })).toMatchObject({
      ok: false,
      code: 'FORCED_PASSWORD_CHANGE',
    });
    await ctx1.close();
    server!.close();

    const cap = await setup({ accounts: [{ username: 'parent1', password: 'escola123', mode: 'captcha' }] });
    const ctx2 = await browser.newContext();
    expect(await cap.adapter.login(ctx2, { username: 'parent1', password: 'escola123' })).toMatchObject({
      code: 'CAPTCHA',
    });
    await ctx2.close();
    server!.close();

    const down = await setup({ down: true });
    const ctx3 = await browser.newContext();
    expect(await down.adapter.login(ctx3, { username: 'parent1', password: 'escola123' })).toMatchObject({
      code: 'PORTAL_DOWN',
    });
    await ctx3.close();
  });

  it('reply writer: refuses without confirmation; with one, submits exactly once and verifies', async () => {
    const { adapter, state } = await setup({}, ['reply_message']);
    const ctx = await browser.newContext();
    const login = await adapter.login(ctx, { username: 'parent1', password: 'escola123' });
    if (!login.ok) throw new Error('login failed');

    const base = {
      submissionId: 's1',
      kind: 'reply_message' as const,
      itemRef: 'msg-1',
      childRef: 'child-a',
      text: 'Hi anirem.',
      fields: {},
    };
    const previewHash = computePreviewHash(base);

    await expect(runSubmission(adapter, login.page, { ...base, previewHash }, null)).rejects.toBeInstanceOf(
      WriteNotConfirmedError,
    );
    // Text edited after confirming → hash mismatch → refused.
    await expect(
      runSubmission(
        adapter,
        login.page,
        { ...base, text: 'Edited', previewHash },
        { previewHash, invalidatedAt: null, userCanSubmit: true },
      ),
    ).rejects.toBeInstanceOf(WriteNotConfirmedError);
    // Invalidated confirmation → refused.
    await expect(
      runSubmission(
        adapter,
        login.page,
        { ...base, previewHash },
        { previewHash, invalidatedAt: new Date(), userCanSubmit: true },
      ),
    ).rejects.toBeInstanceOf(WriteNotConfirmedError);
    expect(state.mutatingRequests).toBe(0);

    const out = await runSubmission(
      adapter,
      login.page,
      { ...base, previewHash },
      { previewHash, invalidatedAt: null, userCanSubmit: true },
    );
    expect(out.state).toBe('succeeded');
    expect(state.submissions).toHaveLength(1);
    expect(state.submissions[0]!.text).toBe('Hi anirem.');
    await ctx.close();
  });

  it('writers are off unless feature-flagged', async () => {
    const { adapter } = await setup();
    expect(adapter.writers()).toEqual({});
  });
});
