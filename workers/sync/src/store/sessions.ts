import type pg from 'pg';
import { open, seal, type KmsUnwrapper, type KmsWrapper } from '@escola/crypto';
import { and, eq, isNull, schema, withFamily } from '@escola/db';
import type { SessionStore, StorageState } from '../core/sync.js';

/** Portal cookies, envelope-encrypted like credentials (SPEC §6 portal_sessions). */
export class PgSessionStore implements SessionStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly kms: KmsWrapper & KmsUnwrapper,
    private readonly familyId: string,
    private readonly accountId: string,
    /** Observed: sessions expire overnight. Estimate 8 h; the resume check is what really decides. */
    private readonly ttlMs = 8 * 3600_000,
  ) {}

  #aad = () => `session:${this.accountId}`;

  async load(): Promise<StorageState | null> {
    const row = await withFamily(this.pool, this.familyId, async (db) => {
      const [r] = await db
        .select()
        .from(schema.portalSessions)
        .where(
          and(
            eq(schema.portalSessions.portalAccountId, this.accountId),
            isNull(schema.portalSessions.invalidatedAt),
          ),
        );
      return r;
    });
    if (!row || (row.expiresAtEstimate && row.expiresAtEstimate < new Date())) return null;
    const pt = await open(
      this.kms,
      {
        ciphertext: row.encryptedStorageState,
        iv: row.iv,
        authTag: row.authTag,
        wrappedDek: row.wrappedDek,
        kmsKeyId: row.kmsKeyId,
        keyVersion: row.keyVersion,
      },
      this.#aad(),
    );
    try {
      return JSON.parse(pt.toString('utf8')) as StorageState;
    } finally {
      pt.fill(0);
    }
  }

  async save(state: StorageState): Promise<void> {
    const env = await seal(this.kms, Buffer.from(JSON.stringify(state)), this.#aad());
    await withFamily(this.pool, this.familyId, async (db) => {
      await db.delete(schema.portalSessions).where(eq(schema.portalSessions.portalAccountId, this.accountId));
      await db.insert(schema.portalSessions).values({
        familyId: this.familyId,
        portalAccountId: this.accountId,
        encryptedStorageState: Buffer.from(env.ciphertext),
        iv: Buffer.from(env.iv),
        authTag: Buffer.from(env.authTag),
        wrappedDek: Buffer.from(env.wrappedDek),
        kmsKeyId: env.kmsKeyId,
        keyVersion: env.keyVersion,
        expiresAtEstimate: new Date(Date.now() + this.ttlMs),
      });
    });
  }

  async invalidate(): Promise<void> {
    await withFamily(this.pool, this.familyId, (db) =>
      db
        .update(schema.portalSessions)
        .set({ invalidatedAt: new Date() })
        .where(eq(schema.portalSessions.portalAccountId, this.accountId)),
    );
  }
}
