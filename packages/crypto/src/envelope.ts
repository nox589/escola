import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KmsUnwrapper, KmsWrapper } from './kms.js';

/** Stored shape; maps 1:1 onto the `credentials` / `portal_sessions` columns. */
export interface Envelope {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
  wrappedDek: Uint8Array;
  kmsKeyId: string;
  keyVersion: number;
}

/**
 * Envelope-encrypt: fresh random 256-bit DEK per record, AES-256-GCM, DEK wrapped by KMS.
 * `aad` binds the ciphertext to its owner row (e.g. portal_account_id) so it cannot be swapped.
 */
export async function seal(kms: KmsWrapper, plaintext: Uint8Array, aad: string): Promise<Envelope> {
  const dek = randomBytes(32);
  try {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', dek, iv);
    c.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([c.update(plaintext), c.final()]);
    return {
      ciphertext,
      iv,
      authTag: c.getAuthTag(),
      wrappedDek: await kms.wrapKey(dek),
      kmsKeyId: kms.keyId,
      keyVersion: kms.keyVersion,
    };
  } finally {
    dek.fill(0);
  }
}

/** Worker only. Caller MUST zeroise the returned buffer after use (see withOpened). */
export async function open(kms: KmsUnwrapper, env: Envelope, aad: string): Promise<Buffer> {
  const dek = Buffer.from(await kms.unwrapKey(env.wrappedDek, env.kmsKeyId, env.keyVersion));
  try {
    const d = createDecipheriv('aes-256-gcm', dek, env.iv);
    d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(Buffer.from(env.authTag));
    return Buffer.concat([d.update(env.ciphertext), d.final()]);
  } finally {
    dek.fill(0);
  }
}

/** Decrypts, hands the plaintext to `fn`, and always zeroises it afterwards. */
export async function withOpened<R>(
  kms: KmsUnwrapper,
  env: Envelope,
  aad: string,
  fn: (plaintext: Buffer) => Promise<R>,
): Promise<R> {
  const pt = await open(kms, env, aad);
  try {
    return await fn(pt);
  } finally {
    pt.fill(0);
  }
}

// ---- Credentials helpers: username + password encrypted together (SPEC §6) ----
export interface PortalCredentials {
  username: string;
  password: string;
}

export function sealCredentials(kms: KmsWrapper, creds: PortalCredentials, portalAccountId: string) {
  return seal(kms, Buffer.from(JSON.stringify(creds), 'utf8'), `credentials:${portalAccountId}`);
}

export function withCredentials<R>(
  kms: KmsUnwrapper,
  env: Envelope,
  portalAccountId: string,
  fn: (creds: PortalCredentials) => Promise<R>,
): Promise<R> {
  return withOpened(kms, env, `credentials:${portalAccountId}`, (pt) =>
    fn(JSON.parse(pt.toString('utf8')) as PortalCredentials),
  );
}

/** "j****5" style hint, safe to store in portal_accounts.username_hint. */
export function maskUsername(username: string): string {
  if (username.length <= 2) return '*'.repeat(username.length);
  return `${username[0]}${'*'.repeat(Math.min(username.length - 2, 6))}${username[username.length - 1]}`;
}
