/**
 * Deterministic ca/es deadline parser (SPEC §8.5). LLM output is cross-checked against this.
 * Returns ISO dates (YYYY-MM-DD) in Europe/Madrid school context; time-of-day is not inferred.
 */

const MONTHS: Record<string, number> = {
  // Catalan
  gener: 1,
  febrer: 2,
  març: 3,
  marc: 3,
  abril: 4,
  maig: 5,
  juny: 6,
  juliol: 7,
  agost: 8,
  setembre: 9,
  octubre: 10,
  novembre: 11,
  desembre: 12,
  // Spanish
  enero: 1,
  febrero: 2,
  marzo: 3,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  noviembre: 11,
  diciembre: 12,
};

// Words that signal a deadline rather than an event date.
const DEADLINE_CUES =
  /(abans del?|fins al?|com a molt tard|termini|data l[ií]mit|antes del?|hasta el|como m[aá]ximo|plazo|fecha l[ií]mite|no m[aá]s tarde)/i;

const NUMERIC = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/g;
const WORDY = /\b(\d{1,2})\s+(?:de\s+|d')?([a-zçàèéíïòóúü]+)(?:\s+(?:de\s+|del\s+)?(\d{4}))?/gi;

export interface ParsedDate {
  iso: string;
  index: number;
  isDeadline: boolean;
}

function toIso(d: number, m: number, y: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/** If no year is written, pick the next occurrence on/after `ref` (school letters look forward). */
function inferYear(d: number, m: number, ref: Date): number {
  const y = ref.getUTCFullYear();
  const candidate = Date.UTC(y, m - 1, d);
  const refDay = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  return candidate < refDay - 31 * 86400_000 ? y + 1 : y;
}

export function parseDates(text: string, ref = new Date()): ParsedDate[] {
  const out: ParsedDate[] = [];
  const cueNear = (idx: number) => DEADLINE_CUES.test(text.slice(Math.max(0, idx - 40), idx));

  for (const m of text.matchAll(NUMERIC)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : inferYear(d, mo, ref);
    if (y < 100) y += 2000;
    const iso = toIso(d, mo, y);
    if (iso) out.push({ iso, index: m.index!, isDeadline: cueNear(m.index!) });
  }
  for (const m of text.matchAll(WORDY)) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    if (!mo) continue;
    const d = Number(m[1]);
    const y = m[3] ? Number(m[3]) : inferYear(d, mo, ref);
    const iso = toIso(d, mo, y);
    if (iso) out.push({ iso, index: m.index!, isDeadline: cueNear(m.index!) });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** The earliest date introduced by a deadline cue, or a portal-provided raw deadline. */
export function parseDeadline(text: string, opts: { ref?: Date; portalField?: string } = {}): string | null {
  if (opts.portalField) {
    const fromField = parseDates(opts.portalField, opts.ref)[0];
    if (fromField) return fromField.iso;
  }
  const cued = parseDates(text, opts.ref).filter((p) => p.isDeadline);
  if (!cued.length) return null;
  return cued.map((c) => c.iso).sort()[0]!;
}

/** Cross-check an LLM-extracted deadline (SPEC §8.5). Mismatch → show "Check original" badge. */
export function crossCheckDeadline(
  llmIso: string | null,
  text: string,
  ref?: Date,
): 'agree' | 'mismatch' | 'llm_only' | 'parser_only' | 'none' {
  const parsed = parseDeadline(text, { ref });
  if (!llmIso && !parsed) return 'none';
  if (llmIso && !parsed) return 'llm_only';
  if (!llmIso && parsed) return 'parser_only';
  return llmIso!.slice(0, 10) === parsed ? 'agree' : 'mismatch';
}
