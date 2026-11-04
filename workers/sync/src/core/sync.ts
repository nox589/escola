import { createHash } from 'node:crypto';
import type { Browser } from 'playwright';
import { SelectorNotDiscoveredError, ParserDriftError } from '../adapters/errors.js';
import type { Credentials, NormalisedItem, PortalAdapter, PortalChild } from '../adapters/types.js';
import { diffItems, shouldNotify, type DiffResult, type KnownItem } from './diff.js';
import { guardedLogin, type GuardDecision, type LockoutStore } from './lockoutGuard.js';
import { log } from './logger.js';

/** Persistence seam: Postgres implementation lives behind this (T2.4); tests use memory. */
export interface ItemStore {
  known(accountId: string): Promise<KnownItem[]>;
  isFirstSync(accountId: string): Promise<boolean>;
  save(
    accountId: string,
    child: PortalChild,
    results: DiffResult[],
    attachments: StoredAttachment[],
  ): Promise<void>;
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
}

export interface RunSyncOptions {
  adapter: PortalAdapter;
  browser: Browser;
  accountId: string;
  lockout: LockoutStore;
  items: ItemStore;
  /** Decrypts creds just-in-time; implementation must zeroise after the callback. */
  withCredentials: <R>(fn: (c: Credentials) => Promise<R>) => Promise<R>;
}

export async function runSync(o: RunSyncOptions): Promise<SyncReport> {
  const report: SyncReport = {
    ok: false,
    children: [],
    counts: { new: 0, updated: 0, unchanged: 0 },
    toNotify: [],
    backfill: await o.items.isFirstSync(o.accountId),
    errors: [],
  };

  const contexts: Awaited<ReturnType<Browser['newContext']>>[] = [];
  try {
    // One fresh browser context per attempt; never shared across accounts.
    const { result, decision } = await o.withCredentials((creds) =>
      guardedLogin(o.lockout, o.accountId, async () => {
        const ctx = await o.browser.newContext();
        contexts.push(ctx);
        return o.adapter.login(ctx, creds);
      }),
    );
    report.decision = decision;
    if (!result.ok) {
      log.warn({ accountId: o.accountId, code: result.code, action: decision.action }, 'login failed');
      return report;
    }
    const page = result.page;

    report.children = await o.adapter.listChildren(page);
    const known = await o.items.known(o.accountId);

    for (const child of report.children) {
      await o.adapter.switchChild(page, child);
      const results: DiffResult[] = [];
      const attachments: StoredAttachment[] = [];
      for (const reader of o.adapter.sections()) {
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
            if (shouldNotify(d, { backfill: report.backfill }))
              report.toNotify.push({ child: child.ref, item: d.item });
          }
          results.push(...diffs);
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
      await o.items.save(o.accountId, child, results, attachments);
    }

    if (report.backfill) report.summary = { openItems: report.counts.new };
    report.ok = report.errors.length === 0;
    return report;
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => undefined)));
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
  async save(id: string, child: PortalChild, results: DiffResult[], attachments: StoredAttachment[]) {
    const rows = this.rows.get(id) ?? [];
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
    }
    this.rows.set(id, rows);
    for (const a of attachments) if (!this.files.some((f) => f.sha256 === a.sha256)) this.files.push(a);
  }
}
