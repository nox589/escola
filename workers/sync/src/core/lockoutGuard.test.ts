import { describe, expect, it } from 'vitest';
import type { LoginResult } from '../adapters/types.js';
import {
  canAttemptLogin,
  decide,
  guardedLogin,
  LoginBlockedError,
  MemoryLockoutStore,
  resetForNewCredentials,
  type GuardAccount,
} from './lockoutGuard.js';

const acct = (p: Partial<GuardAccount> = {}): GuardAccount => ({
  id: 'a1',
  status: 'active',
  consecutiveAuthFailures: 0,
  credentialVersion: 1,
  ...p,
});

const invalid = (ambiguous: boolean): LoginResult => ({ ok: false, code: 'INVALID_CREDENTIALS', ambiguous });

function storeWith(a: GuardAccount) {
  const s = new MemoryLockoutStore();
  s.accounts.set(a.id, { ...a });
  return s;
}

describe('lockout guard (golden rule 2)', () => {
  it('unambiguous rejection: one attempt, then credentials_invalid, zero further attempts', async () => {
    const store = storeWith(acct());
    let calls = 0;
    const { decision } = await guardedLogin(store, 'a1', async () => {
      calls++;
      return invalid(false);
    });
    expect(calls).toBe(1);
    expect(decision).toMatchObject({
      action: 'stop',
      status: 'credentials_invalid',
      notify: 'update_password',
    });
    await expect(guardedLogin(store, 'a1', async () => (calls++, invalid(false)))).rejects.toBeInstanceOf(
      LoginBlockedError,
    );
    expect(calls).toBe(1);
  });

  it('ambiguous rejection: exactly one retry, second rejection → credentials_invalid', async () => {
    const store = storeWith(acct());
    let calls = 0;
    const { decision } = await guardedLogin(store, 'a1', async () => {
      calls++;
      return invalid(true);
    });
    expect(calls).toBe(2);
    expect(decision).toMatchObject({ action: 'stop', status: 'credentials_invalid' });
    expect(store.accounts.get('a1')!.consecutiveAuthFailures).toBe(2);
    await expect(guardedLogin(store, 'a1', async () => (calls++, invalid(true)))).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it('ambiguous then success resets the counter', async () => {
    const store = storeWith(acct());
    const results: LoginResult[] = [invalid(true), { ok: true } as LoginResult];
    const { decision } = await guardedLogin(store, 'a1', async () => results.shift()!);
    expect(decision.action).toBe('success');
    expect(store.accounts.get('a1')!.consecutiveAuthFailures).toBe(0);
  });

  it('transient errors never increment the counter', () => {
    for (const code of ['PORTAL_DOWN', 'UNKNOWN_PAGE'] as const) {
      const { decision, patch } = decide(acct(), { ok: false, code }, { isRetry: false });
      expect(patch.consecutiveAuthFailures).toBeUndefined();
      expect(patch.status).toBeUndefined();
      expect(['backoff', 'drift_alert']).toContain(decision.action);
    }
    expect(decide(acct(), { ok: false, code: 'PORTAL_DOWN' }, { isRetry: false }).decision).toMatchObject({
      delaysMin: [5, 15, 45],
    });
  });

  it('never changes passwords: expiry / forced change stop with password_expired', () => {
    for (const code of ['PASSWORD_EXPIRED', 'FORCED_PASSWORD_CHANGE'] as const)
      expect(decide(acct(), { ok: false, code }, { isRetry: false }).decision).toMatchObject({
        action: 'stop',
        status: 'password_expired',
      });
  });

  it('locked / captcha / mfa stop', () => {
    expect(decide(acct(), { ok: false, code: 'ACCOUNT_LOCKED' }, { isRetry: false }).patch.status).toBe(
      'locked',
    );
    expect(decide(acct(), { ok: false, code: 'CAPTCHA' }, { isRetry: false }).patch.status).toBe(
      'needs_login_help',
    );
    expect(decide(acct(), { ok: false, code: 'MFA_REQUIRED' }, { isRetry: false }).patch.status).toBe(
      'needs_login_help',
    );
  });

  it('a previous ambiguous failure in an earlier cycle leaves no room for a retry now', () => {
    const a = acct({ consecutiveAuthFailures: 1 });
    expect(decide(a, invalid(true), { isRetry: false }).decision.action).toBe('stop');
  });

  it('blocks any attempt unless active, and only a credential update resets', () => {
    for (const status of ['credentials_invalid', 'locked', 'password_expired', 'paused', 'disabled'] as const)
      expect(canAttemptLogin(acct({ status }))).toBe(false);
    expect(canAttemptLogin(acct({ consecutiveAuthFailures: 2 }))).toBe(false);
    const reset = resetForNewCredentials(acct({ status: 'credentials_invalid', consecutiveAuthFailures: 2 }));
    expect(reset).toEqual({ credentialVersion: 2, consecutiveAuthFailures: 0, status: 'active' });
  });

  it('serialises concurrent workers on the same account', async () => {
    const store = storeWith(acct());
    let calls = 0;
    const attempt = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return invalid(false);
    };
    const outcomes = await Promise.allSettled([
      guardedLogin(store, 'a1', attempt),
      guardedLogin(store, 'a1', attempt),
      guardedLogin(store, 'a1', attempt),
    ]);
    expect(calls).toBe(1);
    expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(2);
  });
});
