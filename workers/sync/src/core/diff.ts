import { createHash } from 'node:crypto';
import type { NormalisedItem } from '../adapters/types.js';

/** SPEC §8.3: content_hash = sha256(normalised title + body + attachment names). */
export function contentHash(
  item: Pick<NormalisedItem, 'title' | 'bodyText' | 'attachments' | 'deadlineRaw'>,
): string {
  const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
  const parts = [
    norm(item.title),
    norm(item.bodyText),
    norm(item.deadlineRaw ?? ''),
    ...item.attachments.map((a) => norm(a.name)).sort(),
  ];
  return createHash('sha256').update(parts.join('␟')).digest('hex');
}

export interface KnownItem {
  portalRef: string;
  section: string;
  contentHash: string;
  bodyText: string;
  deadlineRaw?: string | null;
}

export type DiffResult =
  | { kind: 'new'; item: NormalisedItem; hash: string }
  | { kind: 'updated'; item: NormalisedItem; hash: string; meaningful: boolean }
  | { kind: 'unchanged'; item: NormalisedItem };

/** Diff key (portal_account, section, portalRef); the caller scopes `known` to one portal account. */
export function diffItems(fresh: NormalisedItem[], known: KnownItem[]): DiffResult[] {
  const byKey = new Map(known.map((k) => [`${k.section}\u0000${k.portalRef}`, k]));
  return fresh.map((item) => {
    const hash = contentHash(item);
    const prev = byKey.get(`${item.section}\u0000${item.portalRef}`);
    if (!prev) return { kind: 'new', item, hash };
    if (prev.contentHash === hash) return { kind: 'unchanged', item };
    // Notify only if meaningful: deadline or body changed (attachment renames alone are quiet).
    const meaningful =
      (prev.deadlineRaw ?? '') !== (item.deadlineRaw ?? '') ||
      prev.bodyText.replace(/\s+/g, ' ').trim() !== item.bodyText.replace(/\s+/g, ' ').trim();
    return { kind: 'updated', item, hash, meaningful };
  });
}

/** Grades sections only diff on change; everything else notifies on new too. */
export function shouldNotify(r: DiffResult, opts: { backfill: boolean }): boolean {
  if (opts.backfill) return false;
  if (r.kind === 'new') return true;
  if (r.kind === 'updated') return r.meaningful;
  return false;
}
