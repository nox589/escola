import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT, createRemoteJWKSet } from 'jose';
import type pg from 'pg';
import { and, drizzle, eq, isNull, schema, withFamily, type Db } from '@escola/db';
import type { OAuthVerifier } from '../context.js';

export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);
export const MAGIC_TTL_MS = 15 * 60_000;

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

/** Auth tables are not family-scoped; queries run as escola_app with no family set. */
export async function asApp<T>(pool: pg.Pool, fn: (db: Db) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE escola_app');
    const r = await fn(drizzle(client, { schema }));
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function signAccess(secret: string, userId: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_S}s`)
    .setAudience('escola-app')
    .sign(new TextEncoder().encode(secret));
}

export async function verifyAccess(secret: string, token: string): Promise<string> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { audience: 'escola-app' });
  if (!payload.sub) throw new Error('no subject');
  return payload.sub;
}

export async function issueTokens(
  pool: pg.Pool,
  secret: string,
  userId: string,
  chainId: string = crypto.randomUUID(),
) {
  const refresh = newToken();
  await asApp(pool, (db) =>
    db.insert(schema.refreshTokens).values({
      userId,
      tokenHash: hashToken(refresh),
      chainId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000),
    }),
  );
  return { accessToken: await signAccess(secret, userId), refreshToken: refresh, expiresIn: ACCESS_TTL_S };
}

/**
 * Rotating refresh tokens with reuse detection: presenting an already-rotated token revokes the
 * whole chain (someone stole it), so both the thief and the user must sign in again.
 */
export async function rotateRefresh(pool: pg.Pool, secret: string, presented: string) {
  const outcome = await asApp(pool, async (db) => {
    const [row] = await db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, hashToken(presented)));
    if (!row || row.revokedAt || row.expiresAt < new Date()) return { error: 'invalid' as const };
    if (row.rotatedAt) {
      await db
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.refreshTokens.chainId, row.chainId));
      return { error: 'reused' as const };
    }
    await db
      .update(schema.refreshTokens)
      .set({ rotatedAt: new Date() })
      .where(eq(schema.refreshTokens.id, row.id));
    return { userId: row.userId, chainId: row.chainId };
  });
  if ('error' in outcome) return outcome;
  return issueTokens(pool, secret, outcome.userId, outcome.chainId);
}

export async function revokeRefresh(pool: pg.Pool, presented: string) {
  await asApp(pool, async (db) => {
    const [row] = await db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, hashToken(presented)));
    if (row)
      await db
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.refreshTokens.chainId, row.chainId));
  });
}

export async function createMagicLink(pool: pg.Pool, email: string) {
  const token = newToken();
  await asApp(pool, (db) =>
    db
      .insert(schema.authTokens)
      .values({
        email: email.toLowerCase(),
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + MAGIC_TTL_MS),
      }),
  );
  return token;
}

export async function consumeMagicLink(pool: pg.Pool, token: string): Promise<string | null> {
  return asApp(pool, async (db) => {
    const [row] = await db
      .update(schema.authTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(schema.authTokens.tokenHash, hashToken(token)), isNull(schema.authTokens.usedAt)))
      .returning();
    if (!row || row.expiresAt < new Date()) return null;
    return row.email;
  });
}

/** Finds or creates the user; first sign-in also creates their family (owner, can submit). */
export async function upsertUser(pool: pg.Pool, email: string, provider: string, locale = 'en') {
  const user = await asApp(pool, async (db) => {
    const [existing] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase()));
    if (existing) return existing;
    const [u] = await db
      .insert(schema.users)
      .values({ email: email.toLowerCase(), locale, authProviders: { [provider]: true } })
      .returning();
    return u!;
  });
  const fams = await memberships(pool, user.id);
  if (!fams.length) {
    const familyId = crypto.randomUUID();
    await withFamily(pool, familyId, async (db) => {
      await db.insert(schema.families).values({ id: familyId, name: 'My family', ownerUserId: user.id });
      await db
        .insert(schema.familyMembers)
        .values({ familyId, userId: user.id, role: 'owner', canSubmit: true });
    });
  }
  return user;
}

export async function memberships(pool: pg.Pool, userId: string) {
  const client = await pool.connect();
  try {
    await client.query('SET ROLE escola_app');
    const r = await client.query<{
      family_id: string;
      role: 'owner' | 'guardian' | 'viewer';
      can_submit: boolean;
    }>('SELECT * FROM user_families($1)', [userId]);
    await client.query('RESET ROLE');
    return r.rows;
  } finally {
    client.release();
  }
}

/** Sign in with Apple / Google: verifies the ID token against the provider's published keys. */
export function createOAuthVerifier(cfg: {
  appleClientId?: string;
  googleClientIds?: string[];
}): OAuthVerifier {
  const apple = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
  const google = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  return {
    async verify(provider, idToken) {
      if (provider === 'apple') {
        if (!cfg.appleClientId) throw new Error('Apple sign-in not configured');
        const { payload } = await jwtVerify(idToken, apple, {
          issuer: 'https://appleid.apple.com',
          audience: cfg.appleClientId,
        });
        if (!payload.email) throw new Error('no email in token');
        return { email: String(payload.email), subject: String(payload.sub) };
      }
      if (!cfg.googleClientIds?.length) throw new Error('Google sign-in not configured');
      const { payload } = await jwtVerify(idToken, google, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: cfg.googleClientIds,
      });
      if (!payload.email || payload.email_verified === false) throw new Error('unverified email');
      return { email: String(payload.email), subject: String(payload.sub) };
    },
  };
}
