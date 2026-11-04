# Runbook

## Account stuck in `credentials_invalid`

Expected after a rejected password. Logins are stopped by design. Only the parent fixing their password
(`PUT /portal-accounts/{id}/credentials`) bumps `credential_version` and resets the counter.
Never reset `consecutive_auth_failures` by hand; you risk locking their real GestIB account.

## Parser drift alert

A section returned an unknown page or a selector stopped matching. Last good data is kept; parents are
not notified unless data is >24 h stale. Fetch the redacted snapshot (7-day retention), capture a fresh
fixture (docs/SELECTOR_DISCOVERY.md), update `selectors.ts`, add a fixture test, deploy.

## Portal down

Backoff 5 / 15 / 45 min; credential counter untouched. Check `/admin/sync-runs`.

## Submission in `needs_manual`

The portal response was ambiguous and verification failed. Writes are never retried automatically.
The parent has been told to check GestIB. Do not resubmit on their behalf.

## Local Postgres for tests

```bash
docker run -d --name escola-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=escola_test -p 5432:5432 pgvector/pgvector:pg16
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/escola_test
pnpm test
```
