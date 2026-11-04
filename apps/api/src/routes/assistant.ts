import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, cosineDistance, desc, eq, gte, lte, schema, sql } from '@escola/db';
import type { AppDeps } from '../context.js';
import { fam, HttpError, me } from '../app.js';
import { asApp } from '../services/auth.js';
import { SCHOOL_KB } from '../services/kb.js';

/**
 * In-app assistant (SPEC §12): RAG over the family's own items (RLS + explicit family filter),
 * plus structured context (open actions, next two weeks of calendar) and a small curated KB.
 * Cites item ids; says "I don't know" rather than guessing; never submits anything.
 */

const LANG: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  ca: 'Catalan',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  nl: 'Dutch',
};

function system(locale: string, today: string) {
  return `You are the assistant inside Escola, an app that helps parents follow their children's school messages from GestIB (Balearic Islands). Today is ${today} (Europe/Madrid).

Answer in ${LANG[locale] ?? 'English'}, briefly and concretely.
Use ONLY the <today>, <recent_updates>, <items>, <open_actions>, <calendar> and <kb> provided. <calendar> includes school holidays and non-teaching days ("Family" entries) for the next six months, plus trips, events and deadlines. "This week" means Monday to Sunday of the week containing <today>. For "what's due" questions, list every open action with its deadline, soonest first. If the answer is genuinely not there, say so plainly and suggest checking the original message or asking the school. Never invent dates, amounts or names.
When you use an item, cite it as [item:<id>] right after the claim.
You cannot send anything to the school. If the parent wants to reply, justify an absence or answer an authorisation, tell them to use the "Reply" or action button on that item, which shows them exactly what will be sent before anything goes out.`;
}

