import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, migrateDown, migrateUp, schema, withFamily } from './index.js';
import { createTestDatabase } from './testing.js';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

/** Drizzle wraps driver errors; assert on the underlying Postgres message. */
async function pgErr(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return `${err.message} ${err.cause?.message ?? ''}`;
  }
  throw new Error('expected rejection');
}

d('database (TEST_DATABASE_URL)', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  const famA = crypto.randomUUID();
  const famB = crypto.randomUUID();

  beforeAll(async () => {
    testDb = await createTestDatabase(url!);
    admin = new pg.Client({ connectionString: testDb.url });
    await admin.connect();
    await migrateDown(admin); // start from an empty schema so up/down is exercised fully
    pool = createPool(testDb.url);
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.end();
    await testDb?.drop();
  });

  it('migrates up, down, and up again', async () => {
    expect(await migrateUp(admin)).toEqual(['0000_init', '0001_rls', '0002_auth_and_helpers', '0003_role_membership']);
    expect(await migrateDown(admin)).toEqual(['0003_role_membership', '0002_auth_and_helpers', '0001_rls', '0000_init']);
    const t = await admin.query(
      `SELECT count(*)::int n FROM pg_tables WHERE schemaname='public' AND tablename='items'`,
    );
    expect(t.rows[0].n).toBe(0);
    expect(await migrateUp(admin)).toEqual(['0000_init', '0001_rls', '0002_auth_and_helpers', '0003_role_membership']);
  });

  it('RLS blocks cross-family reads and writes', async () => {
    const u = await admin.query(`INSERT INTO users(email) VALUES ('a@x.test'),('b@x.test') RETURNING id`);
    await admin.query(`INSERT INTO families(id,name,owner_user_id) VALUES ($1,'A',$2),($3,'B',$4)`, [
      famA,
      u.rows[0].id,
      famB,
      u.rows[1].id,
    ]);
    for (const fam of [famA, famB]) {
      await withFamily(pool, fam, (db) =>
        db.insert(schema.portalAccounts).values({ familyId: fam, usernameHint: `hint-${fam.slice(0, 4)}` }),
      );
    }

    const seenByA = await withFamily(pool, famA, (db) => db.select().from(schema.portalAccounts));
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0]!.familyId).toBe(famA);

    const famRowsSeenByA = await withFamily(pool, famA, (db) => db.select().from(schema.families));
    expect(famRowsSeenByA.map((f) => f.id)).toEqual([famA]);

    // A cannot read B's row even by id...
    const bAcc = await admin.query(`SELECT id FROM portal_accounts WHERE family_id=$1`, [famB]);
    const direct = await withFamily(pool, famA, (db) =>
      db.select().from(schema.portalAccounts).where(eq(schema.portalAccounts.id, bAcc.rows[0].id)),
    );
    expect(direct).toHaveLength(0);

    // ...nor write into B.
    expect(
      await pgErr(
        withFamily(pool, famA, (db) =>
          db.insert(schema.portalAccounts).values({ familyId: famB, usernameHint: 'x' }),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('a submission cannot be queued without a valid confirmation', async () => {
    const child = await withFamily(pool, famA, async (db) => {
      const [acc] = await db.select().from(schema.portalAccounts);
      const [c] = await db
        .insert(schema.children)
        .values({ familyId: famA, portalAccountId: acc!.id, portalChildRef: 'mock-1', displayName: 'Maya' })
        .returning();
      return c!;
    });

    expect(
      await pgErr(
        withFamily(pool, famA, (db) =>
          db.insert(schema.submissions).values({
            familyId: famA,
            childId: child.id,
            kind: 'authorisation',
            userInput: {},
            userLang: 'en',
            state: 'queued',
          }),
        ),
      ),
    ).toMatch(/created as draft/);

    const sub = await withFamily(pool, famA, async (db) => {
      const [s] = await db
        .insert(schema.submissions)
        .values({ familyId: famA, childId: child.id, kind: 'authorisation', userInput: {}, userLang: 'en' })
        .returning();
      return s!;
    });

    expect(
      await pgErr(
        withFamily(pool, famA, (db) =>
          db.update(schema.submissions).set({ state: 'queued' }).where(eq(schema.submissions.id, sub.id)),
        ),
      ),
    ).toMatch(/no valid parent confirmation/);

    // With a confirmation recorded it can move on; once invalidated (parent edited), it cannot.
    const u = await admin.query(`SELECT id FROM users LIMIT 1`);
    await withFamily(pool, famA, (db) =>
      db.insert(schema.submissionConfirmations).values({
        familyId: famA,
        submissionId: sub.id,
        userId: u.rows[0].id,
        previewHash: 'a'.repeat(64),
      }),
    );
    await withFamily(pool, famA, (db) =>
      db.update(schema.submissions).set({ state: 'confirmed' }).where(eq(schema.submissions.id, sub.id)),
    );
    await withFamily(pool, famA, async (db) => {
      await db
        .update(schema.submissions)
        .set({ state: 'awaiting_confirmation' })
        .where(eq(schema.submissions.id, sub.id));
      await db
        .update(schema.submissionConfirmations)
        .set({ invalidatedAt: new Date() })
        .where(eq(schema.submissionConfirmations.submissionId, sub.id));
    });
    expect(
      await pgErr(
        withFamily(pool, famA, (db) =>
          db.update(schema.submissions).set({ state: 'queued' }).where(eq(schema.submissions.id, sub.id)),
        ),
      ),
    ).toMatch(/no valid parent confirmation/);
  });
});
