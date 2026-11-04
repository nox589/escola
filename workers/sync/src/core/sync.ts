import { createHash } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright';
import { SelectorNotDiscoveredError, ParserDriftError } from '../adapters/errors.js';
import type { Credentials, NormalisedItem, PortalAdapter, PortalChild } from '../adapters/types.js';
import { diffItems, shouldNotify, type DiffResult, type KnownItem } from './diff.js';
import { guardedLogin, type GuardDecision, type LockoutStore } from './lockoutGuard.js';
import { log } from './logger.js';

/** Persistence seam: Postgres implementation lives behind this (T2.4); tests use memory. */
export interface ItemStore {
  known(accountId: string): Promise<KnownItem[]>;
  isFirstSync(accountId: string): Promise<boolean>;
  /** Persists changed items; returns stored ids so enrichment/notify jobs can follow. */
  save(
    accountId: string,
    child: PortalChild,
    results: SyncedDiff[],
    attachments: StoredAttachment[],
  ): Promise<SavedItem[]>;
}

export type SyncedDiff = DiffResult & { notify: boolean };

export interface SavedItem {
  itemId: string;
  childRef: string;
  kind: 'new' | 'updated';
  notify: boolean;
}

export interface StoredAttachment {
  portalRef: string;
  name: string;
  sha256: string;
  size: number;
  data: Buffer;
}

export interface SyncReport {
  ok: boolean;
  decision?: GuardDecision;
  children: PortalChild[];
  counts: { new: number; updated: number; unchanged: number };
  toNotify: { child: string; item: NormalisedItem }[];
  backfill: boolean;
  /** First sync: one summary only (SPEC §8.3). */
  summary?: { openItems: number };
  errors: { section: string; error: string }[];
  saved: SavedItem[];
}

export interface SessionStore {
  load(): Promise<StorageState | null>;
  save(state: StorageState): Promise<void>;
  invalidate(): Promise<void>;
}
export type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export interface PortalSessionOptions {
  adapter: PortalAdapter;
  browser: Browser;
  accountId: string;
  lockout: LockoutStore;
  /** Decrypts creds just-in-time; implementation must zeroise after the callback. */
  withCredentials: <R>(fn: (c: Credentials) => Promise<R>) => Promise<R>;
  /** Optional saved cookies: if still valid, no password is sent at all. */
  sessions?: SessionStore;
}

export interface RunSyncOptions extends PortalSessionOptions {
  items: ItemStore;
}

export interface PortalSession {
  page: Page | null;
  decision?: GuardDecision;
  reused: boolean;
  close(): Promise<void>;
}

/**
 * Logged-in page for an account. Tries the saved session first (no credentials touched);
 * otherwise logs in through the lockout guard with a fresh context per attempt.
 */
export async function openPortalSession(o: PortalSessionOptions): Promise<PortalSession> {
  const contexts: BrowserContext[] = [];
  const close = async () => {
    await Promise.all(contexts.map((c) => c.close().catch(() => undefined)));
  };

  const saved = await o.sessions?.load().catch(() => null);
  if (saved) {
    const ctx = await o.browser.newContext({ storageState: saved });
    contexts.push(ctx);
    try {
      const page = await ctx.newPage();
      if (await o.adapter.resumeSession?.(page)) return { page, reused: true, close };
    } catch {
      /* fall through to a fresh login */
    }
    await o.sessions?.invalidate().catch(() => undefined);
  }

  const { result, decision } = await o.withCredentials((creds) =>
    guardedLogin(o.lockout, o.accountId, async () => {
      const ctx = await o.browser.newContext();
      contexts.push(ctx);
      return o.adapter.login(ctx, creds);
    }),
  );
  if (!result.ok) {
    log.warn({ accountId: o.accountId, code: result.code, action: decision.action, detail: result.detail }, 'login failed');
    return { page: null, decision, reused: false, close };
  }
  await o.sessions?.save(await result.page.context().storageState()).catch(() => undefined);
  return { page: result.page, decision, reused: false, close };
}

