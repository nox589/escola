import { and, desc, eq, isNotNull, isNull } from '@escola/db';
import type pg from 'pg';
import { schema, withFamily } from '@escola/db';
import type { LlmProvider } from '@escola/llm';
import type { TimetableSession } from '@escola/shared';

const LANG_NAMES: Record<string, string> = { en: 'English', es: 'Spanish', ca: 'Catalan', de: 'German', fr: 'French', it: 'Italian' };

/** Parses the model's reply: a JSON array of strings with exactly `n` entries, else null. */
export function parseLabelReply(reply: string, n: number): string[] | null {
  const m = /\[[\s\S]*\]/.exec(reply);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) && arr.length === n && arr.every((x) => typeof x === 'string') ? arr : null;
  } catch {
    return null;
  }
}

/**
 * Translates short portal labels (subject names, agenda event titles) into the family's first
 * language. The originals stay stored and shown alongside (golden rule 5). Best effort.
 */
export async function translateLabels(o: { pool: pg.Pool; familyId: string; llm: LlmProvider }): Promise<number> {
  const { lang, entries, kids } = await withFamily(o.pool, o.familyId, async (db) => {
    // The language most recently chosen in the family (labels have one translation each).
    const members = await db
      .select({ locale: schema.users.locale })
      .from(schema.familyMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.familyMembers.userId))
      .orderBy(desc(schema.users.updatedAt));
    const lang = members[0]?.locale ?? 'en';
    const [fam] = await db.select({ id: schema.families.id, labelsLang: schema.families.labelsLang }).from(schema.families);
    if (fam && fam.labelsLang !== lang) {
      // Language changed: drop the old label translations so they are redone below.
      await db.update(schema.calendarEntries).set({ titleTranslated: null }).where(isNotNull(schema.calendarEntries.sourceRef));
      for (const k of await db.select({ id: schema.children.id, timetable: schema.children.timetable }).from(schema.children))
        await db
          .update(schema.children)
          .set({ timetable: k.timetable.map(({ subjectTranslated: _drop, ...rest }) => rest) })
          .where(eq(schema.children.id, k.id));
      await db.update(schema.families).set({ labelsLang: lang }).where(eq(schema.families.id, fam.id));
    }
    return {
      lang,
      entries: await db
        .select({ id: schema.calendarEntries.id, title: schema.calendarEntries.titleOriginal })
        .from(schema.calendarEntries)
        .where(and(isNotNull(schema.calendarEntries.sourceRef), isNull(schema.calendarEntries.titleTranslated))),
      kids: await db.select({ id: schema.children.id, timetable: schema.children.timetable }).from(schema.children),
    };
  });
  const needed = new Set<string>();
  for (const e of entries) needed.add(e.title);
  for (const k of kids) for (const s of k.timetable) if (s.subjectTranslated === undefined) needed.add(s.subject);
  const texts = [...needed].slice(0, 80);
  if (!texts.length) return 0;

  const reply = await o.llm.complete({
    system:
      `You translate short labels from a Balearic Islands school portal (Catalan or Spanish) into ${LANG_NAMES[lang] ?? 'English'}. ` +
      'They are school subject names and calendar event titles. Keep people and place names unchanged. ' +
      'Reply with ONLY a JSON array of strings: the translations, in the same order and the same count as the input.',
    messages: [{ role: 'user', content: JSON.stringify(texts) }],
    maxTokens: 1500,
  });
  const out = parseLabelReply(reply, texts.length);
  if (!out) return 0;
  const map = new Map(texts.map((t, i) => [t, out[i]!.trim()]));

  await withFamily(o.pool, o.familyId, async (db) => {
    for (const e of entries) {
      const t = map.get(e.title);
      if (t) await db.update(schema.calendarEntries).set({ titleTranslated: t }).where(eq(schema.calendarEntries.id, e.id));
    }
    for (const k of kids) {
      if (!k.timetable.some((s) => s.subjectTranslated === undefined && map.has(s.subject))) continue;
      const next: TimetableSession[] = k.timetable.map((s) =>
        s.subjectTranslated === undefined && map.has(s.subject) ? { ...s, subjectTranslated: map.get(s.subject)! } : s,
      );
      await db.update(schema.children).set({ timetable: next }).where(eq(schema.children.id, k.id));
    }
  });
  return map.size;
}