export async function assistantRoutes(app: FastifyInstance, deps: AppDeps) {
  const auth = { onRequest: app.authenticate };

  app.post('/assistant/threads', auth, async (req) => {
    const p = me(req);
    const [t] = await fam(deps, req, (db) =>
      db.insert(schema.chatThreads).values({ familyId: p.familyId, userId: p.userId }).returning(),
    );
    return { id: t!.id };
  });

  app.get('/assistant/threads/:id', auth, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return fam(deps, req, async (db) => {
      const [t] = await db
        .select()
        .from(schema.chatThreads)
        .where(and(eq(schema.chatThreads.id, id), eq(schema.chatThreads.userId, me(req).userId)));
      if (!t) throw new HttpError(404, 'not_found');
      const msgs = await db
        .select()
        .from(schema.chatMessages)
        .where(eq(schema.chatMessages.threadId, id))
        .orderBy(asc(schema.chatMessages.createdAt));
      return {
        id: t.id,
        messages: msgs.map((m) => ({
          role: m.role,
          content: m.content,
          citedItemIds: m.citedItemIds,
          at: m.createdAt,
        })),
      };
    });
  });

  app.post('/assistant/threads/:id/messages', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { content } = z.object({ content: z.string().min(1).max(2000) }).parse(req.body);
    const p = me(req);
    const now = deps.now?.() ?? new Date();
    const [user] = await asApp(deps.pool, (db) =>
      db.select().from(schema.users).where(eq(schema.users.id, p.userId)),
    );

    const ctx = await fam(deps, req, async (db) => {
      const [t] = await db
        .select()
        .from(schema.chatThreads)
        .where(and(eq(schema.chatThreads.id, id), eq(schema.chatThreads.userId, p.userId)));
      if (!t) throw new HttpError(404, 'not_found');
      // Per-family daily limit [ASSUMPTION 50/day].
      const [{ n } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.chatMessages)
        .where(
          and(
            eq(schema.chatMessages.role, 'user'),
            gte(schema.chatMessages.createdAt, new Date(now.getTime() - 86400_000)),
          ),
        );
      if (n >= deps.config.assistantDailyLimit) throw new HttpError(429, 'assistant_daily_limit');

      const history = await db
        .select()
        .from(schema.chatMessages)
        .where(eq(schema.chatMessages.threadId, id))
        .orderBy(desc(schema.chatMessages.createdAt))
        .limit(10);
      await db
        .insert(schema.chatMessages)
        .values({ familyId: p.familyId, threadId: id, userId: p.userId, role: 'user', content });

      const [qv] = await deps.embedder.embed([content], 'query');
      const hits = await db
        .select({
          itemId: schema.embeddings.itemId,
          text: schema.embeddings.text,
          d: cosineDistance(schema.embeddings.vector, qv!),
        })
        .from(schema.embeddings)
        .where(eq(schema.embeddings.familyId, p.familyId)) // explicit filter on top of RLS
        .orderBy(cosineDistance(schema.embeddings.vector, qv!))
        .limit(8);
      // Always include the most recent items too: without a semantic embedder (demo setup) the
      // search above is keyword-based, and "what's on this week?" has no keywords to match.
      const recent = await db
        .select({ itemId: schema.embeddings.itemId, text: schema.embeddings.text, d: sql<number>`1` })
        .from(schema.embeddings)
        .innerJoin(schema.items, eq(schema.items.id, schema.embeddings.itemId))
        .where(eq(schema.embeddings.familyId, p.familyId))
        .orderBy(desc(schema.items.postedAt))
        .limit(16);
      const seenText = new Set(hits.map((h) => h.text));
      for (const r of recent) {
        if (seenText.has(r.text)) continue;
        seenText.add(r.text);
        hits.push(r);
      }
      const itemIds = [...new Set(hits.map((h) => h.itemId))];
      const meta = itemIds.length
        ? await db
            .select({
              id: schema.items.id,
              title: schema.items.originalTitle,
              postedAt: schema.items.postedAt,
              child: schema.children.displayName,
            })
            .from(schema.items)
            .leftJoin(schema.children, eq(schema.children.id, schema.items.childId))
            .where(sql`${schema.items.id} in ${itemIds}`)
        : [];
      const open = await db
        .select({
          itemId: schema.itemActions.itemId,
          kind: schema.itemActions.kind,
          deadlineAt: schema.itemActions.deadlineAt,
          title: schema.items.originalTitle,
          child: schema.children.displayName,
        })
        .from(schema.itemActions)
        .innerJoin(schema.items, eq(schema.items.id, schema.itemActions.itemId))
        .leftJoin(schema.children, eq(schema.children.id, schema.items.childId))
        .where(eq(schema.itemActions.state, 'open'));
      const cal = await db
        .select({
          title: schema.calendarEntries.titleTranslated,
          orig: schema.calendarEntries.titleOriginal,
          at: schema.calendarEntries.startsAt,
          itemId: schema.calendarEntries.itemId,
          child: schema.children.displayName,
        })
        .from(schema.calendarEntries)
        .leftJoin(schema.children, eq(schema.children.id, schema.calendarEntries.childId))
        .where(
          and(
            gte(schema.calendarEntries.startsAt, new Date(now.getTime() - 86400_000)),
            lte(schema.calendarEntries.startsAt, new Date(now.getTime() + 200 * 86400_000)),
          ),
        );
      // Everything recent, as translated summaries, so "what's new / due this week" is answerable.
      const recentItems = await db
        .select({
          id: schema.items.id,
          section: schema.items.section,
          postedAt: schema.items.postedAt,
          origTitle: schema.items.originalTitle,
          title: schema.itemTranslations.title,
          summary: schema.itemTranslations.summary,
          child: schema.children.displayName,
        })
        .from(schema.items)
        .leftJoin(
          schema.itemTranslations,
          and(eq(schema.itemTranslations.itemId, schema.items.id), eq(schema.itemTranslations.lang, user!.locale ?? 'en')),
        )
        .leftJoin(schema.children, eq(schema.children.id, schema.items.childId))
        .orderBy(desc(schema.items.postedAt))
        .limit(40);
      return {
        recentItems,
        history: history.reverse(),
        hits,
        meta,
        open,
        cal,
        validIds: new Set(itemIds.concat(open.map((o) => o.itemId), recentItems.map((r) => r.id))),
      };
    });

    const metaById = new Map(ctx.meta.map((m) => [m.id, m]));
    const day = (d: Date) => d.toISOString().slice(0, 10);
    // Collapse runs of identical all-day school entries (holidays) into ranges.
    const calLines: string[] = [];
    const sortedCal = [...ctx.cal].sort((a, b) => a.at.getTime() - b.at.getTime());
    for (let i = 0; i < sortedCal.length; i++) {
      const c = sortedCal[i]!;
      const label = `${c.child ?? 'Family'}: ${c.title ?? c.orig}`;
      let j = i;
      while (
        !c.itemId &&
        j + 1 < sortedCal.length &&
        !sortedCal[j + 1]!.itemId &&
        (sortedCal[j + 1]!.title ?? sortedCal[j + 1]!.orig) === (c.title ?? c.orig) &&
        sortedCal[j + 1]!.at.getTime() - sortedCal[j]!.at.getTime() <= 3 * 86400_000
      )
        j++;
      calLines.push(
        `- ${day(c.at)}${j > i ? ` to ${day(sortedCal[j]!.at)}` : ''} ${label}${c.itemId ? ` [item:${c.itemId}]` : ''}`,
      );
      i = j;
    }
    const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Europe/Madrid' }).format(now);
    const context = `<today>${weekday} ${day(now)} (Europe/Madrid)</today>
<recent_updates>
${ctx.recentItems.map((r) => `- [item:${r.id}] ${r.postedAt ? day(r.postedAt) : ''} ${r.section} ${r.child ?? 'Family'}: ${r.title ?? r.origTitle}${r.summary ? `. ${r.summary}` : ''}`).join('\n') || '(none)'}
</recent_updates>
<items>
${ctx.hits
  .map((h) => {
    const m = metaById.get(h.itemId);
    return `<item id="${h.itemId}" child="${m?.child ?? ''}" posted="${m?.postedAt?.toISOString().slice(0, 10) ?? ''}" title="${m?.title ?? ''}">${h.text}</item>`;
  })
  .join('\n')}
</items>
<open_actions>
${ctx.open.map((o) => `- [item:${o.itemId}] ${o.child ?? ''}: ${o.kind} "${o.title}"${o.deadlineAt ? ` due ${o.deadlineAt.toISOString().slice(0, 10)}` : ''}`).join('\n') || '(none)'}
</open_actions>
<calendar>
${calLines.join('\n') || '(nothing in the next six months)'}
</calendar>
<kb>
${SCHOOL_KB}
</kb>`;

    // Raw stream: carry over headers Fastify already set (CORS etc.).
    reply.raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    let full = '';
    try {
      for await (const delta of deps.chatLlm.stream({
        system: system(user!.locale, now.toISOString().slice(0, 10)),
        messages: [
          ...ctx.history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          { role: 'user', content: `${context}\n\n<question>${content}</question>` },
        ],
      })) {
        full += delta;
        reply.raw.write(`event: delta\ndata: ${JSON.stringify({ text: delta })}\n\n`);
      }
    } catch {
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: 'assistant_unavailable' })}\n\n`);
    }
    // Keep only citations to items this family actually has.
    const cited = [...full.matchAll(/\[item:([0-9a-f-]{36})\]/g)]
      .map((m) => m[1]!)
      .filter((x) => ctx.validIds.has(x));
    await fam(deps, req, (db) =>
      db
        .insert(schema.chatMessages)
        .values({
          familyId: p.familyId,
          threadId: id,
          role: 'assistant',
          content: full,
          citedItemIds: [...new Set(cited)],
        }),
    );
    reply.raw.write(`event: done\ndata: ${JSON.stringify({ citedItemIds: [...new Set(cited)] })}\n\n`);
    reply.raw.end();
    return reply;
  });
}
