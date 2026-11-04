import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { maskUsername, sealCredentials } from '@escola/crypto';
import { and, asc, desc, eq, gte, isNotNull, isNull, schema, type Db } from '@escola/db';
import { createPortalAccountRequest, teachersFromTimetable, updateCredentialsRequest } from '@escola/shared';
import type { AppDeps } from '../context.js';
import { fam, HttpError, me, requireRole } from '../app.js';
import { asApp } from '../services/auth.js';

const idParam = z.object({ id: z.string().uuid() });

async function storeCredentials(
  deps: AppDeps,
  db: Db,
  familyId: string,
  accountId: string,
  userId: string,
  username: string,
  password: string,
) {
  // Encrypt immediately; plaintext never touches the DB or logs. API has encrypt-only KMS access.
  const env = await sealCredentials(deps.kms, { username, password }, accountId);
  await db.delete(schema.credentials).where(eq(schema.credentials.portalAccountId, accountId));
  await db.insert(schema.credentials).values({
    familyId,
    portalAccountId: accountId,
    ciphertext: Buffer.from(env.ciphertext),
    iv: Buffer.from(env.iv),
    authTag: Buffer.from(env.authTag),
    wrappedDek: Buffer.from(env.wrappedDek),
    kmsKeyId: env.kmsKeyId,
    keyVersion: env.keyVersion,
    createdByUserId: userId,
    rotatedAt: new Date(),
  });
  // Old cookies belong to the old credentials.
  await db.delete(schema.portalSessions).where(eq(schema.portalSessions.portalAccountId, accountId));
}

function view(a: typeof schema.portalAccounts.$inferSelect) {
  return {
    id: a.id,
    portal: a.portal,
    usernameHint: a.usernameHint,
    status: a.status,
    lastSyncAt: a.lastSyncAt?.toISOString() ?? null,
    lastErrorCode: a.lastErrorCode,
  };
}

