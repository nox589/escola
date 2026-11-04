import { eq } from '@escola/db';
import type pg from 'pg';
import { withCredentials, type Envelope, type KmsUnwrapper, type PortalCredentials } from '@escola/crypto';
import { schema, withFamily } from '@escola/db';

/** Worker-only: decrypts the account's credentials just-in-time and zeroises after `fn`. */
export function credentialsProvider(pool: pg.Pool, kms: KmsUnwrapper, familyId: string, accountId: string) {
  return async <R>(fn: (c: PortalCredentials) => Promise<R>): Promise<R> => {
    const row = await withFamily(pool, familyId, async (db) => {
      const [r] = await db
        .select()
        .from(schema.credentials)
        .where(eq(schema.credentials.portalAccountId, accountId));
      return r;
    });
    if (!row) throw new Error('no credentials for account');
    const env: Envelope = {
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.authTag,
      wrappedDek: row.wrappedDek,
      kmsKeyId: row.kmsKeyId,
      keyVersion: row.keyVersion,
    };
    return withCredentials(kms, env, accountId, fn);
  };
}
