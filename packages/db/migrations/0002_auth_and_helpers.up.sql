-- Auth tables (user-scoped, not family-scoped), invites, item columns for deadlines and enrichment.
ALTER TABLE "items" ADD COLUMN "deadline_raw" text;
ALTER TABLE "items" ADD COLUMN "enriched_hash" text;

-- Embedding model decided: Cohere multilingual v3 on Bedrock EU (1024 dims). Table is empty at this point.
ALTER TABLE "embeddings" ALTER COLUMN "vector" TYPE vector(1024);
CREATE INDEX "embeddings_family" ON "embeddings" ("family_id");

CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "auth_tokens_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"token_hash" text NOT NULL,
	"chain_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE "family_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"family_id" uuid NOT NULL REFERENCES "families"("id") ON DELETE cascade,
	"email" text NOT NULL,
	"role" "member_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_user_id" uuid REFERENCES "users"("id"),
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "family_invites_token_hash_unique" UNIQUE("token_hash")
);

GRANT SELECT, INSERT, UPDATE, DELETE ON auth_tokens, refresh_tokens, family_invites TO escola_app;

-- Membership lookup must work before app.family_id is known (it is how we learn it).
-- SECURITY DEFINER, returns only the caller-supplied user's own memberships.
CREATE OR REPLACE FUNCTION user_families(p_user_id uuid)
  RETURNS TABLE (family_id uuid, role member_role, can_submit boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT fm.family_id, fm.role, fm.can_submit FROM family_members fm WHERE fm.user_id = p_user_id
  $$;
REVOKE ALL ON FUNCTION user_families(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_families(uuid) TO escola_app;

-- Scheduler needs to enumerate accounts due for sync across families, without any content.
CREATE OR REPLACE FUNCTION accounts_due_for_sync()
  RETURNS TABLE (portal_account_id uuid, family_id uuid, last_sync_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT id, family_id, last_sync_at FROM portal_accounts WHERE status = 'active'
  $$;
REVOKE ALL ON FUNCTION accounts_due_for_sync() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accounts_due_for_sync() TO escola_app;
