import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, isNull, schema, type Db } from '@escola/db';
import { draftForSchool } from '@escola/llm';
import {
  computePreviewHash,
  confirmSubmissionRequest,
  createSubmissionRequest,
  SUBMISSION_KINDS,
  type SubmissionKind,
} from '@escola/shared';
import type { AppDeps } from '../context.js';
import { fam, HttpError, me } from '../app.js';
import { asApp } from '../services/auth.js';

/**
 * Reception (SPEC §9). The API drafts and previews; the worker submits. Invariants:
 * - nothing is queued without a confirmation row whose preview_hash matches the stored draft;
 * - any edit invalidates every confirmation; no defaults for approve/decline; no batch approvals.
 */

const idParam = z.object({ id: z.string().uuid() });

/** Structured input per kind. Authorisations have no default: the parent must pick. */
const inputSchemas: Record<SubmissionKind, z.ZodTypeAny> = {
  reply_message: z.object({ text: z.string().min(1).max(4000) }),
  justify_absence: z.object({
    from: z.string().date(),
    to: z.string().date(),
    reason: z.enum(['illness', 'medical_appointment', 'family', 'other']),
    text: z.string().max(2000).default(''),
  }),
  authorisation: z.object({
    decision: z.enum(['approve', 'decline']),
    text: z.string().max(1000).default(''),
  }),
  upload_document: z.object({ text: z.string().max(2000).default('') }),
  answer_survey: z.object({ answers: z.record(z.string(), z.string()) }),
  request_meeting: z.object({ text: z.string().min(1).max(2000) }),
  // GestIB caps a message at 3500 characters; leave room for the translation to grow.
  new_message: z.object({
    text: z.string().min(1).max(3000),
    subject: z.string().max(150).default(''),
    contact_ids: z.array(z.string().uuid()).min(1).max(10),
  }),
};

async function loadContext(db: Db, childId: string, itemId?: string | null) {
  const [child] = await db.select().from(schema.children).where(eq(schema.children.id, childId));
  if (!child) throw new HttpError(404, 'child_not_found');
  const [item] = itemId ? await db.select().from(schema.items).where(eq(schema.items.id, itemId)) : [];
  if (itemId && !item) throw new HttpError(404, 'item_not_found');
  return { child, item };
}

async function buildDraft(
  deps: AppDeps,
  kind: SubmissionKind,
  input: Record<string, unknown>,
  userLang: string,
  item?: typeof schema.items.$inferSelect,
  contacts?: (typeof schema.contacts.$inferSelect)[],
): Promise<{ original: string; back: string; fields: Record<string, string> }> {
  const targetLang = item?.originalLang === 'es' ? 'es' : 'ca';
  const text = String(input.text ?? '');
  const fields: Record<string, string> = {};
  if (kind === 'new_message') {
    // Recipients are part of what the parent confirms (and of the preview hash).
    fields.to = (contacts ?? []).map((c) => c.portalRef).join(',');
    fields.toNames = (contacts ?? []).map((c) => c.name).join(', ');
    const subject = String(input.subject ?? '').trim();
    if (subject) fields.subject = (await draftForSchool(deps.llm, { text: subject, userLang, targetLang: 'ca' })).original;
  }
  if (kind === 'authorisation') fields.decision = String(input.decision);
  if (kind === 'justify_absence')
    Object.assign(fields, { from: String(input.from), to: String(input.to), reason: String(input.reason) });
  if (!text.trim()) return { original: '', back: '', fields };
  const d = await draftForSchool(deps.llm, { text, userLang, targetLang, context: item?.originalBodyText });
  return { original: d.original, back: d.backTranslation, fields };
}

function view(
  s: typeof schema.submissions.$inferSelect,
  previewHash: string | null,
  back: string | null,
  consentText?: string | null,
) {
  return {
    id: s.id,
    kind: s.kind,
    state: s.state,
    userInput: s.userInput,
    // Three-pane preview (SPEC §9.3): their words | exact text sent | back-translation.
    draftOriginal: s.draftOriginal,
    preview: back,
    fields: s.payload,
    previewHash,
    consentText: consentText ?? null,
    errorCode: s.errorCode,
  };
}

