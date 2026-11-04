DROP FUNCTION IF EXISTS accounts_due_for_sync();
DROP FUNCTION IF EXISTS user_families(uuid);
DROP TABLE IF EXISTS "family_invites", "refresh_tokens", "auth_tokens";
ALTER TABLE "items" DROP COLUMN IF EXISTS "enriched_hash";
DROP INDEX IF EXISTS "embeddings_family";
ALTER TABLE "embeddings" ALTER COLUMN "vector" TYPE vector(1536);
ALTER TABLE "items" DROP COLUMN IF EXISTS "deadline_raw";