export async function runSync(o: RunSyncOptions): Promise<SyncReport> {
  const report: SyncReport = {
    ok: false,
    children: [],
    counts: { new: 0, updated: 0, unchanged: 0 },
    toNotify: [],
    backfill: await o.items.isFirstSync(o.accountId),
    errors: [],
    saved: [],
  };

  const session = await openPortalSession(o);
  try {
    report.decision = session.decision;
    if (!session.page) return report;
    const page = session.page;

    report.children = await o.adapter.listChildren(page);
    const known = await o.items.known(o.accountId);
    // Account-wide sections (e.g. messages) are read once, not once per child.
    const accountDone = new Set<string>();

    for (const child of report.children) {
      await o.adapter.switchChild(page, child);
      const results: SyncedDiff[] = [];
      const attachments: StoredAttachment[] = [];
      for (const reader of o.adapter.sections()) {
        if (reader.scope === 'account' && accountDone.has(reader.slug)) continue;
        accountDone.add(reader.slug);
        try {
          const fresh = await reader.read(page, child);
          const diffs = diffItems(fresh, known);
          for (const d of diffs) {
            report.counts[d.kind]++;
            if (d.kind !== 'unchanged') {
              for (const a of d.item.attachments) {
                const data = await a.download(page);
                attachments.push({
                  portalRef: d.item.portalRef,
                  name: a.name,
                  data,
                  size: data.length,
                  sha256: createHash('sha256').update(data).digest('hex'),
                });
              }
            }
            const notify = shouldNotify(d, { backfill: report.backfill });
            if (notify) report.toNotify.push({ child: child.ref, item: d.item });
            results.push({ ...d, notify });
          }
        } catch (e) {
          if (e instanceof SelectorNotDiscoveredError) throw e;
          // Parser drift / per-section failure: keep last good data, raise alert, continue.
          const msg = e instanceof Error ? e.message : String(e);
          report.errors.push({ section: reader.slug, error: msg.slice(0, 200) });
          log.error(
            { accountId: o.accountId, section: reader.slug, drift: e instanceof ParserDriftError },
            'section failed',
          );
        }
      }
      report.saved.push(...(await o.items.save(o.accountId, child, results, attachments)));
    }

    if (report.backfill) report.summary = { openItems: report.counts.new };
    report.ok = report.errors.length === 0;
    return report;
  } finally {
    await session.close();
  }
}

/** Memory store for tests and the read-only canary. */
export class MemoryItemStore implements ItemStore {
  readonly rows = new Map<string, (KnownItem & { child: string })[]>();
  readonly files: StoredAttachment[] = [];
  async known(id: string) {
    return this.rows.get(id) ?? [];
  }
  async isFirstSync(id: string) {
    return !this.rows.has(id);
  }
  async save(id: string, child: PortalChild, results: SyncedDiff[], attachments: StoredAttachment[]) {
    const rows = this.rows.get(id) ?? [];
    const saved: SavedItem[] = [];
    for (const r of results) {
      if (r.kind === 'unchanged') continue;
      const idx = rows.findIndex((x) => x.section === r.item.section && x.portalRef === r.item.portalRef);
      const row = {
        portalRef: r.item.portalRef,
        section: r.item.section,
        contentHash: r.hash,
        bodyText: r.item.bodyText,
        deadlineRaw: r.item.deadlineRaw,
        child: child.ref,
      };
      if (idx >= 0) rows[idx] = row;
      else rows.push(row);
      saved.push({
        itemId: `${r.item.section}:${r.item.portalRef}`,
        childRef: child.ref,
        kind: r.kind,
        notify: r.notify,
      });
    }
    this.rows.set(id, rows);
    for (const a of attachments) if (!this.files.some((f) => f.sha256 === a.sha256)) this.files.push(a);
    return saved;
  }
}
