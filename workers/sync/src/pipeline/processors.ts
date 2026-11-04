import type pg from 'pg';
import type { Browser } from 'playwright';
import type { KmsUnwrapper, KmsWrapper } from '@escola/crypto';
import { and, eq, isNull, schema, withFamily } from '@escola/db';
import type { Embedder, LlmProvider } from '@escola/llm';
import type { BlobStore } from '@escola/storage';
import { SelectorNotDiscoveredError } from '../adapters/errors.js';
import type { PortalAdapter } from '../adapters/types.js';
import { BACKOFF_MIN } from '../core/lockoutGuard.js';
import { log } from '../core/logger.js';
import { runSync } from '../core/sync.js';
import { translateLabels } from '../enrich/labels.js';
import { inDailyWindow, notifyNewAbsences, sendDailySummaries } from '../notify/daily.js';
import { enrichItems } from '../enrich/job.js';
import { notifyAccountProblem, notifyBackfillSummary, notifyItems } from '../notify/job.js';
import type { PushSender } from '../notify/push.js';
import { credentialsProvider } from '../store/credentials.js';
import { PgItemStore, PgLockoutStore } from '../store/pg.js';
import { PgSessionStore } from '../store/sessions.js';
import { isDue, jitter } from './schedule.js';

export interface SyncJob {
  familyId: string;
  portalAccountId: string;
  attempt?: number;
  manual?: boolean;
}
export interface EnrichJob {
  familyId: string;
  itemIds: string[];
  notifyIds: string[];
  backfill: boolean;
}
export interface NotifyJob {
  familyId: string;
  itemIds: string[];
  userIds?: string[];
  urgent?: boolean;
}
export interface SubmitJob {
  familyId: string;
  submissionId: string;
}

export interface Enqueue {
  sync(job: SyncJob, delayMs?: number): Promise<void>;
  enrich(job: EnrichJob): Promise<void>;
  notify(job: NotifyJob, delayMs?: number): Promise<void>;
  submit(job: SubmitJob): Promise<void>;
}

export interface Deps {
  pool: pg.Pool;
  browser: () => Promise<Browser>;
  kms: KmsWrapper & KmsUnwrapper;
  llm: LlmProvider;
  embedder: Embedder;
  blobs: BlobStore;
  sender: PushSender;
  adapterFor: (portal: string) => PortalAdapter;
  enqueue: Enqueue;
  now?: () => Date;
}

async function audit(pool: pg.Pool, familyId: string, action: string, target: string, metadata: object = {}) {
  await withFamily(pool, familyId, (db) =>
    db
      .insert(schema.auditLog)
      .values({ actor: 'worker', actorId: 'sync', familyId, action, target, metadata }),
  );
}

