import type { LoginFailureCode, PortalAccountStatus } from '@escola/shared';
import type { LoginResult } from '../adapters/types.js';

/**
 * SPEC §8.4 lockout guard — CLAUDE.md golden rule 2. Pure decision logic plus a store interface
 * whose Postgres implementation holds a row lock (SELECT ... FOR UPDATE) for the whole decision.
 *
 * Invariants:
 *  - A password is only ever submitted while status === 'active'.
 *  - Per credential version, at most 2 password submissions can fail (1 + one retry when ambiguous).
 *  - An unambiguous rejection stops immediately (no retry).
 *  - Only a credentials update (PUT /credentials) bumps the version and resets the counter.
 *  - Transient errors (PORTAL_DOWN, UNKNOWN_PAGE) never touch the counter.
 */

export const MAX_FAILURES_PER_VERSION = 2;

export interface GuardAccount {
  id: string;
  status: PortalAccountStatus;
  consecutiveAuthFailures: number;
  credentialVersion: number;
}

export type GuardDecision =
  | { action: 'success' }
  | { action: 'retry_fresh_context' }
  | {
      action: 'stop';
      status: PortalAccountStatus;
      notify: 'update_password' | 'password_expired' | 'account_locked' | 'login_help';
    }
  | { action: 'backoff'; delaysMin: readonly number[] }
  | { action: 'drift_alert' };

export const BACKOFF_MIN = [5, 15, 45] as const;

export function canAttemptLogin(a: GuardAccount): boolean {
  return a.status === 'active' && a.consecutiveAuthFailures < MAX_FAILURES_PER_VERSION;
}

/** Returns the decision and the account fields to persist. */
export function decide(
  a: GuardAccount,
  result: LoginResult,
  attempt: { isRetry: boolean },
): { decision: GuardDecision; patch: Partial<GuardAccount> & { lastErrorCode?: LoginFailureCode | null } } {
  if (result.ok) {
    return { decision: { action: 'success' }, patch: { consecutiveAuthFailures: 0, lastErrorCode: null } };
  }
  switch (result.code) {
    case 'INVALID_CREDENTIALS': {
      const failures = a.consecutiveAuthFailures + 1;
      const mayRetry =
        result.ambiguous === true &&
        !attempt.isRetry &&
        failures < MAX_FAILURES_PER_VERSION &&
        a.status === 'active';
      if (mayRetry) {
        return {
          decision: { action: 'retry_fresh_context' },
          patch: { consecutiveAuthFailures: failures, lastErrorCode: result.code },
        };
      }
      return {
        decision: { action: 'stop', status: 'credentials_invalid', notify: 'update_password' },
        patch: {
          consecutiveAuthFailures: failures,
          status: 'credentials_invalid',
          lastErrorCode: result.code,
        },
      };
    }
    case 'PASSWORD_EXPIRED':
    case 'FORCED_PASSWORD_CHANGE':
      // Never change the password for the parent.
      return {
        decision: { action: 'stop', status: 'password_expired', notify: 'password_expired' },
        patch: { status: 'password_expired', lastErrorCode: result.code },
      };
    case 'ACCOUNT_LOCKED':
      return {
        decision: { action: 'stop', status: 'locked', notify: 'account_locked' },
        patch: { status: 'locked', lastErrorCode: result.code },
      };
    case 'CAPTCHA':
    case 'MFA_REQUIRED':
      return {
        decision: { action: 'stop', status: 'needs_login_help', notify: 'login_help' },
        patch: { status: 'needs_login_help', lastErrorCode: result.code },
      };
    case 'PORTAL_DOWN':
      return {
        decision: { action: 'backoff', delaysMin: BACKOFF_MIN },
        patch: { lastErrorCode: result.code },
      };
    case 'UNKNOWN_PAGE':
      return { decision: { action: 'drift_alert' }, patch: { lastErrorCode: result.code } };
  }
}

/** Called only from PUT /portal-accounts/{id}/credentials. */
export function resetForNewCredentials(a: GuardAccount): Partial<GuardAccount> {
  return { credentialVersion: a.credentialVersion + 1, consecutiveAuthFailures: 0, status: 'active' };
}

// ---- Store + runner ----

export interface LockoutStore {
  /** Loads the account under an exclusive lock for the duration of `fn`. */
  withLockedAccount<T>(
    id: string,
    fn: (
      a: GuardAccount,
      save: (p: Partial<GuardAccount> & { lastErrorCode?: string | null }) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T>;
}

export class LoginBlockedError extends Error {
  constructor(readonly status: PortalAccountStatus) {
    super(`Login blocked: account status is ${status}`);
    this.name = 'LoginBlockedError';
  }
}

/**
 * Runs the login with the guard. `attemptLogin` must create a FRESH browser context each call.
 * The account row stays locked across attempts so two workers can never both submit a password.
 */
export async function guardedLogin<T extends LoginResult>(
  store: LockoutStore,
  accountId: string,
  attemptLogin: () => Promise<T>,
): Promise<{ result: T; decision: GuardDecision }> {
  return store.withLockedAccount(accountId, async (account, save) => {
    let current = { ...account };
    let isRetry = false;
    for (;;) {
      if (!canAttemptLogin(current)) throw new LoginBlockedError(current.status);
      const result = await attemptLogin();
      const { decision, patch } = decide(current, result, { isRetry });
      await save(patch);
      current = { ...current, ...patch } as GuardAccount;
      if (decision.action === 'retry_fresh_context') {
        isRetry = true;
        continue;
      }
      return { result, decision };
    }
  });
}

/** In-memory store for tests and the canary. */
export class MemoryLockoutStore implements LockoutStore {
  readonly accounts = new Map<string, GuardAccount & { lastErrorCode?: string | null }>();
  #locks = new Map<string, Promise<unknown>>();

  async withLockedAccount<T>(
    id: string,
    fn: (a: GuardAccount, save: (p: Partial<GuardAccount>) => Promise<void>) => Promise<T>,
  ): Promise<T> {
    const prev = this.#locks.get(id) ?? Promise.resolve();
    const run = prev
      .catch(() => undefined)
      .then(async () => {
        const a = this.accounts.get(id);
        if (!a) throw new Error('account not found');
        return fn({ ...a }, async (p) => {
          Object.assign(a, p);
        });
      });
    this.#locks.set(id, run);
    return run;
  }
}
