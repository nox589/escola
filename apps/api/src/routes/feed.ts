import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, or, schema, sql } from '@escola/db';
import { ACTION_STATES, itemsQuery } from '@escola/shared';
import type { AppDeps } from '../context.js';
import { fam, HttpError, me } from '../app.js';
import { asApp } from '../services/auth.js';

const idParam = z.object({ id: z.string().uuid() });

async function userLocale(deps: AppDeps, userId: string) {
  const [u] = await asApp(deps.pool, (db) =>
    db.select({ locale: schema.users.locale }).from(schema.users).where(eq(schema.users.id, userId)),
  );
  return u?.locale ?? 'en';
}

const encodeCursor = (postedAt: Date | null, id: string) =>
  Buffer.from(JSON.stringify([postedAt?.toISOString() ?? null, id])).toString('base64url');
const decodeCursor = (c: string): [string | null, string] =>
  JSON.parse(Buffer.from(c, 'base64url').toString());

export async function feedRoutes(app: FastifyInstance, deps: AppDeps) {
  const auth = { onRequest: app.authenticate };

  app.get('/items', auth, async (req) => {
    const q = itemsQuery.parse(req.query);
    const p = me(req);
    const locale = await userLocale(deps, p.userId);
    return fam(deps, req, async (db) => {
      const conds = [];
      // Family-wide items (no child) show under every child.
      if (q.child_id) conds.push(or(eq(schema.items.childId, q.child_id), isNull(schema.items.childId))!);
      if (q.section) conds.push(eq(schema.items.section, q.section));
      if (q.since) conds.push(gte(schema.items.firstSeenAt, new Date(q.since)));
      if (q.needs_action) conds.push(isNotNull(schema.itemActions.id));
      if (q.cursor) {
        const [ts, id] = decodeCursor(q.cursor);
        conds.push(
          ts
            ? or(
                lt(schema.items.postedAt, new Date(ts)),
                and(eq(schema.items.postedAt, new Date(ts)), lt(schema.items.id, id)),
              )!
            : lt(schema.items.id, id),
        );
      }
      const rows = await db
        .select({
          item: schema.items,
          child: {
            id: schema.children.id,
            name: schema.children.displayName,
            colour: schema.children.colour,
          },
          tr: schema.itemTranslations,
          action: schema.itemActions,
        })
        .from(schema.items)
        .leftJoin(schema.children, eq(schema.children.id, schema.items.childId))
        .leftJoin(
          schema.itemTranslations,
          and(eq(schema.itemTranslations.itemId, schema.items.id), eq(schema.itemTranslations.lang, locale)),
        )
        .leftJoin(
          schema.itemActions,
          and(eq(schema.itemActions.itemId, schema.items.id), eq(schema.itemActions.state, 'open')),
        )
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(sql`${schema.items.postedAt} DESC NULLS LAST`, desc(schema.items.id))
        .limit(q.limit + 1);

      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      const ids = page.map((r) => r.item.id);
      const attCounts = new Map<string, number>();
      if (ids.length)
        for (const a of await db
          .select({ itemId: schema.attachments.itemId })
          .from(schema.attachments)
          .where(inArray(schema.attachments.itemId, ids)))
          attCounts.set(a.itemId, (attCounts.get(a.itemId) ?? 0) + 1);
      return {
        items: page.map(({ item, child, tr, action }) => ({
          id: item.id,
          section: item.section,
          child: child?.id ? child : null,
          original: { title: item.originalTitle, lang: item.originalLang ?? 'ca' },
          title: tr?.title ?? item.originalTitle,
          summary: tr?.summary ?? null,
          translated: !!tr,
          checkOriginal: (tr?.qualityFlags as string[] | undefined)?.includes('check_original') ?? false,
          sender: item.sender,
          postedAt: item.postedAt?.toISOString() ?? null,
          read: !!(item.isReadBy as Record<string, boolean>)[p.userId],
          attachments: attCounts.get(item.id) ?? 0,
          action: action
            ? {
                id: action.id,
                kind: action.kind,
                deadlineAt: action.deadlineAt?.toISOString() ?? null,
                confidence: action.confidence,
              }
            : null,
        })),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last.item.postedAt, last.item.id) : null,
      };
    });
  });

  // ---- Messages: conversations grouped by sender (teacher / office) ----
  const threadKey = (sender: string | null) => Buffer.from(sender ?? '', 'utf8').toString('base64url') || 'school';
  const senderOf = (key: string) => (key === 'school' ? null : Buffer.from(key, 'base64url').toString('utf8'));

  async function loadMessages(req: Parameters<typeof me>[0], sender?: string | null) {
    const p = me(req);
    const locale = await userLocale(deps, p.userId);
    return fam(deps, req, async (db) => {
      const rows = await db
        .select({ item: schema.items, child: { id: schema.children.id, name: schema.children.displayName, colour: schema.children.colour }, tr: schema.itemTranslations })
        .from(schema.items)
        .leftJoin(schema.children, eq(schema.children.id, schema.items.childId))
        .leftJoin(schema.itemTranslations, and(eq(schema.itemTranslations.itemId, schema.items.id), eq(schema.itemTranslations.lang, locale)))
        .where(
          and(
            eq(schema.items.section, 'message'),
            sender === undefined ? undefined : sender === null ? isNull(schema.items.sender) : eq(schema.items.sender, sender),
          ),
        )
        .orderBy(sql`${schema.items.postedAt} ASC NULLS FIRST`, asc(schema.items.id))
        .limit(500);
      const ids = rows.map((r) => r.item.id);
      const replies = ids.length
        ? await db
            .select()
            .from(schema.submissions)
            .where(and(eq(schema.submissions.kind, 'reply_message'), inArray(schema.submissions.itemId, ids)))
            .orderBy(asc(schema.submissions.createdAt))
        : [];
      return { rows, replies, userId: p.userId };
    });
  }

  app.get('/threads', auth, async (req) => {
    const { rows, userId } = await loadMessages(req);
    const by = new Map<string, { key: string; sender: string | null; children: Map<string, { id: string; name: string; colour: string | null }>; last: (typeof rows)[number]; unread: number; count: number }>();
    for (const r of rows) {
      const key = threadKey(r.item.sender);
      const t = by.get(key) ?? { key, sender: r.item.sender, children: new Map(), last: r, unread: 0, count: 0 };
      if (r.child?.id) t.children.set(r.child.id, r.child as { id: string; name: string; colour: string | null });
      t.last = r;
      t.count++;
      if (!(r.item.isReadBy as Record<string, boolean>)[userId]) t.unread++;
      by.set(key, t);
    }
    return [...by.values()]
      .map((t) => ({
        key: t.key,
        sender: t.sender,
        children: [...t.children.values()],
        count: t.count,
        unread: t.unread,
        lastAt: t.last.item.postedAt?.toISOString() ?? null,
        lastTitle: t.last.tr?.title ?? t.last.item.originalTitle,
        lastSummary: t.last.tr?.summary ?? null,
      }))
      .sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
  });

  app.get('/threads/:key', auth, async (req) => {
    const { key } = z.object({ key: z.string().min(1).max(400) }).parse(req.params);
    const { rows, replies, userId } = await loadMessages(req, senderOf(key));
    if (!rows.length) throw new HttpError(404, 'not_found');
    return {
      key,
      sender: rows[0]!.item.sender,
      messages: rows.map(({ item, child, tr }) => ({
        id: item.id,
        child: child?.id ? child : null,
        postedAt: item.postedAt?.toISOString() ?? null,
        read: !!(item.isReadBy as Record<string, boolean>)[userId],
        title: tr?.title ?? item.originalTitle,
        body: tr?.body ?? null,
        original: { title: item.originalTitle, body: item.originalBodyText, lang: item.originalLang ?? 'ca' },
      })),
      replies: replies.map((s) => ({
        id: s.id,
        itemId: s.itemId,
        state: s.state,
        text: String((s.userInput as { text?: string }).text ?? ''),
        sentText: s.draftOriginal,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  });

  app.get('/items/:id', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    const p = me(req);
    const locale = await userLocale(deps, p.userId);
    return fam(deps, req, async (db) => {
      const [row] = await db
        .select({ item: schema.items, child: schema.children })
        .from(schema.items)
        .leftJoin(schema.children, eq(schema.children.id, schema.items.childId))
        .where(eq(schema.items.id, id));
      if (!row) throw new HttpError(404, 'not_found');
      const trs = await db
        .select()
        .from(schema.itemTranslations)
        .where(eq(schema.itemTranslations.itemId, id));
      const tr = trs.find((t) => t.lang === locale) ?? trs[0] ?? null;
      const actions = await db.select().from(schema.itemActions).where(eq(schema.itemActions.itemId, id));
      const atts = await db.select().from(schema.attachments).where(eq(schema.attachments.itemId, id));
      const { item, child } = row;
      return {
        id: item.id,
        section: item.section,
        child: child ? { id: child.id, name: child.displayName, colour: child.colour } : null,
        // Golden rule 5: the original always travels with the translation.
        original: {
          title: item.originalTitle,
          body: item.originalBodyText,
          html: item.originalBodyHtml,
          lang: item.originalLang ?? 'ca',
        },
        translation: tr
          ? {
              lang: tr.lang,
              title: tr.title,
              body: tr.body,
              summary: tr.summary,
              checkOriginal: (tr.qualityFlags as string[]).includes('check_original'),
            }
          : null,
        sender: item.sender,
        postedAt: item.postedAt?.toISOString() ?? null,
        actions: actions.map((a) => ({
          id: a.id,
          kind: a.kind,
          deadlineAt: a.deadlineAt?.toISOString() ?? null,
          deadlineSource: a.deadlineSource,
          confidence: a.confidence,
          state: a.state,
        })),
        attachments: atts.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, size: a.size })),
      };
    });
  });

  app.post('/items/:id/read', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    const uid = me(req).userId;
    await fam(deps, req, (db) =>
      db
        .update(schema.items)
        .set({
          isReadBy: sql`${schema.items.isReadBy} || jsonb_build_object(${uid}::text, true)`,
          status: 'seen',
        })
        .where(eq(schema.items.id, id)),
    );
    return { ok: true };
  });

  app.post('/items/:id/actions/:actionId', auth, async (req) => {
    const { id, actionId } = z
      .object({ id: z.string().uuid(), actionId: z.string().uuid() })
      .parse(req.params);
    const { state } = z.object({ state: z.enum(ACTION_STATES).exclude(['done_in_app']) }).parse(req.body);
    return fam(deps, req, async (db) => {
      const [a] = await db
        .update(schema.itemActions)
        .set({ state, updatedAt: new Date() })
        .where(and(eq(schema.itemActions.id, actionId), eq(schema.itemActions.itemId, id)))
        .returning();
      if (!a) throw new HttpError(404, 'not_found');
      return { id: a.id, state: a.state };
    });
  });

  // ---- Documents ----
  app.get('/attachments', auth, async (req) => {
    const q = z
      .object({ child_id: z.string().uuid().optional(), q: z.string().max(100).optional() })
      .parse(req.query);
    return fam(deps, req, async (db) => {
      const conds = [];
      // Family-wide items (no child) show under every child.
      if (q.child_id) conds.push(or(eq(schema.items.childId, q.child_id), isNull(schema.items.childId))!);
      if (q.q)
        conds.push(
          or(ilike(schema.attachments.filename, `%${q.q}%`), ilike(schema.items.originalTitle, `%${q.q}%`))!,
        );
      const rows = await db
        .select({
          a: schema.attachments,
          item: {
            id: schema.items.id,
            title: schema.items.originalTitle,
            postedAt: schema.items.postedAt,
            childId: schema.items.childId,
          },
        })
        .from(schema.attachments)
        .innerJoin(schema.items, eq(schema.items.id, schema.attachments.itemId))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(schema.attachments.createdAt))
        .limit(200);
      return rows.map(({ a, item }) => ({
        id: a.id,
        filename: a.filename,
        mime: a.mime,
        size: a.size,
        item,
      }));
    });
  });

  app.get('/attachments/:id/url', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    const a = await fam(
      deps,
      req,
      async (db) => (await db.select().from(schema.attachments).where(eq(schema.attachments.id, id)))[0],
    );
    if (!a) throw new HttpError(404, 'not_found');
    return { url: await deps.blobs.signedUrl(a.s3Key, 300), expiresIn: 300 };
  });

  // ---- Calendar ----
  app.get('/calendar', auth, async (req) => {
    const q = z
      .object({
        from: z.string().datetime(),
        to: z.string().datetime(),
        child_id: z.string().uuid().optional(),
      })
      .parse(req.query);
    return fam(deps, req, async (db) => {
      const rows = await db
        .select({
          e: schema.calendarEntries,
          child: { name: schema.children.displayName, colour: schema.children.colour },
        })
        .from(schema.calendarEntries)
        .leftJoin(schema.children, eq(schema.children.id, schema.calendarEntries.childId))
        .where(
          and(
            gte(schema.calendarEntries.startsAt, new Date(q.from)),
            lte(schema.calendarEntries.startsAt, new Date(q.to)),
            q.child_id
              ? or(eq(schema.calendarEntries.childId, q.child_id), isNull(schema.calendarEntries.childId))
              : undefined,
          ),
        )
        .orderBy(asc(schema.calendarEntries.startsAt));
      return rows.map(({ e, child }) => ({
        id: e.id,
        itemId: e.itemId,
        childId: e.childId,
        child,
        title: e.titleTranslated ?? e.titleOriginal,
        titleOriginal: e.titleOriginal,
        startsAt: e.startsAt.toISOString(),
        endsAt: e.endsAt?.toISOString() ?? null,
        allDay: e.allDay,
        kind: e.kind,
      }));
    });
  });

  /** Open actions summary for the Home screen header. */
  app.get('/summary', auth, async (req) =>
    fam(deps, req, async (db) => {
      const open = await db
        .select({ id: schema.itemActions.id, deadlineAt: schema.itemActions.deadlineAt })
        .from(schema.itemActions)
        .where(eq(schema.itemActions.state, 'open'));
      const accounts = await db.select().from(schema.portalAccounts);
      const now = Date.now();
      return {
        openActions: open.length,
        dueSoon: open.filter((a) => a.deadlineAt && a.deadlineAt.getTime() - now < 3 * 86400_000).length,
        accounts: accounts.map((a) => ({
          id: a.id,
          status: a.status,
          lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
          stale: !!a.lastSyncAt && now - a.lastSyncAt.getTime() > 24 * 3600_000,
        })),
      };
    }),
  );
}
