import type { Page } from 'playwright';
import { WriteNotConfirmedError } from '../adapters/errors.js';
import type { PortalAdapter, SubmissionPayload, VerifyResult } from '../adapters/types.js';

/**
 * SPEC §9 step 5. Golden rule 3: no write without a recorded parent confirmation whose
 * preview_hash matches exactly what will be sent. Writes are non-idempotent: submit is never retried.
 */

export interface Confirmation {
  previewHash: string;
  invalidatedAt: Date | null;
  userCanSubmit: boolean;
}

export { computePreviewHash } from '@escola/shared';
import { computePreviewHash } from '@escola/shared';

export type WriteOutcome =
  | { state: 'succeeded'; verify: VerifyResult; screenshot: Buffer }
  | { state: 'needs_manual'; reason: string; screenshot?: Buffer }
  | { state: 'failed'; reason: string };

export async function runSubmission(
  adapter: PortalAdapter,
  page: Page,
  sub: SubmissionPayload,
  confirmation: Confirmation | null,
): Promise<WriteOutcome> {
  // Gate 1: a valid, non-invalidated confirmation from a guardian allowed to submit.
  if (!confirmation || confirmation.invalidatedAt || !confirmation.userCanSubmit)
    throw new WriteNotConfirmedError();
  // Gate 2: what we are about to send is byte-for-byte what was previewed.
  const expected = computePreviewHash(sub);
  if (confirmation.previewHash !== expected || sub.previewHash !== expected)
    throw new WriteNotConfirmedError();

  const writer = adapter.writers()[sub.kind];
  if (!writer) return { state: 'failed', reason: `writer '${sub.kind}' not enabled` };

  const prepared = await writer.prepare(page, sub);
  // Gate 3: the portal form must echo exactly the confirmed text before we press send.
  if (prepared.fieldEcho.text !== undefined && prepared.fieldEcho.text !== sub.text)
    return { state: 'failed', reason: 'field echo mismatch; nothing submitted' };

  const submitted = await writer.submit(page, prepared); // exactly once, never retried
  if (submitted.status === 'failed') return { state: 'failed', reason: submitted.detail ?? 'submit failed' };

  const verify = await writer.verify(page, sub);
  if (verify.verified) return { state: 'succeeded', verify, screenshot: prepared.screenshot };
  return {
    state: 'needs_manual',
    reason: submitted.status === 'ambiguous' ? 'ambiguous submit, could not verify' : 'could not verify',
    screenshot: prepared.screenshot,
  };
}
