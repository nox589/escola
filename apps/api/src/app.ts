import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { withFamily, type Db } from '@escola/db';
import { PINO_REDACT_PATHS, redact } from '@escola/shared';
import type { AppDeps } from './context.js';
import { memberships, verifyAccess } from './services/auth.js';
import { authRoutes } from './routes/auth.js';
import { familyRoutes } from './routes/family.js';
import { portalRoutes } from './routes/portal.js';
import { feedRoutes } from './routes/feed.js';
import { submissionRoutes } from './routes/submissions.js';
import { assistantRoutes } from './routes/assistant.js';
import { miscRoutes } from './routes/misc.js';

export interface Principal {
  userId: string;
  familyId: string;
  role: 'owner' | 'guardian' | 'viewer';
  canSubmit: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  return schema.parse(value);
}

/** Runs `fn` scoped to the caller's family (RLS). */
export function fam<T>(deps: AppDeps, req: FastifyRequest, fn: (db: Db) => Promise<T>): Promise<T> {
  return withFamily(deps.pool, me(req).familyId, fn);
}

export function me(req: FastifyRequest): Principal {
  if (!req.principal) throw new HttpError(401, 'unauthenticated');
  return req.principal;
}

export function requireRole(req: FastifyRequest, ...roles: Principal['role'][]) {
  if (!roles.includes(me(req).role)) throw new HttpError(403, 'forbidden');
}

export async function buildApp(deps: AppDeps, opts: { logger?: boolean | object } = {}) {
  const app = Fastify({
    logger: opts.logger ?? {
      level: process.env.LOG_LEVEL ?? 'info',
      // Golden rule 4: request bodies and auth headers never reach logs.
      redact: {
        paths: [...PINO_REDACT_PATHS, 'req.headers.authorization', 'req.headers.cookie'],
        censor: '[REDACTED]',
      },
    },
    bodyLimit: 1_000_000,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'x-device-id', 'x-family-id'],
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError)
      return reply.status(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError)
      return reply
        .status(400)
        .send({
          error: 'invalid_request',
          issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
        });
    const e = err as { statusCode?: number; code?: string; message?: string; name?: string };
    if (e.statusCode && e.statusCode < 500)
      return reply.status(e.statusCode).send({ error: e.code ?? 'bad_request', message: e.message });
    req.log.error(
      { err: { name: e.name, code: e.code, message: redact(String(e.message ?? '')).slice(0, 300) } },
      'unhandled',
    );
    return reply.status(500).send({ error: 'internal' });
  });

  // Authentication: Bearer access JWT → user → family membership (via SECURITY DEFINER lookup).
  app.decorate('authenticate', async (req: FastifyRequest, _reply: FastifyReply) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw new HttpError(401, 'unauthenticated');
    let userId: string;
    try {
      userId = await verifyAccess(deps.config.jwtSecret, h.slice(7));
    } catch {
      throw new HttpError(401, 'invalid_token');
    }
    const fams = await memberships(deps.pool, userId);
    const wanted = req.headers['x-family-id'];
    const m = (typeof wanted === 'string' && fams.find((f) => f.family_id === wanted)) || fams[0];
    if (!m) throw new HttpError(403, 'no_family');
    req.principal = { userId, familyId: m.family_id, role: m.role, canSubmit: m.can_submit };
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(
    async (v1) => {
      await authRoutes(v1, deps);
      await familyRoutes(v1, deps);
      await portalRoutes(v1, deps);
      await feedRoutes(v1, deps);
      await submissionRoutes(v1, deps);
      await assistantRoutes(v1, deps);
      await miscRoutes(v1, deps);
    },
    { prefix: '/v1' },
  );

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
