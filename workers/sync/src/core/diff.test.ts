import { describe, expect, it } from 'vitest';
import type { NormalisedItem } from '../adapters/types.js';
import { contentHash, diffItems, shouldNotify } from './diff.js';
import { crossCheckDeadline, parseDeadline } from './deadline.js';

const item = (p: Partial<NormalisedItem> = {}): NormalisedItem => ({
  portalRef: 'r1',
  section: 'circular',
  title: 'Sortida',
  bodyHtml: '',
  bodyText: 'Cal retornar l’autorització.',
  attachments: [],
  ...p,
});

describe('diff engine', () => {
  it('hash ignores whitespace and attachment order', () => {
    const a = item({
      bodyText: 'a  b\n c',
      attachments: [
        { name: 'x', download: async () => Buffer.alloc(0) },
        { name: 'y', download: async () => Buffer.alloc(0) },
      ],
    });
    const b = item({
      bodyText: 'a b c',
      attachments: [
        { name: 'y', download: async () => Buffer.alloc(0) },
        { name: 'x', download: async () => Buffer.alloc(0) },
      ],
    });
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('new → updated → unchanged', () => {
    const i = item();
    expect(diffItems([i], [])[0]!.kind).toBe('new');
    const known = [
      { portalRef: 'r1', section: 'circular', contentHash: contentHash(i), bodyText: i.bodyText },
    ];
    expect(diffItems([i], known)[0]!.kind).toBe('unchanged');
    const changed = diffItems([item({ bodyText: 'New text' })], known)[0]!;
    expect(changed).toMatchObject({ kind: 'updated', meaningful: true });
  });

  it('same ref in another section is a different item', () => {
    const known = [{ portalRef: 'r1', section: 'message', contentHash: 'x', bodyText: '' }];
    expect(diffItems([item()], known)[0]!.kind).toBe('new');
  });

  it('attachment rename alone is not meaningful; backfill never notifies', () => {
    const i = item();
    const known = [
      { portalRef: 'r1', section: 'circular', contentHash: contentHash(i), bodyText: i.bodyText },
    ];
    const r = diffItems(
      [item({ attachments: [{ name: 'z.pdf', download: async () => Buffer.alloc(0) }] })],
      known,
    )[0]!;
    expect(r).toMatchObject({ kind: 'updated', meaningful: false });
    expect(shouldNotify(r, { backfill: false })).toBe(false);
    expect(shouldNotify(diffItems([i], [])[0]!, { backfill: true })).toBe(false);
    expect(shouldNotify(diffItems([i], [])[0]!, { backfill: false })).toBe(true);
  });
});

describe('deadline parser (ca/es)', () => {
  const ref = new Date('2026-11-04T09:00:00Z');
  it.each([
    ["Cal retornar l'autorització abans del 12/11/2026.", '2026-11-12'],
    ['Termini: 15-11-26', '2026-11-15'],
    ['Podeu fer-ho fins al 20 de novembre', '2026-11-20'],
    ['Entregar antes del 3 de diciembre de 2026', '2026-12-03'],
    ['Fecha límite 10/01', '2027-01-10'],
    ["Data límit: 2 d'abril", '2027-04-02'],
  ])('%s → %s', (text, iso) => expect(parseDeadline(text, { ref })).toBe(iso));

  it('event dates without a cue are not deadlines', () => {
    expect(parseDeadline('La sortida serà el divendres 14 de novembre.', { ref })).toBeNull();
  });

  it('prefers the portal deadline field', () => {
    expect(parseDeadline('...', { ref, portalField: '12/11/2026' })).toBe('2026-11-12');
  });

  it('cross-checks LLM output', () => {
    const t = 'Retornau-la abans del 12/11/2026';
    expect(crossCheckDeadline('2026-11-12T00:00:00Z', t, ref)).toBe('agree');
    expect(crossCheckDeadline('2026-11-13', t, ref)).toBe('mismatch');
    expect(crossCheckDeadline(null, 'Bon dia', ref)).toBe('none');
  });
});
