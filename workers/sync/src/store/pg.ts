import { createHash } from 'node:crypto';
import { and, eq, isNull } from '@escola/db';
import type pg from 'pg';
import { schema, withFamily } from '@escola/db';
import type { BlobStore } from '@escola/storage';
import type { PortalChild, SchoolDay } from '../adapters/types.js';
import type { KnownItem } from '../core/diff.js';
import type { GuardAccount, LockoutStore } from '../core/lockoutGuard.js';
import type { ItemStore, SavedItem, StoredAttachment, SyncedDiff } from '../core/sync.js';

/**
 * Postgres lockout store. A session-level advisory lock on the account is held for the whole
 * login decision (so two workers can never both submit a password), while every counter update
 * is committed immediately in its own transaction (so a crash can never "forget" a failure).
 */
export class PgLockoutStore implements LockoutStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly familyId: string,
  ) {}

  async withLockedAccount<T>(
    id: string,
    fn: (
      a: GuardAccount,
      save: (p: Partial<GuardAccount> & { lastErrorCode?: string | null }) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    const lockClient = await this.pool.connect();
    try {
      await lockClient.query(`SET lock_timeout = '60s'`);
      await lockClient.query('SELECT pg_advisory_lock(hashtextextended($1, 42))', [id]);
      try {
        const row = await withFamily(this.pool, this.familyId, async (db) => {
          const [r] = await db.select().from(schema.portalAccounts).where(eq(schema.portalAccounts.id, id));
          return r;
        });
        if (!row) throw new Error('portal account not found');
        const account: GuardAccount = {
          id: row.id,
          status: row.status,
          consecutiveAuthFailures: row.consecutiveAuthFailures,
          credentialVersion: row.credentialVersion,
        };
        return await fn(account, async (patch) => {
          await withFamily(this.pool, this.familyId, (db) =>
            db
              .update(schema.portalAccounts)
              .set({
                ...(patch.status !== undefined && { status: patch.status }),
                ...(patch.consecutiveAuthFailures !== undefined && {
                  consecutiveAuthFailures: patch.consecutiveAuthFailures,
                }),
                ...(patch.lastErrorCode !== undefined && { lastErrorCode: patch.lastErrorCode }),
                ...(patch.consecutiveAuthFailures === 0 && { lastLoginAt: new Date() }),
                updatedAt: new Date(),
              })
              // Only touch the row if nobody updated the credentials meanwhile.
              .where(
                and(
                  eq(schema.portalAccounts.id, id),
                  eq(schema.portalAccounts.credentialVersion, account.credentialVersion),
                ),
              ),
          );
        });
      } finally {
        await lockClient.query('SELECT pg_advisory_unlock(hashtextextended($1, 42))', [id]);
      }
    } finally {
      lockClient.release();
    }
  }
}

const EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};
const mimeOf = (name: string) =>
  EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

