/** Inbox date like an email app: time today, "yesterday", weekday this week, else "16 Oct". */
export function inboxDate(iso: string | null, locale: string): string {
  if (!iso) return '';
  const loc = locale === 'en' ? 'en-GB' : locale;
  const tz = 'Europe/Madrid';
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(x);
  const now = new Date();
  if (day(d) === day(now))
    return new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(d);
  if (day(d) === day(new Date(now.getTime() - 86_400_000)))
    return new Intl.RelativeTimeFormat(loc, { numeric: 'auto' }).format(-1, 'day');
  if (now.getTime() - d.getTime() < 6 * 86_400_000)
    return new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone: tz }).format(d);
  return new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', timeZone: tz }).format(d);
}

const ACRONYMS = new Set([
  'CEIP',
  'IES',
  'CEPA',
  'EOI',
  'CC',
  'CEE',
  'AFA',
  'AMIPA',
  'APIMA',
  'CAIB',
  'IEB',
  'ESO',
  'FP',
  'TIC',
]);
const PARTICLES = new Set([
  'de',
  'del',
  'dels',
  'la',
  'les',
  'el',
  'els',
  'i',
  'y',
  'a',
  'en',
  'per',
  'amb',
  'des',
]);

/** Official senders arrive in capitals ("DIRECCIÓ GENERAL DE..."); show them in normal case. */
export function niceSender(name: string): string {
  const letters = name.replace(/[^\p{L}]/gu, '');
  if (!letters || letters !== letters.toUpperCase()) return name.trim();
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w, i) => {
      if (ACRONYMS.has(w.replace(/[^\p{L}]/gu, ''))) return w;
      const lower = w.toLocaleLowerCase('ca');
      if (i > 0 && PARTICLES.has(lower)) return lower;
      // d'UNIVERSITATS -> d'Universitats, L'ESCOLA -> l'Escola
      const m = /^([dl]['’])(.+)$/.exec(lower);
      if (m)
        return (
          (i > 0 ? m[1] : m[1]!.toUpperCase()) + m[2]!.charAt(0).toLocaleUpperCase('ca') + m[2]!.slice(1)
        );
      return lower.charAt(0).toLocaleUpperCase('ca') + lower.slice(1);
    })
    .join(' ');
}
