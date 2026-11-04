import { and, desc, eq, isNull, schema, withFamily } from '@escola/db';
import type { SubmissionKind } from '@escola/shared';
import { WriteNotConfirmedError } from '../adapters/errors.js';
import { log } from '../core/logger.js';
import { openPortalSession } from '../core/sync.js';
import { runSubmission } from '../core/writeback.js';
import { notifySubmissionResult } from '../notify/job.js';
import type { Deps, SubmitJob } from '../pipeline/processors.js';
import { credentialsProvider } from '../store/credentials.js';
import { PgLockoutStore } from '../store/pg.js';
import { PgSessionStore } from '../store/sessions.js';

/**
 * SPEC §9 step 5–6. One automatic attempt, ever (non-idempotent write). Every step is audited.
 * Golden rule 3 is enforced here, in runSubmission, and by the DB trigger.
 */
export async function processSubmit(d: Deps, job: SubmitJob): Promise<{ state: string }> {
  const { pool, familyId } = { pool: d.pool, familyId: job.familyId };
  const audit = (action: string, metadata: object = {}) =>
    withFamily(pool, familyId, (db) =>
      db
        .insert(schema.auditLog)
        .values({ actor: 'worker', actorId: 'submit', familyId, action, target: job.submissionId, metadata }),
    );
  const setState = (
    state: 'submitting' | 'verifying' | 'succeeded' | 'failed' | 'needs_manual',
    errorCode?: string,
  ) =>
    withFamily(pool, familyId, (db) =>
      db
        .update(schema.submissions)
        .set({ state, errorCode: errorCode ?? null, updatedAt: new Date() })
        .where(eq(schema.submissions.id, job.submissionId)),
    );

  const ctx = await withFamily(pool, familyId, async (db) => {
    const [sub] = await db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.id, job.submissionId));
    if (!sub) return null;
    const [conf] = await db
      .select()
      .from(schema.submissionConfirmations)
      .where(
        and(
          eq(schema.submissionConfirmations.submissionId, sub.id),
          isNull(schema.submissionConfirmations.invalidatedAt),
        ),
      )
      .orderBy(desc(schema.submissionConfirmations.confirmedAt))
      .limit(1);
    const [member] = conf
      ? await db.select().from(schema.familyMembers).where(eq(schema.familyMembers.userId, conf.userId))
      : [];
    const [child] = await db.select().from(schema.children).where(eq(schema.children.id, sub.childId));
    const [item] = sub.itemId
      ? await db.select().from(schema.items).where(eq(schema.items.id, sub.itemId))
      : [];
    const [account] = child
      ? await db
          .select()
          .from(schema.portalAccounts)
          .where(eq(schema.portalAccounts.id, child.portalAccountId))
      : [];
    return { sub, conf, member, child, item, account };
  });
  if (!ctx?.sub) return { state: 'missing' };
  const { sub, conf, member, child, item, account } = ctx;

  if (sub.state !== 'queued') return { state: `skipped_${sub.state}` };
  if (sub.attempts >= 1) {
    // Never a second automatic attempt.
    await setState('needs_manual', 'ALREADY_ATTEMPTED');
    return { state: 'needs_manual' };
  }
  if (!conf || !member?.canSubmit || !child || !account || !sub.draftOriginal) {
    await setState('failed', 'NOT_CONFIRMED');
    await audit('submission_refused', { reason: 'no valid confirmation' });
    return { state: 'failed' };
  }

  await withFamily(pool, familyId, (db) =>
    db
      .update(schema.submissions)
      .set({ state: 'submitting', attempts: sub.attempts + 1 })
      .where(eq(schema.submissions.id, sub.id)),
  );
  await audit('submission_started');

  const adapter = d.adapterFor(account.portal);
  const session = await openPortalSession({
    adapter,
    browser: await d.browser(),
    accountId: account.id,
    lockout: new PgLockoutStore(pool, familyId),
    withCredentials: credentialsProvider(pool, d.kms, familyId, account.id),
    sessions: new PgSessionStore(pool, d.kms, familyId, account.id),
  });

  let outcome: 'ok' | 'manual' | 'failed' = 'failed';
  try {
    if (!session.page) {
      await setState('failed', 'LOGIN_FAILED');
      await audit('submission_failed', { reason: 'login' });
    } else {
      await adapter.switchChild(session.page, {
        ref: child.portalChildRef,
        displayName: child.displayName,
      });
      const res = await runSubmission(
        adapter,
        session.page,
        {
          submissionId: sub.id,
          kind: sub.kind as SubmissionKind,
          itemRef: item?.portalItemRef,
          childRef: child.portalChildRef,
          text: sub.draftOriginal,
          // `_`-prefixed keys are API bookkeeping (e.g. the back-translation), never sent.
          fields: Object.fromEntries(
            Object.entries((sub.payload ?? {}) as Record<string, string>).filter(([k]) => !k.startsWith('_')),
          ),
          previewHash: conf.previewHash,
        },
        { previewHash: conf.previewHash, invalidatedAt: conf.invalidatedAt, userCanSubmit: member.canSubmit },
      );
      if (res.state === 'succeeded') {
        const key = `${familyId}/receipts/${sub.id}.png`;
        await d.blobs.put(key, res.screenshot, 'image/png');
        await withFamily(pool, familyId, async (db) => {
          await db
            .update(schema.submissions)
            .set({ state: 'verifying' })
            .where(eq(schema.submissions.id, sub.id));
          await db.insert(schema.receipts).values({
            familyId,
            submissionId: sub.id,
            screenshotS3Key: key,
            pageTextAfter: res.verify.pageText?.slice(0, 4000) ?? null,
            portalConfirmationRef: res.verify.confirmationRef ?? null,
            verifiedAt: new Date(),
          });
        });
        await setState('succeeded');
        if (item) {
          await withFamily(pool, familyId, (db) =>
            db
              .update(schema.itemActions)
              .set({ state: 'done_in_app' })
              .where(and(eq(schema.itemActions.itemId, item.id), eq(schema.itemActions.state, 'open'))),
          );
        }
        await audit('submission_succeeded', { ref: res.verify.confirmationRef ?? null });
        outcome = 'ok';
      } else if (res.state === 'needs_manual') {
        await setState('needs_manual', 'UNVERIFIED');
        await audit('submission_needs_manual', { reason: res.reason });
        outcome = 'manual';
      } else {
        await setState('failed', 'PORTAL_REJECTED');
        await audit('submission_failed', { reason: res.reason });
      }
    }
  } catch (e) {
    const code = e instanceof WriteNotConfirmedError ? 'NOT_CONFIRMED' : 'ERROR';
    // After pressing send we cannot know; before, nothing went out. Either way: no retry.
    await setState(code === 'NOT_CONFIRMED' ? 'failed' : 'needs_manual', code);
    await audit('submission_error', { code });
    log.error({ submissionId: sub.id, code }, 'submission error');
    outcome = code === 'NOT_CONFIRMED' ? 'failed' : 'manual';
  } finally {
    await session.close();
  }

  await notifySubmissionResult({
    pool,
    familyId,
    userId: conf.userId,
    submissionId: sub.id,
    outcome,
    sender: d.sender,
  });
  return { state: outcome === 'ok' ? 'succeeded' : outcome === 'manual' ? 'needs_manual' : 'failed' };
}
