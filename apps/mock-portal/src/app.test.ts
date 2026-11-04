import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockPortal, type MockConfig } from './app.js';

let server: Server | undefined;
afterEach(() => server?.close());

async function start(cfg: Partial<MockConfig> = {}) {
  const portal = createMockPortal(cfg);
  server = portal.app.listen(0);
  await new Promise((r) => server!.once('listening', r));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  return { ...portal, base };
}

/** Tiny cookie-jar client so we can drive the state machine over HTTP. */
function client(base: string) {
  const jar = new Map<string, string>();
  const go = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(base + path, {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers ?? {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv!.split('=');
      jar.set(k!, v!);
    }
    if (res.status === 302) return go(res.headers.get('location')!);
    return { status: res.status, html: await res.text() };
  };
  const form = (path: string, body: Record<string, string>) =>
    go(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
  const login = async (username: string, password: string) => {
    await form('/idp/username', { username });
    return form('/idp/passwordLoginForm', { password });
  };
  return { go, form, login };
}

describe('mock portal state machine', () => {
  it('logs in via the two-step flow and serves sections', async () => {
    const { base } = await start();
    const c = client(base);
    expect((await c.go('/families/home')).html).toContain('data-mock="username-form"');
    const home = await c.login('parent1', 'escola123');
    expect(home.html).toContain('data-mock="logged-in"');
    expect((await c.go('/families/circulars')).html).toContain('Sortida al Parc Natural');
  });

  it('rejects bad passwords and locks after M failures', async () => {
    const { base, state } = await start({ lockoutAfter: 2 });
    const c = client(base);
    expect((await c.login('parent1', 'wrong1')).html).toContain('data-mock="login-error"');
    expect((await c.login('parent1', 'wrong2')).html).toContain('data-mock="account-locked"');
    expect((await c.login('parent1', 'escola123')).html).toContain('data-mock="account-locked"');
    expect(state.locked.has('parent1')).toBe(true);
  });

  it('expires sessions', async () => {
    const { base } = await start({ sessionTtlMs: 1 });
    const c = client(base);
    await c.login('parent1', 'escola123');
    await new Promise((r) => setTimeout(r, 5));
    expect((await c.go('/families/home')).html).toContain('data-mock="username-form"');
  });

  it('switches children', async () => {
    const { base } = await start();
    const c = client(base);
    await c.login('parent1', 'escola123');
    await c.form('/families/otherStudents', { childRef: 'child-b' });
    const html = (await c.go('/families/circulars')).html;
    expect(html).toContain('Menú del mes');
    expect(html).not.toContain('Sortida al Parc Natural');
  });

  it('shows forced-change and down states', async () => {
    const { base, config } = await start({
      accounts: [{ username: 'p2', password: 'abc12345', mode: 'forced_change' }],
    });
    const c = client(base);
    expect((await c.login('p2', 'abc12345')).html).toContain('data-mock="forced-password-change"');
    config.down = true;
    expect((await c.go('/families/home')).status).toBe(503);
  });

  it('records submissions', async () => {
    const { base, state } = await start();
    const c = client(base);
    await c.login('parent1', 'escola123');
    const r = await c.form('/families/missatges/msg-1/reply', { text: 'Hi ha cap problema.' });
    expect(r.html).toContain('data-mock="submit-ok"');
    expect(state.submissions).toHaveLength(1);
    expect(state.submissions[0]!.itemRef).toBe('msg-1');
  });
});
