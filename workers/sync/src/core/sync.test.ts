import type { Browser, BrowserContext, Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import type { NormalisedItem, PortalAdapter, PortalChild } from '../adapters/types.js';
import { MemoryLockoutStore } from './lockoutGuard.js';
import { MemoryItemStore, runSync } from './sync.js';

const item = (ref: string, title: string): NormalisedItem => ({
  portalRef: ref,
  section: 'authorisation',
  title,
  bodyHtml: '',
  bodyText: title,
  attachments: [],
});

describe('per-child sections', () => {
  it('reads each child, and reports items listed under both children as shared', async () => {
    const kids: PortalChild[] = [
      { ref: 'M', displayName: 'Maya' },
      { ref: 'L', displayName: 'Leo' },
    ];
    let selected = 'M';
    // GestIB lists each child's own authorisations, plus a whole-school one under both.
    const lists: Record<string, NormalisedItem[]> = {
      M: [item('auth-1', 'Sortida Maya'), item('auth-all', 'Festa de Nadal')],
      L: [item('auth-2', 'Piscina Leo'), item('auth-all', 'Festa de Nadal')],
    };
    const page = { close: async () => undefined, context: () => ({ storageState: async () => ({}) }) } as unknown as Page;
    const adapter: PortalAdapter = {
      id: 'test',
      version: '1',
      login: async () => ({ ok: true, page }),
      isLoggedIn: async () => true,
      listChildren: async () => kids,
      switchChild: async (_p, c) => {
        selected = c.ref;
      },
      sections: () => [{ section: 'authorisation', slug: 'autoritzacions', scope: 'child', read: async () => lists[selected]! }],
      writers: () => ({}),
    };
    const lockout = new MemoryLockoutStore();
    lockout.accounts.set('acc', { id: 'acc', status: 'active', consecutiveAuthFailures: 0, credentialVersion: 1 });
    const items = new MemoryItemStore();
    const shared: string[] = [];
    Object.assign(items, {
      markFamilyWide: async (_a: string, refs: { portalRef: string }[]) => {
        shared.push(...refs.map((r) => r.portalRef));
        return refs.length;
      },
    });
    const browser = { newContext: async () => ({ newPage: async () => page, close: async () => undefined }) as unknown as BrowserContext } as unknown as Browser;
    const r = await runSync({ adapter, browser, accountId: 'acc', lockout, items, withCredentials: (fn) => fn({ username: 'u', password: 'p' }) });

    expect(r.ok).toBe(true);
    const saved = items.rows.get('acc')!;
    expect(saved.find((x) => x.portalRef === 'auth-2')!.child).toBe('L'); // Leo's own item is read and kept under Leo
    expect(saved.find((x) => x.portalRef === 'auth-1')!.child).toBe('M');
    expect(shared).toEqual(['auth-all']);
  });
});