export class PgItemStore implements ItemStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly familyId: string,
    private readonly blobs: BlobStore,
  ) {}

  async known(accountId: string): Promise<KnownItem[]> {
    return withFamily(this.pool, this.familyId, (db) =>
      db
        .select({
          portalRef: schema.items.portalItemRef,
          section: schema.items.section,
          contentHash: schema.items.contentHash,
          bodyText: schema.items.originalBodyText,
          deadlineRaw: schema.items.deadlineRaw,
        })
        .from(schema.items)
        .where(eq(schema.items.portalAccountId, accountId)),
    );
  }

  async isFirstSync(accountId: string): Promise<boolean> {
    return withFamily(this.pool, this.familyId, async (db) => {
      const [r] = await db
        .select({ last: schema.portalAccounts.lastSyncAt })
        .from(schema.portalAccounts)
        .where(eq(schema.portalAccounts.id, accountId));
      return !r?.last;
    });
  }

  async pruneChildren(accountId: string, keepRefs: string[]): Promise<number> {
    return withFamily(this.pool, this.familyId, async (db) => {
      const stale = (
        await db
          .select({ id: schema.children.id, ref: schema.children.portalChildRef })
          .from(schema.children)
          .where(eq(schema.children.portalAccountId, accountId))
      ).filter((c) => !keepRefs.includes(c.ref));
      for (const c of stale) {
        // Items and calendar entries survive as family-wide; re-attribution happens on enrichment.
        await db.update(schema.items).set({ childId: null, enrichedHash: null }).where(eq(schema.items.childId, c.id));
        await db.update(schema.calendarEntries).set({ childId: null }).where(eq(schema.calendarEntries.childId, c.id));
        await db.delete(schema.children).where(eq(schema.children.id, c.id));
      }
      return stale.length;
    });
  }

  /** School term calendar: replaced wholesale on every sync (kind 'school', no item). */
  async saveSchoolCalendar(_accountId: string, days: SchoolDay[]): Promise<void> {
    const label: Record<SchoolDay['type'], [string, string]> = {
      holiday: ['Vacances', 'School holiday'],
      public_holiday: ['Festiu', 'Public holiday'],
      local_holiday: ['Festiu local', 'Local holiday'],
      non_teaching: ['Dia no lectiu', 'No school (non-teaching day)'],
      free_choice: ['Dia de lliure disposició', 'No school (school free day)'],
    };
    await withFamily(this.pool, this.familyId, async (db) => {
      await db
        .delete(schema.calendarEntries)
        .where(and(eq(schema.calendarEntries.kind, 'school'), isNull(schema.calendarEntries.itemId)));
      if (!days.length) return;
      await db.insert(schema.calendarEntries).values(
        days.map((d) => ({
          familyId: this.familyId,
          titleOriginal: label[d.type][0],
          titleTranslated: label[d.type][1],
          startsAt: new Date(`${d.date}T00:00:00+01:00`),
          allDay: true,
          kind: 'school',
        })),
      );
    });
  }

  async save(
    accountId: string,
    child: PortalChild,
    results: SyncedDiff[],
    attachments: StoredAttachment[],
  ): Promise<SavedItem[]> {
    // Upload attachments outside the DB transaction; content-addressed so re-uploads are no-ops.
    const keys = new Map<string, string>();
    for (const a of attachments) {
      const key = `${this.familyId}/att/${a.sha256}`;
      if (!keys.has(a.sha256)) await this.blobs.put(key, a.data, mimeOf(a.name));
      keys.set(a.sha256, key);
    }

    return withFamily(this.pool, this.familyId, async (db) => {
      const [existingChild] = await db
        .select()
        .from(schema.children)
        .where(
          and(eq(schema.children.portalAccountId, accountId), eq(schema.children.portalChildRef, child.ref)),
        );
      const DEFAULT_COLOURS = ['#1F6B52', '#3D5BA9', '#B4561E', '#8A3D8F', '#2E7F94', '#9A7B12'];
      const siblings = existingChild
        ? 0
        : (await db.select({ id: schema.children.id }).from(schema.children)).length;
      const childRow =
        existingChild ??
        (
          await db
            .insert(schema.children)
            .values({
              familyId: this.familyId,
              portalAccountId: accountId,
              portalChildRef: child.ref,
              displayName: child.displayName,
              schoolName: child.schoolName,
              classLabel: child.classLabel,
              colour: DEFAULT_COLOURS[siblings % DEFAULT_COLOURS.length],
            })
            .returning()
        )[0]!;

      const saved: SavedItem[] = [];
      for (const r of results) {
        if (r.kind === 'unchanged') continue;
        const it = r.item;
        const values = {
          familyId: this.familyId,
          portalAccountId: accountId,
          childId: childRow.id,
          section: it.section,
          portalItemRef: it.portalRef,
          contentHash: r.hash,
          originalTitle: it.title,
          originalBodyHtml: it.bodyHtml,
          originalBodyText: it.bodyText,
          sender: it.sender ?? null,
          postedAt: it.postedAt ? new Date(it.postedAt) : null,
          deadlineRaw: it.deadlineRaw ?? null,
        };
        const [row] = await db
          .insert(schema.items)
          .values(values)
          .onConflictDoUpdate({
            target: [schema.items.portalAccountId, schema.items.section, schema.items.portalItemRef],
            set: {
              contentHash: r.hash,
              originalTitle: it.title,
              originalBodyHtml: it.bodyHtml,
              originalBodyText: it.bodyText,
              deadlineRaw: it.deadlineRaw ?? null,
              updatedAt: new Date(),
            },
          })
          .returning({ id: schema.items.id });

        for (const a of attachments.filter((x) => x.portalRef === it.portalRef)) {
          const exists = await db
            .select({ id: schema.attachments.id })
            .from(schema.attachments)
            .where(and(eq(schema.attachments.itemId, row!.id), eq(schema.attachments.sha256, a.sha256)));
          if (exists.length) continue;
          await db.insert(schema.attachments).values({
            familyId: this.familyId,
            itemId: row!.id,
            filename: a.name,
            mime: mimeOf(a.name),
            size: a.size,
            sha256: a.sha256,
            s3Key: keys.get(a.sha256)!,
          });
        }
        saved.push({ itemId: row!.id, childRef: child.ref, kind: r.kind, notify: r.notify });
      }
      return saved;
    });
  }
}

export function snapshotKey(familyId: string, html: string) {
  return `${familyId}/snap/${createHash('sha256').update(html).digest('hex')}`;
}