export async function portalRoutes(app: FastifyInstance, deps: AppDeps) {
  const auth = { onRequest: app.authenticate };

  app.post('/portal-accounts', auth, async (req) => {
    requireRole(req, 'owner', 'guardian');
    const body = createPortalAccountRequest.parse(req.body);
    const p = me(req);
    // Mandate to read is required before we store or use any credentials.
    const mandate = await asApp(deps.pool, (db) =>
      db
        .select()
        .from(schema.consents)
        .where(
          and(
            eq(schema.consents.userId, p.userId),
            eq(schema.consents.kind, 'mandate_read'),
            isNull(schema.consents.revokedAt),
          ),
        ),
    );
    if (!mandate.length) throw new HttpError(403, 'mandate_read_consent_required');

    const account = await fam(deps, req, async (db) => {
      const [a] = await db
        .insert(schema.portalAccounts)
        .values({ familyId: p.familyId, portal: body.portal, usernameHint: maskUsername(body.username) })
        .returning();
      await storeCredentials(deps, db, p.familyId, a!.id, p.userId, body.username, body.password);
      await db
        .insert(schema.auditLog)
        .values({
          actor: 'user',
          actorId: p.userId,
          familyId: p.familyId,
          action: 'portal_account_linked',
          target: a!.id,
        });
      return a!;
    });
    // First sync doubles as the one-attempt login check (SPEC §7 verify_login).
    await deps.queue.sync({ familyId: p.familyId, portalAccountId: account.id, manual: true });
    return view(account);
  });

  app.put('/portal-accounts/:id/credentials', auth, async (req) => {
    requireRole(req, 'owner', 'guardian');
    const { id } = idParam.parse(req.params);
    const body = updateCredentialsRequest.parse(req.body);
    const p = me(req);
    const account = await fam(deps, req, async (db) => {
      const [a] = await db.select().from(schema.portalAccounts).where(eq(schema.portalAccounts.id, id));
      if (!a) throw new HttpError(404, 'not_found');
      await storeCredentials(deps, db, p.familyId, id, p.userId, body.username, body.password);
      // The ONLY place the lockout counter resets (SPEC §8.4).
      const [u] = await db
        .update(schema.portalAccounts)
        .set({
          usernameHint: maskUsername(body.username),
          credentialVersion: a.credentialVersion + 1,
          consecutiveAuthFailures: 0,
          status: a.status === 'paused' ? 'paused' : 'active',
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.portalAccounts.id, id))
        .returning();
      await db
        .insert(schema.auditLog)
        .values({
          actor: 'user',
          actorId: p.userId,
          familyId: p.familyId,
          action: 'credentials_updated',
          target: id,
        });
      return u!;
    });
    if (account.status === 'active')
      await deps.queue.sync({ familyId: p.familyId, portalAccountId: id, manual: true });
    return view(account);
  });

  app.get('/portal-accounts', auth, async (req) =>
    fam(deps, req, async (db) => (await db.select().from(schema.portalAccounts)).map(view)),
  );

  app.get('/portal-accounts/:id', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    return fam(deps, req, async (db) => {
      const [a] = await db.select().from(schema.portalAccounts).where(eq(schema.portalAccounts.id, id));
      if (!a) throw new HttpError(404, 'not_found');
      const [run] = await db
        .select()
        .from(schema.syncRuns)
        .where(eq(schema.syncRuns.portalAccountId, id))
        .orderBy(desc(schema.syncRuns.startedAt))
        .limit(1);
      return {
        ...view(a),
        lastRun: run ? { startedAt: run.startedAt, finishedAt: run.finishedAt, result: run.result } : null,
      };
    });
  });

  app.post(
    '/portal-accounts/:id/sync',
    {
      ...auth,
      config: {
        rateLimit: {
          max: 1,
          timeWindow: '10 minutes',
          keyGenerator: (r) => `${r.ip}:${(r.params as { id?: string }).id}`,
        },
      },
    },
    async (req) => {
      const { id } = idParam.parse(req.params);
      const a = await fam(
        deps,
        req,
        async (db) =>
          (await db.select().from(schema.portalAccounts).where(eq(schema.portalAccounts.id, id)))[0],
      );
      if (!a) throw new HttpError(404, 'not_found');
      if (a.status !== 'active') throw new HttpError(409, `account_${a.status}`);
      await deps.queue.sync({ familyId: me(req).familyId, portalAccountId: id, manual: true });
      return { queued: true };
    },
  );

  for (const action of ['pause', 'resume'] as const) {
    app.post(`/portal-accounts/:id/${action}`, auth, async (req) => {
      requireRole(req, 'owner', 'guardian');
      const { id } = idParam.parse(req.params);
      return fam(deps, req, async (db) => {
        const [a] = await db.select().from(schema.portalAccounts).where(eq(schema.portalAccounts.id, id));
        if (!a) throw new HttpError(404, 'not_found');
        if (action === 'resume' && a.status !== 'paused') throw new HttpError(409, `account_${a.status}`);
        const [u] = await db
          .update(schema.portalAccounts)
          .set({ status: action === 'pause' ? 'paused' : 'active' })
          .where(eq(schema.portalAccounts.id, id))
          .returning();
        return view(u!);
      });
    });
  }

  app.delete('/portal-accounts/:id', auth, async (req, reply) => {
    requireRole(req, 'owner');
    const { id } = idParam.parse(req.params);
    const p = me(req);
    await fam(deps, req, async (db) => {
      // Credentials and sessions are wiped immediately (cascade), then the account and its data.
      await db.delete(schema.credentials).where(eq(schema.credentials.portalAccountId, id));
      await db.delete(schema.portalSessions).where(eq(schema.portalSessions.portalAccountId, id));
      await db.delete(schema.portalAccounts).where(eq(schema.portalAccounts.id, id));
      await db
        .insert(schema.auditLog)
        .values({
          actor: 'user',
          actorId: p.userId,
          familyId: p.familyId,
          action: 'portal_account_removed',
          target: id,
        });
    });
    return reply.status(204).send();
  });

  // ---- Children ----
  app.get('/children', auth, async (req) =>
    fam(deps, req, (db) =>
      db
        .select({
          id: schema.children.id,
          displayName: schema.children.displayName,
          schoolName: schema.children.schoolName,
          classLabel: schema.children.classLabel,
          colour: schema.children.colour,
        })
        .from(schema.children)
        .orderBy(asc(schema.children.displayName)),
    ),
  );

  /** Child page: teachers and timetable (from GestIB's timetable), absences, upcoming agenda. */
  app.get('/children/:id/profile', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    return fam(deps, req, async (db) => {
      const [c] = await db.select().from(schema.children).where(eq(schema.children.id, id));
      if (!c) throw new HttpError(404, 'not_found');
      const absences = await db
        .select()
        .from(schema.absences)
        .where(eq(schema.absences.childId, id))
        .orderBy(desc(schema.absences.day));
      const upcoming = await db
        .select()
        .from(schema.calendarEntries)
        .where(
          and(
            eq(schema.calendarEntries.childId, id),
            isNotNull(schema.calendarEntries.sourceRef),
            gte(schema.calendarEntries.startsAt, new Date(Date.now() - 86400_000)),
          ),
        )
        .orderBy(asc(schema.calendarEntries.startsAt))
        .limit(10);
      return {
        id: c.id,
        displayName: c.displayName,
        classLabel: c.classLabel,
        colour: c.colour,
        detailsSyncedAt: c.detailsSyncedAt?.toISOString() ?? null,
        timetable: c.timetable,
        teachers: teachersFromTimetable(c.timetable),
        absences: absences.map((a) => ({
          id: a.id,
          childId: a.childId,
          day: a.day,
          period: a.period,
          subject: a.subject,
          kind: a.kind,
          status: a.status,
          reason: a.reason,
          schoolNote: a.schoolNote,
          canJustify: a.canJustify,
        })),
        upcoming: upcoming.map((e) => ({
          id: e.id,
          title: e.titleTranslated ?? e.titleOriginal,
          titleOriginal: e.titleOriginal,
          startsAt: e.startsAt.toISOString(),
          endsAt: e.endsAt?.toISOString() ?? null,
          allDay: e.allDay,
          kind: e.kind,
        })),
      };
    });
  });

  /** Absences across the family (Today shows the ones that still need a justification). */
  app.get('/absences', auth, async (req) => {
    const q = z.object({ child_id: z.string().uuid().optional() }).parse(req.query);
    return fam(deps, req, async (db) => {
      const rows = await db
        .select({ a: schema.absences, child: { id: schema.children.id, name: schema.children.displayName, colour: schema.children.colour } })
        .from(schema.absences)
        .innerJoin(schema.children, eq(schema.children.id, schema.absences.childId))
        .where(q.child_id ? eq(schema.absences.childId, q.child_id) : undefined)
        .orderBy(desc(schema.absences.day));
      return rows.map(({ a, child }) => ({
        id: a.id,
        child,
        day: a.day,
        period: a.period,
        subject: a.subject,
        kind: a.kind,
        status: a.status,
        reason: a.reason,
        canJustify: a.canJustify,
      }));
    });
  });

  app.patch('/children/:id', auth, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        displayName: z.string().min(1).max(40).optional(),
        colour: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      })
      .parse(req.body);
    return fam(deps, req, async (db) => {
      const [c] = await db.update(schema.children).set(body).where(eq(schema.children.id, id)).returning();
      if (!c) throw new HttpError(404, 'not_found');
      return { id: c.id, displayName: c.displayName, colour: c.colour };
    });
  });
}
