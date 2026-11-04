import { createHash } from 'node:crypto';

/**
 * Hash of exactly what the parent saw and confirmed (SPEC §9): kind + target + the original-language
 * text that will be sent + structured fields. Computed identically by the API (at confirm) and the
 * worker (before submitting); any difference blocks the write.
 */
export function computePreviewHash(p: {
  kind: string;
  itemRef?: string | null;
  childRef: string;
  text: string;
  fields: Record<string, string>;
}): string {
  const canonical = JSON.stringify({
    kind: p.kind,
    itemRef: p.itemRef ?? null,
    childRef: p.childRef,
    text: p.text,
    fields: Object.fromEntries(Object.entries(p.fields).sort(([a], [b]) => a.localeCompare(b))),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Queue names shared by API (producer) and worker (consumer). */
export const QUEUES = {
  sync: 'sync',
  enrich: 'enrich',
  notify: 'notify',
  submit: 'submit',
  tick: 'tick',
} as const;
