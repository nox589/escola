import { createHash } from 'node:crypto';
import { and, eq, isNotNull, isNull, ne, or } from '@escola/db';
import type pg from 'pg';
import { schema, withFamily } from '@escola/db';
import type { BlobStore } from '@escola/storage';
import type { ChildDetails, PortalChild, SchoolDay } from '../adapters/types.js';
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

  private async resetSharedEnrichment(db: Parameters<Parameters<typeof withFamily>[2]>[0], accountId: string) {
    await db
      .update(schema.items)
      .set({ enrichedHash: null })
      .where(and(eq(schema.items.portalAccountId, accountId), or(eq(schema.items.shared, true), isNull(schema.items.childId))));
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
      if (stale.length) await this.resetSharedEnrichment(db, accountId);
      return stale.length;
    });
  }

  /**
   * Items GestIB lists under more than one child: assign to the one child the text names, else
   * family-wide. Deterministic, so repeated syncs settle on the same answer.
   */
  /**
   * Items GestIB lists under more than one child: marked shared once and re-enriched, so the AI
   * decides who they are for (named child, or by class/stage, else family-wide).
   */
  /**
   * Items a per-child read listed under exactly one child belong to that child. Repairs items left
   * family-wide by an earlier bad listing (sets shared=false and the child; re-enriches on change).
   */
  async attributeToChild(accountId: string, refs: { section: string; portalRef: string; childRef: string }[]): Promise<number> {
    return withFamily(this.pool, this.familyId, async (db) => {
      const kids = await db
        .select({ id: schema.children.id, ref: schema.children.portalChildRef })
        .from(schema.children)
        .where(eq(schema.children.portalAccountId, accountId));
      let n = 0;
      for (const r of refs) {
        const childId = kids.find((k) => k.ref === r.childRef)?.id;
        if (!childId) continue;
        const rows = await db
          .update(schema.items)
          .set({ shared: false, childId, enrichedHash: null })
          .where(
            and(
              eq(schema.items.portalAccountId, accountId),
              eq(schema.items.section, r.section as never),
              eq(schema.items.portalItemRef, r.portalRef),
              or(eq(schema.items.shared, true), isNull(schema.items.childId), ne(schema.items.childId, childId)),
            ),
          )
          .returning({ id: schema.items.id });
        for (const row of rows) await db.update(schema.calendarEntries).set({ childId }).where(eq(schema.calendarEntries.itemId, row.id));
        n += rows.length;
      }
      return n;
    });
  }

  async markFamilyWide(accountId: string, refs: { section: string; portalRef: string }[]): Promise<number> {
    return withFamily(this.pool, this.familyId, async (db) => {
      let n = 0;
      for (const r of refs) {
        const rows = await db
          .update(schema.items)
          .set({ shared: true, childId: null, enrichedHash: null })
          .where(
            and(
              eq(schema.items.portalAccountId, accountId),
              eq(schema.items.section, r.section as never),
              eq(schema.items.portalItemRef, r.portalRef),
              eq(schema.items.shared, false),
            ),
          )
          .returning({ id: schema.items.id });
        for (const row of rows) await db.update(schema.calendarEntries).set({ childId: null }).where(eq(schema.calendarEntries.itemId, row.id));
        n += rows.length;
      }
      return n;
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

  async saveChildDetails(accountId: string, child: PortalChild, d: ChildDetails): Promise<{ childId: string; newAbsences: number } | null> {
    return withFamily(this.pool, this.familyId, async (db) => {
      const [row] = await db
        .select({ id: schema.children.id, synced: schema.children.detailsSyncedAt })
        .from(schema.children)
        .where(and(eq(schema.children.portalAccountId, accountId), eq(schema.children.portalChildRef, child.ref)));
      if (!row) return null;
      const childId = row.id;
      let newAbsences = 0;
      const [before] = await db.select({ classLabel: schema.children.classLabel }).from(schema.children).where(eq(schema.children.id, childId));
      if (d.profile?.classLabel && d.profile.classLabel !== before?.classLabel)
        await db
          .update(schema.items)
          .set({ enrichedHash: null })
          .where(and(eq(schema.items.portalAccountId, accountId), or(eq(schema.items.shared, true), isNull(schema.items.childId))));
      if (d.profile && (d.profile.schoolName || d.profile.classLabel))
        await db
          .update(schema.children)
          .set({
            ...(d.profile.schoolName ? { schoolName: d.profile.schoolName } : {}),
            ...(d.profile.classLabel ? { classLabel: d.profile.classLabel } : {}),
          })
          .where(eq(schema.children.id, childId));
      if (d.timetable)
        await db
          .update(schema.children)
          .set({ timetable: d.timetable, detailsSyncedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.children.id, childId));
      if (d.absences) {
        const keep = d.absences.map((a) => a.ref);
        const existing = await db
          .select({ id: schema.absences.id, ref: schema.absences.portalRef })
          .from(schema.absences)
          .where(eq(schema.absences.childId, childId));
        const known = new Set(existing.map((x) => x.ref));
        // Alert only for absences that appear after the first sync (not the backlog).
        if (row.synced) newAbsences = d.absences.filter((a) => !known.has(a.ref) && a.status === 'unjustified').length;
        for (const e of existing.filter((x) => !keep.includes(x.ref)))
          await db.delete(schema.absences).where(eq(schema.absences.id, e.id));
        for (const a of d.absences) {
          const v = {
            day: a.day,
            period: a.period,
            subject: a.subject,
            kind: a.kind,
            status: a.status,
            reason: a.reason,
            schoolNote: a.schoolNote,
            canJustify: a.canJustify,
          };
          await db
            .insert(schema.absences)
            .values({ familyId: this.familyId, childId, portalRef: a.ref, ...v })
            .onConflictDoUpdate({ target: [schema.absences.childId, schema.absences.portalRef], set: { ...v, updatedAt: new Date() } });
        }
      }
      if (d.agenda) {
        await db
          .delete(schema.calendarEntries)
          .where(and(eq(schema.calendarEntries.childId, childId), isNotNull(schema.calendarEntries.sourceRef)));
        if (d.agenda.length)
          await db.insert(schema.calendarEntries).values(
            d.agenda.map((e) => ({
              familyId: this.familyId,
              childId,
              titleOriginal: e.title,
              startsAt: new Date(e.start),
              endsAt: e.end ? new Date(e.end) : null,
              allDay: e.allDay,
              kind: e.kind === 'evaluation' ? 'evaluation' : e.kind === 'meeting' ? 'meeting' : e.kind === 'trip' ? 'trip' : 'event',
              sourceRef: e.ref,
            })),
          );
      }
      return { childId, newAbsences };
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
      const DEFAULT_COLOURS = ['#005451', '#C0CF58', '#946000', '#3D5BA9', '#8A3D8F', '#2E7F94'];
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
      // A new child changes who family-wide items could be for: re-run attribution on them.
      if (!existingChild) await this.resetSharedEnrichment(db, accountId);

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
