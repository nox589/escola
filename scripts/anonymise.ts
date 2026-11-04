/**
 * T1.3 anonymiser. Strips personal data from saved GestIB HTML before it is committed as a fixture.
 *
 *   pnpm anonymise <in.html> <out.html> [--names names.txt]
 *
 * names.txt: one real name per line (children, parents, teachers, school). Matched case-insensitively,
 * accent-insensitively. Replacements are CONSISTENT within a file (same value → same placeholder) so
 * IDs that link items together still line up after anonymising.
 *
 * Always eyeball the output before committing. This is a safety net, not a guarantee.
 */
import { readFile, writeFile } from 'node:fs/promises';

export interface AnonymiseOptions {
  names?: string[];
}

const strip = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function anonymise(html: string, opts: AnonymiseOptions = {}): string {
  const maps = new Map<string, Map<string, string>>();
  const sub = (kind: string, value: string, make: (n: number) => string) => {
    const m = maps.get(kind) ?? new Map<string, string>();
    maps.set(kind, m);
    if (!m.has(value)) m.set(value, make(m.size + 1));
    return m.get(value)!;
  };

  // Work in NFD so accents are separate combining marks; matching can then ignore them.
  let out = html.normalize('NFD');

  // 1. Known names (longest first so "Maria Pons" wins over "Maria").
  const names = [...new Set((opts.names ?? []).map((n) => n.trim()).filter((n) => n.length >= 2))].sort(
    (a, b) => b.length - a.length,
  );
  for (const name of names) {
    const pattern = strip(name)
      .split('')
      .map((ch) => (/[a-z]/i.test(ch) ? `${escapeRe(ch)}\\p{M}*` : escapeRe(ch)))
      .join('');
    const key = strip(name).toLowerCase();
    out = out.replace(new RegExp(pattern, 'giu'), () => sub('name', key, (n) => `Persona ${n}`));
  }
  out = out.normalize('NFC');

  // 2. Emails
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) =>
    sub('email', m.toLowerCase(), (n) => `persona${n}@example.test`),
  );

  // 3. Spanish DNI / NIE
  out = out.replace(/\b[XYZ]?\d{7,8}[-\s]?[A-HJ-NP-TV-Z]\b/g, (m) =>
    sub('dni', m, (n) => `DNI-${String(n).padStart(4, '0')}`),
  );

  // 4. Phone numbers (ES mobile/landline, optional +34)
  out = out.replace(/(?:\+34[\s-]?)?\b[6789]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g, (m) =>
    // Spaced format so step 6 (long numeric ids) does not re-map the placeholder.
    sub('phone', m.replace(/\D/g, '').slice(-9), (n) => `600 000 ${String(n).padStart(3, '0')}`),
  );

  // 5. Hidden input values (CSRF tokens, view state, internal ids): keep the field, blank the value.
  out = out.replace(
    /(<input\b[^>]*type=["']?hidden["']?[^>]*\bvalue=)(["'])(.*?)\2/gi,
    (_m, pre, q, v) => `${pre}${q}${sub('hidden', v, (n) => `HIDDEN_${n}`)}${q}`,
  );

  // 6. Long numeric identifiers (student/teacher/internal ids, 6+ digits), consistently mapped.
  out = out.replace(/\b\d{6,}\b/g, (m) => sub('id', m, (n) => String(900000 + n)));

  // 7. Session / JWT-like tokens in attributes or URLs
  out = out.replace(
    /\b(jsessionid|sessionid|token|ticket|SAMLart)=([^&"'\s;]+)/gi,
    (_m, k) => `${k}=REDACTED`,
  );

  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const namesIdx = args.indexOf('--names');
  const names = namesIdx >= 0 ? (await readFile(args[namesIdx + 1]!, 'utf8')).split('\n') : [];
  const [input, output] = args.filter((_, i) => i !== namesIdx && i !== namesIdx + 1);
  if (!input || !output) {
    process.stderr.write('usage: pnpm anonymise <in.html> <out.html> [--names names.txt]\n');
    process.exit(1);
  }
  await writeFile(output, anonymise(await readFile(input, 'utf8'), { names }));
  process.stdout.write(`anonymised → ${output}. Review it by eye before committing.\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
