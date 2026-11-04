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
Use ONLY the <items>, <open_actions>, <calendar> and <kb> provided. If the answer is not there, say you don't know and suggest checking the original message or asking the school. Never invent dates, amounts or names.
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
            lte(schema.calendarEntries.startsAt, new Date(now.getTime() + 14 * 86400_000)),
          ),
        );
      return {
        history: history.reverse(),
        hits,
        meta,
        open,
        cal,
        validIds: new Set(itemIds.concat(open.map((o) => o.itemId))),
      };
    });

    const metaById = new Map(ctx.meta.map((m) => [m.id, m]));
    const context = `<items>
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
${ctx.cal.map((c) => `- ${c.at.toISOString().slice(0, 10)} ${c.child ?? ''}: ${c.title ?? c.orig}${c.itemId ? ` [item:${c.itemId}]` : ''}`).join('\n') || '(nothing in the next two weeks)'}
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