export async function processSync(d: Deps, job: SyncJob): Promise<{ result: string }> {
  const { pool, familyId, portalAccountId } = { pool: d.pool, ...job };
  const account = await withFamily(pool, familyId, async (db) => {
    const [a] = await db
      .select()
      .from(schema.portalAccounts)
      .where(eq(schema.portalAccounts.id, portalAccountId));
    return a;
  });
  if (!account) return { result: 'account_missing' };
  if (account.status !== 'active') return { result: `skipped_${account.status}` };

  const adapter = d.adapterFor(account.portal);
  const [run] = await withFamily(pool, familyId, (db) =>
    db
      .insert(schema.syncRuns)
      .values({ familyId, portalAccountId, adapterVersion: `${adapter.id}@${adapter.version}` })
      .returning(),
  );

  let result = 'ok';
  try {
    const report = await runSync({
      adapter,
      browser: await d.browser(),
      accountId: portalAccountId,
      lockout: new PgLockoutStore(pool, familyId),
      items: new PgItemStore(pool, familyId, d.blobs),
      withCredentials: credentialsProvider(pool, d.kms, familyId, portalAccountId),
      sessions: new PgSessionStore(pool, d.kms, familyId, portalAccountId),
    });

    const decision = report.decision;
    if (decision?.action === 'stop') {
      result = `stopped_${decision.status}`;
      await notifyAccountProblem({ pool, familyId, problem: decision.notify, sender: d.sender });
      await audit(pool, familyId, 'login_stopped', portalAccountId, { status: decision.status });
    } else if (decision?.action === 'backoff') {
      const attempt = job.attempt ?? 0;
      result = 'portal_down';
      if (attempt < BACKOFF_MIN.length)
        await d.enqueue.sync({ ...job, attempt: attempt + 1 }, BACKOFF_MIN[attempt]! * 60_000);
    } else if (decision?.action === 'drift_alert') {
      result = 'unknown_page';
      // Pause: the scheduler must not keep re-sending the password to a page we cannot classify.
      await withFamily(pool, familyId, (db) =>
        db
          .update(schema.portalAccounts)
          .set({ status: 'paused', lastErrorCode: 'UNKNOWN_PAGE' })
          .where(eq(schema.portalAccounts.id, portalAccountId)),
      );
      log.error({ portalAccountId, alert: 'parser_drift' }, 'unknown page after login; account paused');
    } else {
      // Logged in (fresh or reused session).
      result = report.errors.length ? 'partial' : 'ok';
      await withFamily(pool, familyId, (db) =>
        db
          .update(schema.portalAccounts)
          .set({ lastSyncAt: new Date(), lastErrorCode: report.errors.length ? 'PARSER_DRIFT' : null })
          .where(eq(schema.portalAccounts.id, portalAccountId)),
      );
      // Items left without a processed version (e.g. after a duplicate child was removed): re-process.
      const unprocessed = await withFamily(pool, familyId, (db) =>
        db
          .select({ id: schema.items.id })
          .from(schema.items)
          .where(and(eq(schema.items.portalAccountId, portalAccountId), isNull(schema.items.enrichedHash))),
      );
      const savedIds = new Set(report.saved.map((s) => s.itemId));
      const extra = unprocessed.map((r) => r.id).filter((x) => !savedIds.has(x));
      for (let i = 0; i < extra.length; i += 10)
        await d.enqueue.enrich({ familyId, itemIds: extra.slice(i, i + 10), notifyIds: [], backfill: false });
      if (report.saved.length)
        await d.enqueue.enrich({
          familyId,
          itemIds: report.saved.map((s) => s.itemId),
          notifyIds: report.saved.filter((s) => s.notify).map((s) => s.itemId),
          backfill: report.backfill,
        });
      else if (report.backfill)
        await notifyBackfillSummary({ pool, familyId, openActions: 0, sender: d.sender });
      if (report.newAbsences?.length)
        await notifyNewAbsences({ pool, familyId, sender: d.sender, children: report.newAbsences }).catch((e) =>
          log.warn({ familyId, err: e instanceof Error ? e.message.slice(0, 120) : 'error' }, 'absence push failed'),
        );
      await translateLabels({ pool, familyId, llm: d.llm }).catch((e) =>
        log.warn({ familyId, err: e instanceof Error ? e.message.slice(0, 120) : 'error' }, 'label translation failed'),
      );
    }

    await withFamily(pool, familyId, (db) =>
      db
        .update(schema.syncRuns)
        .set({
          finishedAt: new Date(),
          result,
          sections: {
            counts: report.counts,
            errors: report.errors.map((e) => e.section),
            reused: report.decision === undefined,
          },
        })
        .where(eq(schema.syncRuns.id, run!.id)),
    );
    log.info({ portalAccountId, result, children: report.children.length, counts: report.counts, errors: report.errors.map((e) => e.section) }, 'sync finished');
    return { result };
  } catch (e) {
    result = e instanceof SelectorNotDiscoveredError ? 'selectors_not_discovered' : 'error';
    await withFamily(pool, familyId, (db) =>
      db
        .update(schema.syncRuns)
        .set({ finishedAt: new Date(), result, sections: { error: e instanceof Error ? e.name : 'unknown' } })
        .where(eq(schema.syncRuns.id, run!.id)),
    );
    if (result === 'selectors_not_discovered') {
      // Nothing was sent to GestIB. Tell the app so it stops waiting (shown as "not ready yet").
      await withFamily(pool, familyId, (db) =>
        db
          .update(schema.portalAccounts)
          .set({ lastErrorCode: 'GESTIB_NOT_READY' })
          .where(eq(schema.portalAccounts.id, portalAccountId)),
      );
      log.warn({ portalAccountId, result }, 'sync skipped: GestIB selectors not captured yet');
    }
    if (result === 'error') {
      log.error({ portalAccountId, err: e instanceof Error ? e.name : 'unknown' }, 'sync failed');
      throw e;
    }
    return { result };
  }
}

export async function processEnrich(d: Deps, job: EnrichJob) {
  const results = await enrichItems({
    pool: d.pool,
    familyId: job.familyId,
    itemIds: job.itemIds,
    llm: d.llm,
    embedder: d.embedder,
  });
  if (job.backfill) {
    // First sync: one summary only (SPEC §8.3).
    const open = results.filter((r) => r.needsAction).length;
    await notifyBackfillSummary({
      pool: d.pool,
      familyId: job.familyId,
      openActions: open,
      sender: d.sender,
    });
  } else if (job.notifyIds.length) {
    await d.enqueue.notify({ familyId: job.familyId, itemIds: job.notifyIds });
  }
  return { enriched: results.length };
}

export async function processNotify(d: Deps, job: NotifyJob) {
  const out = await notifyItems({ ...job, pool: d.pool, sender: d.sender, now: d.now?.() });
  if (out.deferredUntil && out.deferredUserIds.length) {
    await d.enqueue.notify(
      { ...job, userIds: out.deferredUserIds },
      Math.max(0, out.deferredUntil.getTime() - (d.now?.() ?? new Date()).getTime()),
    );
  }
  return out;
}

/** Scheduler tick: enqueue a sync for every active account whose slot has passed. */
export async function processTick(d: Deps): Promise<number> {
  const now = d.now?.() ?? new Date();
  const client = await d.pool.connect();
  let rows: { portal_account_id: string; family_id: string; last_sync_at: Date | null }[];
  try {
    await client.query('SET ROLE escola_app');
    rows = (await client.query('SELECT * FROM accounts_due_for_sync()')).rows;
    await client.query('RESET ROLE');
  } finally {
    client.release();
  }
  let n = 0;
  for (const r of rows) {
    if (!isDue(now, r.last_sync_at)) continue;
    await d.enqueue.sync({ familyId: r.family_id, portalAccountId: r.portal_account_id }, jitter());
    n++;
  }
  // Morning summary, once per user per day (deduplicated in sendDailySummaries).
  if (inDailyWindow(now))
    for (const familyId of new Set(rows.map((r) => r.family_id)))
      await sendDailySummaries({ pool: d.pool, familyId, sender: d.sender, now }).catch((e) =>
        log.warn({ familyId, err: e instanceof Error ? e.message.slice(0, 120) : 'error' }, 'daily summary failed'),
      );
  return n;
}
