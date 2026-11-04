import { z } from 'zod';
import { ACTION_KINDS, type Locale } from '@escola/shared';
import type { LlmProvider } from './provider.js';
import glossary from './glossary.json' with { type: 'json' };

/**
 * SPEC §8.5 enrichment: detect language, translate title/body into a guardian's locale, summary
 * (<=140 chars), classify needs_action + action kind + deadline + confidence. One call per locale.
 */
export const ENRICH_PROMPT_VERSION = 'enrich-v1';

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  ca: 'Catalan',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  nl: 'Dutch',
  ru: 'Russian',
  uk: 'Ukrainian',
  ar: 'Arabic',
  zh: 'Chinese (Simplified)',
};

export const enrichmentSchema = z.object({
  source_lang: z.string().min(2).max(5),
  title: z.string(),
  body: z.string(),
  summary: z.string().transform((s) => (s.length > 140 ? `${s.slice(0, 139)}…` : s)),
  needs_action: z.boolean(),
  action_kind: z.enum(ACTION_KINDS).nullable(),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/)
    .nullable(),
  confidence: z.number().min(0).max(1),
});
export type Enrichment = z.infer<typeof enrichmentSchema>;

const SYSTEM = `You help parents of children at public schools in the Balearic Islands understand messages from the school portal (GestIB). Messages are usually in Catalan, sometimes Spanish.

For the item given, return ONLY a JSON object, no prose, with these keys:
- "source_lang": ISO code of the original ("ca" or "es" usually)
- "title": the title translated into the target language
- "body": the full body translated faithfully into the target language. Keep names, dates, amounts, places and placeholders like [CHILD_1] exactly. Do not add or omit information.
- "summary": one plain sentence, max 140 characters, in the target language, saying what the parent needs to know or do
- "needs_action": true only if the parent must do something (sign/return an authorisation, reply, pay, bring something, register, justify an absence, attend a meeting they must book). Pure information is false.
- "action_kind": one of ${ACTION_KINDS.join(', ')} or null
- "deadline": ISO date (YYYY-MM-DD) by which the parent must act, or null. Event dates are NOT deadlines unless the parent must act by then.
- "confidence": 0 to 1, how sure you are about needs_action and deadline

Use this glossary for consistent terms (Catalan → meaning): ${Object.entries(glossary)
  .map(([k, v]) => `${k} = ${v}`)
  .join('; ')}.
If unsure, lower the confidence rather than guessing.`;

/**
 * Replaces children's names with placeholders before sending to the LLM, restores them after.
 * (SPEC §8.5 [ASSUMPTION]: minimise children's personal data in LLM prompts.)
 */
export function pseudonymise(
  text: string,
  names: string[],
): { text: string; restore: (s: string) => string } {
  const map: [string, string][] = [];
  let out = text;
  names
    .filter((n) => n.trim().length >= 2)
    .sort((a, b) => b.length - a.length)
    .forEach((name, i) => {
      const ph = `[CHILD_${i + 1}]`;
      const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      if (re.test(out)) {
        out = out.replace(re, ph);
        map.push([ph, name]);
      }
    });
  return { text: out, restore: (s) => map.reduce((acc, [ph, n]) => acc.split(ph).join(n), s) };
}

function extractJson(s: string): unknown {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON object in model output');
  return JSON.parse(s.slice(start, end + 1));
}

export async function enrichItem(
  llm: LlmProvider,
  item: { title: string; body: string; section: string },
  targetLang: Locale,
  opts: { childNames?: string[] } = {},
): Promise<Enrichment> {
  const t = pseudonymise(item.title, opts.childNames ?? []);
  const b = pseudonymise(item.body.slice(0, 12_000), opts.childNames ?? []);
  const user = `<target_lang>${targetLang}</target_lang> (${LANG_NAMES[targetLang] ?? targetLang})
<item>
<section>${item.section}</section>
<title>${t.text}</title>
<body>${b.text}</body>
</item>`;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await llm.complete({
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
      maxTokens: 4000,
    });
    try {
      const parsed = enrichmentSchema.parse(extractJson(raw));
      const restore = (s: string) => b.restore(t.restore(s));
      return {
        ...parsed,
        title: restore(parsed.title),
        body: restore(parsed.body),
        summary: restore(parsed.summary),
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `enrichment output invalid: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

/** Translation of a parent's reply into the school's language, plus a back-translation for preview (SPEC §9). */
export async function draftForSchool(
  llm: LlmProvider,
  input: { text: string; userLang: string; targetLang: 'ca' | 'es'; context?: string },
): Promise<{ original: string; backTranslation: string }> {
  const system = `You write messages from a parent to their child's school in the Balearic Islands. Translate the parent's message into ${LANG_NAMES[input.targetLang]} in a polite, natural school register. Keep the meaning exactly; do not add promises, facts or apologies the parent did not write. Return ONLY JSON: {"original": "<message in ${LANG_NAMES[input.targetLang]}>", "back_translation": "<that message translated back into ${LANG_NAMES[input.userLang] ?? input.userLang}>"}`;
  const raw = await llm.complete({
    system,
    messages: [
      {
        role: 'user',
        content: `${input.context ? `<school_message>${input.context.slice(0, 4000)}</school_message>\n` : ''}<parent_message lang="${input.userLang}">${input.text}</parent_message>`,
      },
    ],
    maxTokens: 2000,
  });
  try {
    const j = z.object({ original: z.string().min(1), back_translation: z.string() }).parse(extractJson(raw));
    return { original: j.original, backTranslation: j.back_translation };
  } catch {
    // Fake provider / unexpected output: send the parent's own words and say so in the preview.
    return { original: input.text, backTranslation: input.text };
  }
}

/** Splits text into ~800-char chunks on paragraph/sentence boundaries for embedding. */
export function chunk(text: string, size = 800): string[] {
  const parts = text.split(/(?<=[.!?])\s+|\n{2,}/);
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + ' ' + p).length > size && cur) {
      out.push(cur.trim());
      cur = p;
    } else cur = cur ? `${cur} ${p}` : p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [''];
}
