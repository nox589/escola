import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq, schema, withFamily } from '@escola/db';
import { verifyLocalSignature } from '@escola/storage';
import type { AppDeps } from '../context.js';
import { fam, HttpError, me, requireRole } from '../app.js';
import { asApp } from '../services/auth.js';

const safeEq = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function miscRoutes(app: FastifyInstance, deps: AppDeps) {
  const auth = { onRequest: app.authenticate };

  // ---- Local blob store downloads (dev). In production, S3 presigned URLs are used instead. ----
  app.get('/files/*', async (req, reply) => {
    const key = (req.params as { '*': string })['*'];
    const q = z.object({ exp: z.coerce.number(), sig: z.string() }).parse(req.query);
    if (!verifyLocalSignature(deps.config.blobSecret, key, q.exp, q.sig))
      throw new HttpError(403, 'bad_signature');
    const data = await deps.blobs.get(key);
    return reply
      .header('cache-control', 'private, max-age=60')
      .type(key.endsWith('.png') ? 'image/png' : 'application/octet-stream')
      .send(data);
  });

  // ---- GDPR (SPEC §14) ----
  app.post('/data-requests/export', auth, async (req) => {
    const p = me(req);
    const data = await fam(deps, req, async (db) => ({
      exportedAt: new Date().toISOString(),
      family: await db.select().from(schema.families),
      members: await db.select().from(schema.familyMembers),
      children: await db.select().from(schema.children),
      portalAccounts: (await db.select().from(schema.portalAccounts)).map(
        ({ id, portal, usernameHint, status, lastSyncAt }) => ({
          id,
          portal,
          usernameHint,
          status,
          lastSyncAt,
        }),
      ),
      items: await db.select().from(schema.items),
      translations: await db.select().from(schema.itemTranslations),
      actions: await db.select().from(schema.itemActions),
      attachments: await db.select().from(schema.attachments),
      calendar: await db.select().from(schema.calendarEntries),
      submissions: await db.select().from(schema.submissions),
      receipts: await db.select().from(schema.receipts),
      notifications: await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, p.userId)),
    }));
    const key = `${p.familyId}/exports/${Date.now()}.json`;
    await deps.blobs.put(key, Buffer.from(JSON.stringify(data, null, 2)), 'application/json');
    await asApp(deps.pool, (db) =>
      db
        .insert(schema.dataRequests)
        .values({ userId: p.userId, kind: 'export', state: 'done', fileS3Key: key, completedAt: new Date() }),
    );
    return { url: await deps.blobs.signedUrl(key, 3600), expiresIn: 3600 };
  });

  app.post('/data-requests/delete', auth, async (req) => {
    requireRole(req, 'owner');
    const p = me(req);
    // Requires a fresh token (signed in within the last 10 minutes) as the re-auth step.
    const iat = JSON.parse(Buffer.from(req.headers.authorization!.split('.')[1]!, 'base64url').toString())
      .iat as number;
    if (Date.now() / 1000 - iat > 600) throw new HttpError(401, 'reauth_required');
    await fam(deps, req, async (db) => {
      // Credentials and sessions first, immediately; then everything (cascades from families).
      await db.delete(schema.credentials);
      await db.delete(schema.portalSessions);
      await db.delete(schema.families);
    });
    await asApp(deps.pool, async (db) => {
      await db
        .insert(schema.dataRequests)
        .values({ userId: p.userId, kind: 'delete', state: 'done', completedAt: new Date() });
      await db
        .update(schema.users)
        .set({ deletedAt: new Date(), email: `deleted+${p.userId}@invalid`, displayName: null })
        .where(eq(schema.users.id, p.userId));
      await db.delete(schema.refreshTokens).where(eq(schema.refreshTokens.userId, p.userId));
      await db.delete(schema.devices).where(eq(schema.devices.userId, p.userId));
    });
    return { deleted: true };
  });

  app.get('/data-requests', auth, async (req) =>
    asApp(deps.pool, (db) =>
      db
        .select()
        .from(schema.dataRequests)
        .where(eq(schema.dataRequests.userId, me(req).userId)),
    ),
  );

  // ---- RevenueCat (SPEC §4 billing) ----
  app.post('/webhooks/revenuecat', async (req, reply) => {
    const secret = deps.config.revenuecatWebhookSecret;
    if (!secret || !safeEq(req.headers.authorization ?? '', `Bearer ${secret}`))
      throw new HttpError(401, 'unauthorized');
    const { event } = z
      .object({
        event: z.object({
          type: z.string(),
          app_user_id: z.string().uuid(),
          expiration_at_ms: z.number().nullable().optional(),
        }),
      })
      .parse(req.body);
    const status = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE'].includes(event.type)
      ? 'active'
      : event.type === 'BILLING_ISSUE'
        ? 'grace'
        : event.type === 'EXPIRATION'
          ? 'expired'
          : null;
    // app_user_id is the family id (set by the app when configuring RevenueCat).
    if (status)
      await withFamily(deps.pool, event.app_user_id, (db) =>
        db
          .update(schema.families)
          .set({ subscriptionStatus: status, revenuecatAppUserId: event.app_user_id }),
      );
    return reply.status(200).send({ ok: true });
  });

  // ---- Admin (separate token, no credentials or child content) ----
  const admin = async (req: FastifyRequest) => {
    const t = deps.config.adminToken;
    if (!t || !safeEq(req.headers.authorization ?? '', `Bearer ${t}`))
      throw new HttpError(401, 'unauthorized');
  };
  const asAdmin = async <T>(q: string) => {
    const c = await deps.pool.connect();
    try {
      await c.query('SET ROLE escola_admin');
      const r = await c.query(q);
      await c.query('RESET ROLE');
      return r.rows as T[];
    } finally {
      c.release();
    }
  };
  app.get('/admin/health', { onRequest: admin }, async () => {
    await deps.pool.query('select 1');
    return { ok: true, db: 'up' };
  });
  app.get('/admin/sync-runs', { onRequest: admin }, async () =>
    asAdmin(
      `SELECT portal_account_id, started_at, finished_at, result, adapter_version FROM sync_runs ORDER BY started_at DESC LIMIT 200`,
    ),
  );
  app.get('/admin/parser-drift', { onRequest: admin }, async () =>
    asAdmin(
      `SELECT result, count(*)::int AS n, max(started_at) AS last FROM sync_runs WHERE started_at > now() - interval '7 days' AND result IN ('partial','unknown_page','selectors_not_discovered') GROUP BY result`,
    ),
  );
}
