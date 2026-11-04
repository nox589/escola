import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, isNull, schema, withFamily } from '@escola/db';
import { CONSENT_KINDS, consentRequest, inviteRequest, LOCALES, patchMeRequest } from '@escola/shared';
import type { AppDeps } from '../context.js';
import { fam, HttpError, me, requireRole } from '../app.js';
import { asApp, hashToken, memberships, newToken } from '../services/auth.js';

const prefsSchema = z.object({
  quietStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  quietEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  timeZone: z.string().max(64).optional(),
  grades: z.boolean().optional(),
  muted: z.boolean().optional(),
});

export async function familyRoutes(app: FastifyInstance, deps: AppDeps) {
  const auth = { onRequest: app.authenticate };

  app.get('/me', auth, async (req) => {
    const p = me(req);
    const [user] = await asApp(deps.pool, (db) =>
      db.select().from(schema.users).where(eq(schema.users.id, p.userId)),
    );
    return {
      id: user!.id,
      email: user!.email,
      displayName: user!.displayName,
      locale: user!.locale,
      familyId: p.familyId,
      role: p.role,
      canSubmit: p.canSubmit,
    };
  });

  app.patch('/me', auth, async (req) => {
    const body = patchMeRequest.parse(req.body);
    await asApp(deps.pool, (db) =>
      db
        .update(schema.users)
        .set({
          ...(body.locale && { locale: body.locale }),
          ...(body.displayName && { displayName: body.displayName }),
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, me(req).userId)),
    );
    return { ok: true };
  });

  app.get('/family', auth, async (req) =>
    fam(deps, req, async (db) => {
      const [family] = await db.select().from(schema.families);
      const members = await db
        .select({
          id: schema.familyMembers.id,
          userId: schema.users.id,
          email: schema.users.email,
          displayName: schema.users.displayName,
          role: schema.familyMembers.role,
          canSubmit: schema.familyMembers.canSubmit,
        })
        .from(schema.familyMembers)
        .innerJoin(schema.users, eq(schema.users.id, schema.familyMembers.userId));
      return {
        id: family!.id,
        name: family!.name,
        subscriptionStatus: family!.subscriptionStatus,
        members,
      };
    }),
  );

  app.post('/family/invites', auth, async (req) => {
    requireRole(req, 'owner');
    const { email, role } = inviteRequest.parse(req.body);
    if (role === 'owner') throw new HttpError(400, 'cannot_invite_owner');
    const token = newToken();
    await fam(deps, req, (db) =>
      db.insert(schema.familyInvites).values({
        familyId: me(req).familyId,
        email: email.toLowerCase(),
        role,
        tokenHash: hashToken(token),
        invitedByUserId: me(req).userId,
        expiresAt: new Date(Date.now() + 7 * 86400_000),
      }),
    );
    await deps.mailer.send(
      email,
      'You have been invited to a family on Escola',
      `You've been invited to see your children's school messages on Escola.\n\nOpen: ${deps.config.appUrl}/invite?token=${token}\n\nThis invite expires in 7 days.`,
    );
    return { ok: true };
  });

  app.post('/family/invites/:token/accept', auth, async (req) => {
    const { token } = z.object({ token: z.string().min(20) }).parse(req.params);
    const p = me(req);
    const [user] = await asApp(deps.pool, (db) =>
      db.select().from(schema.users).where(eq(schema.users.id, p.userId)),
    );
    const invite = await asApp(deps.pool, async (db) => {
      const [i] = await db
        .select()
        .from(schema.familyInvites)
        .where(
          and(eq(schema.familyInvites.tokenHash, hashToken(token)), isNull(schema.familyInvites.acceptedAt)),
        );
      return i;
    });
    if (!invite || invite.expiresAt < new Date()) throw new HttpError(404, 'invite_not_found');
    if (invite.email !== user!.email) throw new HttpError(403, 'invite_for_other_email');

    await withFamily(deps.pool, invite.familyId, async (db) => {
      await db
        .insert(schema.familyMembers)
        .values({ familyId: invite.familyId, userId: p.userId, role: invite.role, canSubmit: false })
        .onConflictDoNothing();
      await db
        .update(schema.familyInvites)
        .set({ acceptedAt: new Date() })
        .where(eq(schema.familyInvites.id, invite.id));
    });

    // Remove the empty family auto-created at sign-up, if that is all they had.
    for (const f of await memberships(deps.pool, p.userId)) {
      if (f.family_id === invite.familyId || f.role !== 'owner') continue;
      await withFamily(deps.pool, f.family_id, async (db) => {
        const accounts = await db.select({ id: schema.portalAccounts.id }).from(schema.portalAccounts);
        const members = await db.select({ id: schema.familyMembers.id }).from(schema.familyMembers);
        if (!accounts.length && members.length === 1) await db.delete(schema.families);
      });
    }
    return { familyId: invite.familyId };
  });

  app.patch('/family/members/:id', auth, async (req) => {
    requireRole(req, 'owner');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ canSubmit: z.boolean().optional(), role: z.enum(['guardian', 'viewer']).optional() })
      .parse(req.body);
    await fam(deps, req, (db) =>
      db.update(schema.familyMembers).set(body).where(eq(schema.familyMembers.id, id)),
    );
    return { ok: true };
  });

  app.delete('/family/members/:id', auth, async (req, reply) => {
    requireRole(req, 'owner');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await fam(deps, req, async (db) => {
      const [m] = await db.select().from(schema.familyMembers).where(eq(schema.familyMembers.id, id));
      if (!m) throw new HttpError(404, 'not_found');
      if (m.role === 'owner') throw new HttpError(400, 'cannot_remove_owner');
      await db.delete(schema.familyMembers).where(eq(schema.familyMembers.id, id));
    });
    return reply.status(204).send();
  });

  // ---- Consents (SPEC §11 screen 3) ----
  app.get('/consents', auth, async (req) => {
    const rows = await asApp(deps.pool, (db) =>
      db
        .select()
        .from(schema.consents)
        .where(and(eq(schema.consents.userId, me(req).userId), isNull(schema.consents.revokedAt))),
    );
    return rows.map((r) => ({ kind: r.kind, version: r.version, grantedAt: r.grantedAt }));
  });

  app.post('/consents', auth, async (req) => {
    const { kind, version } = consentRequest.parse(req.body);
    await asApp(deps.pool, async (db) => {
      await db
        .update(schema.consents)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.consents.userId, me(req).userId),
            eq(schema.consents.kind, kind),
            isNull(schema.consents.revokedAt),
          ),
        );
      await db.insert(schema.consents).values({ userId: me(req).userId, kind, version });
    });
    return { ok: true };
  });

  app.delete('/consents/:kind', auth, async (req, reply) => {
    const { kind } = z.object({ kind: z.enum(CONSENT_KINDS) }).parse(req.params);
    await asApp(deps.pool, (db) =>
      db
        .update(schema.consents)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.consents.userId, me(req).userId),
            eq(schema.consents.kind, kind),
            isNull(schema.consents.revokedAt),
          ),
        ),
    );
    return reply.status(204).send();
  });

  // ---- Devices & notification prefs (SPEC §7) ----
  /** Public VAPID key for web push (the installed web app); null when web push is off. */
  app.get('/push/config', async () => ({ vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null }));

  app.post('/devices', auth, async (req) => {
    const body = z
      .object({
        expoPushToken: z.string().min(10).max(200).optional(),
        webPush: z
          .object({
            endpoint: z.string().url().max(1000),
            keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
          })
          .optional(),
        platform: z.enum(['ios', 'android', 'web']),
        locale: z.enum(LOCALES),
      })
      .refine((b) => !!b.expoPushToken !== !!b.webPush, 'exactly one of expoPushToken or webPush')
      .parse(req.body);
    // Web push subscriptions share the token column (prefix + JSON); the worker routes by prefix.
    const token =
      body.expoPushToken ??
      `webpush:${JSON.stringify({ endpoint: body.webPush!.endpoint, keys: { p256dh: body.webPush!.keys.p256dh, auth: body.webPush!.keys.auth } })}`;
    const values = { userId: me(req).userId, expoPushToken: token, platform: body.platform, locale: body.locale, lastSeen: new Date() };
    const [d] = await asApp(deps.pool, (db) =>
      db
        .insert(schema.devices)
        .values(values)
        .onConflictDoUpdate({ target: schema.devices.expoPushToken, set: values })
        .returning({ id: schema.devices.id }),
    );
    return { id: d!.id };
  });

  app.delete('/devices/:id', auth, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await asApp(deps.pool, (db) =>
      db
        .delete(schema.devices)
        .where(and(eq(schema.devices.id, id), eq(schema.devices.userId, me(req).userId))),
    );
    return reply.status(204).send();
  });

  app.get('/notification-prefs', auth, async (req) =>
    fam(deps, req, async (db) => {
      const [m] = await db
        .select()
        .from(schema.familyMembers)
        .where(eq(schema.familyMembers.userId, me(req).userId));
      return {
        quietStart: '21:00',
        quietEnd: '07:00',
        timeZone: 'Europe/Madrid',
        grades: false,
        ...((m?.notificationPrefs ?? {}) as object),
      };
    }),
  );

  app.put('/notification-prefs', auth, async (req) => {
    const prefs = prefsSchema.parse(req.body);
    await fam(deps, req, (db) =>
      db
        .update(schema.familyMembers)
        .set({ notificationPrefs: prefs })
        .where(eq(schema.familyMembers.userId, me(req).userId)),
    );
    return prefs;
  });
}
