-- Beta file storage in Postgres (BLOB_STORE=postgres). Keys are prefixed with the family id and are
-- only ever read by service code (worker, API /v1/files with a signed URL), never by clients directly.
CREATE TABLE IF NOT EXISTS blobs (
  key text PRIMARY KEY,
  data bytea NOT NULL,
  mime text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
