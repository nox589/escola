import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { magicLinkRequest, verifyRequest } from '@escola/shared';
import type { AppDeps } from '../context.js';
import { HttpError } from '../app.js';
import {
  consumeMagicLink,
  createMagicLink,
  issueTokens,
  revokeRefresh,
  rotateRefresh,
  upsertUser,
} from '../services/auth.js';
import { magicLinkEmail } from '../services/mail.js';

const refreshBody = z.object({ refreshToken: z.string().min(20) });

export async function authRoutes(app: FastifyInstance, deps: AppDeps) {
  const strict = { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } };

  // Always 204, whether or not the email exists (no account enumeration).
  app.post('/auth/magic-link', strict, async (req, reply) => {
    const { email } = magicLinkRequest.parse(req.body);
    const locale =
      z
        .string()
        .max(5)
        .optional()
        .parse((req.body as { locale?: string })?.locale) ?? 'en';
    const token = await createMagicLink(deps.pool, email);
    const { subject, text } = magicLinkEmail(locale, `${deps.config.appUrl}/auth?token=${token}`);
    await deps.mailer.send(email, subject, text);
    return reply.status(204).send();
  });

  app.post('/auth/verify', strict, async (req) => {
    const { token } = verifyRequest.parse(req.body);
    const email = await consumeMagicLink(deps.pool, token);
    if (!email) throw new HttpError(401, 'invalid_or_expired_link');
    const locale = z
      .string()
      .max(5)
      .optional()
      .parse((req.body as { locale?: string })?.locale);
    const user = await upsertUser(deps.pool, email, 'email', locale);
    return {
      user: { id: user.id, email: user.email },
      ...(await issueTokens(deps.pool, deps.config.jwtSecret, user.id)),
    };
  });

  app.post('/auth/oauth/:provider', strict, async (req) => {
    const { provider } = z.object({ provider: z.enum(['apple', 'google']) }).parse(req.params);
    const { idToken, locale } = z
      .object({ idToken: z.string().min(20), locale: z.string().max(5).optional() })
      .parse(req.body);
    let email: string;
    try {
      ({ email } = await deps.oauth.verify(provider, idToken));
    } catch {
      throw new HttpError(401, 'invalid_id_token');
    }
    const user = await upsertUser(deps.pool, email, provider, locale);
    return {
      user: { id: user.id, email: user.email },
      ...(await issueTokens(deps.pool, deps.config.jwtSecret, user.id)),
    };
  });

  app.post('/auth/refresh', async (req) => {
    const { refreshToken } = refreshBody.parse(req.body);
    const r = await rotateRefresh(deps.pool, deps.config.jwtSecret, refreshToken);
    if ('error' in r) throw new HttpError(401, r.error === 'reused' ? 'refresh_reused' : 'invalid_refresh');
    return r;
  });

  app.post('/auth/logout', async (req, reply) => {
    const { refreshToken } = refreshBody.parse(req.body);
    await revokeRefresh(deps.pool, refreshToken);
    return reply.status(204).send();
  });
}