export async function submissionRoutes(app: FastifyInstance, deps: AppDeps) {
  const auth = { onRequest: app.authenticate };
  const enabled = () => new Set(deps.config.enabledWriters);

  app.get('/submission-types', auth, async () => ({
    kinds: SUBMISSION_KINDS.map((k) => ({ kind: k, enabled: enabled().has(k) })),
  }));

  app.post('/submissions', auth, async (req) => {
    const body = createSubmissionRequest.parse(req.body);
    // Replies can always be drafted (translation + back-translation preview, to copy into GestIB);
    // sending is refused at confirm until the writer is switched on. Other kinds need the writer.
    if (!enabled().has(body.kind) && body.kind !== 'reply_message' && body.kind !== 'new_message')
      throw new HttpError(409, 'kind_not_enabled');
    const input = inputSchemas[body.kind].parse(body.user_input) as Record<string, unknown>;
    const p = me(req);
    const [user] = await asApp(deps.pool, (db) =>
      db.select().from(schema.users).where(eq(schema.users.id, p.userId)),
    );
    const ctx = await fam(deps, req, (db) => loadContext(db, body.child_id, body.item_id));
    const contacts =
      body.kind === 'new_message'
        ? await fam(deps, req, (db) =>
            db.select().from(schema.contacts).where(inArray(schema.contacts.id, input.contact_ids as string[])),
          )
        : undefined;
    if (contacts && (contacts.length !== (input.contact_ids as string[]).length || contacts.some((c) => !c.accepts)))
      throw new HttpError(400, 'bad_recipients');
    const draft = await buildDraft(deps, body.kind, input, user!.locale, ctx.item, contacts);

    const sub = await fam(deps, req, async (db) => {
      const [s] = await db
        .insert(schema.submissions)
        .values({
          familyId: p.familyId,
          childId: body.child_id,
          itemId: body.item_id ?? null,
          kind: body.kind,
          userInput: input,
          userLang: user!.locale,
          draftOriginal: draft.original,
          payload: { ...draft.fields, _back: draft.back },
          files: body.files,
          state: 'awaiting_confirmation',
        })
        .returning();
      await db
        .insert(schema.auditLog)
        .values({
          actor: 'user',
          actorId: p.userId,
          familyId: p.familyId,
          action: 'submission_drafted',
          target: s!.id,
        });
      return s!;
    });
    const hash = computePreviewHash({
      kind: sub.kind,
      itemRef: ctx.item?.portalItemRef,
      childRef: ctx.child.portalChildRef,
      text: sub.draftOriginal ?? '',
      fields: draft.fields,
    });
    return view(sub, hash, draft.back, body.kind === 'authorisation' ? ctx.item?.originalBodyText : null);
  });

  app.get('/submissions/:id', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    return fam(deps, req, async (db) => {
      const [s] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, id));
      if (!s) throw new HttpError(404, 'not_found');
      const [r] = await db.select().from(schema.receipts).where(eq(schema.receipts.submissionId, id));
      const ctx = await loadContext(db, s.childId, s.itemId);
      const { _back, ...fields } = (s.payload ?? {}) as Record<string, string>;
      const hash = computePreviewHash({
        kind: s.kind,
        itemRef: ctx.item?.portalItemRef,
        childRef: ctx.child.portalChildRef,
        text: s.draftOriginal ?? '',
        fields,
      });
      const receipt = r
        ? {
            verifiedAt: r.verifiedAt,
            confirmationRef: r.portalConfirmationRef,
            screenshotUrl: r.screenshotS3Key ? await deps.blobs.signedUrl(r.screenshotS3Key, 300) : null,
          }
        : null;
      return { ...view({ ...s, payload: fields }, hash, _back ?? null), receipt };
    });
  });

  app.patch('/submissions/:id', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    const { user_input } = z.object({ user_input: z.record(z.string(), z.unknown()) }).parse(req.body);
    const p = me(req);
    const existing = await fam(
      deps,
      req,
      async (db) => (await db.select().from(schema.submissions).where(eq(schema.submissions.id, id)))[0],
    );
    if (!existing) throw new HttpError(404, 'not_found');
    if (!['draft', 'awaiting_confirmation', 'confirmed'].includes(existing.state))
      throw new HttpError(409, `already_${existing.state}`);
    const kind = existing.kind as SubmissionKind;
    const input = inputSchemas[kind].parse(user_input) as Record<string, unknown>;
    const ctx = await fam(deps, req, (db) => loadContext(db, existing.childId, existing.itemId));
    const contacts =
      kind === 'new_message'
        ? await fam(deps, req, (db) =>
            db.select().from(schema.contacts).where(inArray(schema.contacts.id, input.contact_ids as string[])),
          )
        : undefined;
    if (contacts && (contacts.length !== (input.contact_ids as string[]).length || contacts.some((c) => !c.accepts)))
      throw new HttpError(400, 'bad_recipients');
    const draft = await buildDraft(deps, kind, input, existing.userLang, ctx.item, contacts);
    const s = await fam(deps, req, async (db) => {
      // Any edit invalidates every confirmation (SPEC §9.4).
      await db
        .update(schema.submissionConfirmations)
        .set({ invalidatedAt: new Date() })
        .where(
          and(
            eq(schema.submissionConfirmations.submissionId, id),
            isNull(schema.submissionConfirmations.invalidatedAt),
          ),
        );
      const [u] = await db
        .update(schema.submissions)
        .set({
          userInput: input,
          draftOriginal: draft.original,
          payload: { ...draft.fields, _back: draft.back },
          state: 'awaiting_confirmation',
          updatedAt: new Date(),
        })
        .where(eq(schema.submissions.id, id))
        .returning();
      await db
        .insert(schema.auditLog)
        .values({
          actor: 'user',
          actorId: p.userId,
          familyId: p.familyId,
          action: 'submission_edited',
          target: id,
        });
      return u!;
    });
    const hash = computePreviewHash({
      kind,
      itemRef: ctx.item?.portalItemRef,
      childRef: ctx.child.portalChildRef,
      text: s.draftOriginal ?? '',
      fields: draft.fields,
    });
    return view(s, hash, draft.back);
  });

  app.post('/submissions/:id/confirm', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    const { preview_hash } = confirmSubmissionRequest.parse(req.body);
    const p = me(req);
    if (!p.canSubmit) throw new HttpError(403, 'not_allowed_to_submit');
    const [pending] = await fam(deps, req, (db) =>
      db.select({ kind: schema.submissions.kind }).from(schema.submissions).where(eq(schema.submissions.id, id)),
    );
    if (pending && !enabled().has(pending.kind)) throw new HttpError(409, 'kind_not_enabled');
    const mandate = await asApp(deps.pool, (db) =>
      db
        .select()
        .from(schema.consents)
        .where(
          and(
            eq(schema.consents.userId, p.userId),
            eq(schema.consents.kind, 'mandate_submit'),
            isNull(schema.consents.revokedAt),
          ),
        ),
    );
    if (!mandate.length) throw new HttpError(403, 'mandate_submit_consent_required');

    const s = await fam(deps, req, async (db) => {
      const [s] = await db.select().from(schema.submissions).where(eq(schema.submissions.id, id));
      if (!s) throw new HttpError(404, 'not_found');
      if (s.state !== 'awaiting_confirmation') throw new HttpError(409, `cannot_confirm_${s.state}`);
      if (!s.draftOriginal && s.kind !== 'authorisation') throw new HttpError(409, 'empty_draft');
      const ctx = await loadContext(db, s.childId, s.itemId);
      const { _back, ...fields } = (s.payload ?? {}) as Record<string, string>;
      void _back;
      const expected = computePreviewHash({
        kind: s.kind,
        itemRef: ctx.item?.portalItemRef,
        childRef: ctx.child.portalChildRef,
        text: s.draftOriginal ?? '',
        fields,
      });
      // The parent must have seen exactly what will be sent.
      if (expected !== preview_hash) throw new HttpError(409, 'preview_changed');

      const device = req.headers['x-device-id'];
      await db.insert(schema.submissionConfirmations).values({
        familyId: p.familyId,
        submissionId: id,
        userId: p.userId,
        deviceId: typeof device === 'string' ? device.slice(0, 100) : null,
        ipHash: createHash('sha256').update(`${req.ip}:${deps.config.jwtSecret}`).digest('hex'),
        previewHash: preview_hash,
        consentTextVersion: mandate[0]!.version,
      });
      const [u] = await db
        .update(schema.submissions)
        .set({ state: 'queued', updatedAt: new Date() })
        .where(eq(schema.submissions.id, id))
        .returning();
      await db
        .insert(schema.auditLog)
        .values({
          actor: 'user',
          actorId: p.userId,
          familyId: p.familyId,
          action: 'submission_confirmed',
          target: id,
          metadata: { previewHash: preview_hash },
        });
      return u!;
    });
    await deps.queue.submit({ familyId: p.familyId, submissionId: id });
    return { id: s.id, state: s.state };
  });

  app.get('/submissions', auth, async (req) =>
    fam(deps, req, async (db) =>
      (await db.select().from(schema.submissions).orderBy(desc(schema.submissions.createdAt)).limit(50)).map(
        (s) => ({
          id: s.id,
          kind: s.kind,
          state: s.state,
          createdAt: s.createdAt,
          itemId: s.itemId,
          childId: s.childId,
        }),
      ),
    ),
  );
}
