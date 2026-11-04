import { and, eq, inArray } from '@escola/db';
import type pg from 'pg';
import { schema, withFamily } from '@escola/db';
import { chunk, enrichItem, ENRICH_PROMPT_VERSION, type Embedder, type LlmProvider } from '@escola/llm';
import type { Locale } from '@escola/shared';
import { crossCheckDeadline, parseDeadline } from '../core/deadline.js';
import { log } from '../core/logger.js';

export interface EnrichResult {
  itemId: string;
  needsAction: boolean;
  deadline: string | null;
  checkOriginal: boolean;
}

/**
 * SPEC §8.5: translate into every guardian's locale, classify, cross-check the deadline against the
 * deterministic parser, write actions + calendar entries, and embed for the assistant.
 * Idempotent per item version via items.enriched_hash.
 */
export async function enrichItems(o: {
  pool: pg.Pool;
  familyId: string;
  itemIds: string[];
  llm: LlmProvider;
  embedder: Embedder;
}): Promise<EnrichResult[]> {
  if (!o.itemIds.length) return [];
  const { items, locales, childNames } = await withFamily(o.pool, o.familyId, async (db) => {
    const items = await db
      .select({ item: schema.items, childName: schema.children.displayName })
      .from(schema.items)
      .leftJoin(schema.children, eq(schema.children.id, schema.items.childId))
      .where(inArray(schema.items.id, o.itemIds));
    const members = await db
      .select({ locale: schema.users.locale })
      .from(schema.familyMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.familyMembers.userId));
    const kids = await db.select({ name: schema.children.displayName }).from(schema.children);
    return {
      items,
      locales: [...new Set(members.map((m) => m.locale as Locale))].sort((a) => (a === 'en' ? -1 : 0)),
      childNames: kids.map((k) => k.name),
    };
  });
  const targetLocales: Locale[] = locales.length ? locales : ['en'];

  const results: EnrichResult[] = [];
  for (const { item, childName } of items) {
    if (item.enrichedHash === item.contentHash) continue;
    try {
      // 1. Translate + classify per locale (classification taken from the first).
      const per = [] as { lang: Locale; e: Awaited<ReturnType<typeof enrichItem>> }[];
      for (const lang of targetLocales) {
        per.push({
          lang,
          e: await enrichItem(
            o.llm,
            { title: item.originalTitle, body: item.originalBodyText, section: item.section },
            lang,
            { childNames },
          ),
        });
      }
      const primary = per[0]!.e;

      // 2. Deadline: portal field > deterministic parser > LLM, with a cross-check badge.
      const ref = item.postedAt ?? item.firstSeenAt;
      const fromPortal = item.deadlineRaw ? parseDeadline('', { portalField: item.deadlineRaw, ref }) : null;
      const check = crossCheckDeadline(primary.deadline, item.originalBodyText, ref);
      const parsed = parseDeadline(item.originalBodyText, { ref });
      const deadline = fromPortal ?? parsed ?? primary.deadline;
      const source = fromPortal ? 'portal_field' : parsed ? 'parsed' : primary.deadline ? 'llm' : null;
      const checkOriginal = check === 'mismatch' || check === 'llm_only' || primary.confidence < 0.6;
      const needsAction = primary.needs_action || item.section === 'authorisation';

      await withFamily(o.pool, o.familyId, async (db) => {
        for (const { lang, e } of per) {
          await db
            .insert(schema.itemTranslations)
            .values({
              familyId: o.familyId,
              itemId: item.id,
              lang,
              title: e.title,
              body: e.body,
              summary: e.summary,
              model: o.llm.model,
              promptVersion: ENRICH_PROMPT_VERSION,
              qualityFlags: checkOriginal ? ['check_original'] : [],
            })
            .onConflictDoUpdate({
              target: [schema.itemTranslations.itemId, schema.itemTranslations.lang],
              set: {
                title: e.title,
                body: e.body,
                summary: e.summary,
                model: o.llm.model,
                promptVersion: ENRICH_PROMPT_VERSION,
                qualityFlags: checkOriginal ? ['check_original'] : [],
                updatedAt: new Date(),
              },
            });
        }
        if (primary.source_lang)
          await db
            .update(schema.items)
            .set({ originalLang: primary.source_lang })
            .where(eq(schema.items.id, item.id));

        // 3. Actions: keep a single open action per item, refreshed on each new version.
        await db
          .delete(schema.itemActions)
          .where(and(eq(schema.itemActions.itemId, item.id), eq(schema.itemActions.state, 'open')));
        if (needsAction) {
          await db.insert(schema.itemActions).values({
            familyId: o.familyId,
            itemId: item.id,
            kind: primary.action_kind ?? (item.section === 'authorisation' ? 'consent' : 'reply'),
            deadlineAt: deadline ? new Date(`${deadline}T23:59:00+01:00`) : null,
            deadlineSource: source,
            confidence: checkOriginal ? Math.min(primary.confidence, 0.5) : primary.confidence,
          });
        }

        // 4. Calendar: deadlines appear in the calendar.
        await db.delete(schema.calendarEntries).where(eq(schema.calendarEntries.itemId, item.id));
        if (deadline && needsAction) {
          await db.insert(schema.calendarEntries).values({
            familyId: o.familyId,
            childId: item.childId,
            itemId: item.id,
            titleOriginal: item.originalTitle,
            titleTranslated: primary.title,
            startsAt: new Date(`${deadline}T00:00:00+01:00`),
            allDay: true,
            kind: 'deadline',
          });
        }

        // 5. Embeddings over original + primary translation, so questions work in either language.
        await db.delete(schema.embeddings).where(eq(schema.embeddings.itemId, item.id));
        const texts = [
          ...chunk(`${item.originalTitle}\n${item.originalBodyText}`),
          ...chunk(`${primary.title}\n${primary.body}`),
        ].filter((t) => t.trim());
        if (texts.length) {
          const vectors = await o.embedder.embed(texts, 'document');
          await db
            .insert(schema.embeddings)
            .values(
              texts.map((text, i) => ({
                familyId: o.familyId,
                itemId: item.id,
                chunkIdx: i,
                text,
                vector: vectors[i]!,
              })),
            );
        }
        await db
          .update(schema.items)
          .set({ enrichedHash: item.contentHash })
          .where(eq(schema.items.id, item.id));
      });

      results.push({ itemId: item.id, needsAction, deadline, checkOriginal });
      log.info(
        { itemId: item.id, needsAction, checkOriginal, child: childName ? 'set' : 'none' },
        'enriched',
      );
    } catch (e) {
      log.error(
        { itemId: item.id, error: e instanceof Error ? e.message.slice(0, 200) : 'unknown' },
        'enrich failed',
      );
    }
  }
  return results;
}
