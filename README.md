# Escola (working name): GestIB parent app

School messages from GestIB Famílies, in the parent's language. Built from `SPEC.md` (source of truth)
following `CLAUDE.md`.

## Status

| Milestone | Task                                                                         | State                                           |
| --------- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| M0        | T0.1 monorepo (pnpm, turbo, TS strict, ESLint/Prettier, Vitest, CI)          | ✅                                              |
| M0        | T0.2 Drizzle schema for every SPEC §6 table, up/down migrations, forced RLS  | ✅ tested on Postgres 16 + pgvector             |
| M0        | T0.3 envelope encryption, KMS split (API can only encrypt)                   | ✅ local dev KMS; AWS/GCP pending vendor choice |
| M0        | T0.4 shared Zod schemas/enums, `redact()`                                    | ✅                                              |
| M1        | T1.1 mock portal: 2-step login, expiry, lockout, multi-child, submissions    | ✅                                              |
| M1        | T1.2 adapter interface + GestIB adapter, all selectors `TO_BE_DISCOVERED`    | ✅ runs end to end vs mock                      |
| M1        | T1.3 anonymiser, session recorder, discovery guide                           | ✅                                              |
| M1        | **T1.4 capture real fixtures + fill real selectors**                         | ⏳ **needs you**, see below                     |
| M2        | T2.1 lockout guard (logic + serialised store)                                | ✅ Postgres row-lock store still to wire        |
| M2        | T2.2 child discovery + switching                                             | ✅ vs mock; real mechanism TBD                  |
| M2        | T2.4 diff engine, attachment download + dedupe, backfill summary             | ✅ in-memory store; Postgres store next         |
| M2        | ca/es deadline parser + LLM cross-check                                      | ✅ (used by T3.3)                               |
| M6        | write-back gate: preview hash, no retry, `needs_manual`, DB trigger backstop | ✅ reply writer vs mock                         |
| M2–M7     | scheduler, API, enrichment, mobile app, push, assistant, billing             | not started                                     |

58 tests: unit, Postgres (RLS, migrations, confirmation trigger) and real-Chromium runs against the mock portal.

## Hard guarantees already enforced in code and tests

- **No invented GestIB internals.** Real `selectors.ts` is all placeholders; the adapter throws `SelectorNotDiscoveredError` instead of guessing.
- **Password tried at most once (twice only if the result page was ambiguous)**, then `credentials_invalid` and zero further attempts. Concurrent workers are serialised per account.
- **No write without confirmation.** Checked three times: preview hash must match exactly what is sent, the portal form must echo the confirmed text, and a Postgres trigger refuses to queue a submission with no valid confirmation. Submit is never retried.
- **Cross-family reads/writes blocked** by forced Postgres RLS.
- **No secrets in logs.** Worker uses a redacting logger; `console` is lint-banned there.
- **Original always kept** alongside translations (schema + API types require it).

## Run it

```bash
pnpm i
pnpm build && pnpm test          # set TEST_DATABASE_URL to also run the Postgres tests
pnpm mock-portal                 # http://localhost:4010, login parent1 / escola123
```

Worker browser tests need Chromium: `pnpm exec playwright install chromium`, or `CHROME_PATH=/path/to/chrome`.

## Next step that needs you (T1.4)

Follow `docs/SELECTOR_DISCOVERY.md`: run `scripts/record-session.ts`, log in by hand, browse each section,
anonymise the pages, then the real selectors can be written against them. About 30 minutes of your time.
Open decisions (EU vendors, CAIB legal position) are in `docs/OPEN_QUESTIONS.md`.

## Layout

```
apps/mock-portal       synthetic GestIB stand-in for tests and dev
packages/shared        enums, Zod schemas, redact()
packages/crypto        envelope encryption, KMS wrapper/unwrapper split
packages/db            Drizzle schema, migrations (up/down), RLS, withFamily()
workers/sync           adapter interface, GestIB adapter, lockout guard, diff, deadlines, sync, write-back
scripts                anonymiser, session recorder
docs                   SELECTOR_DISCOVERY, OPEN_QUESTIONS, DPIA draft, RUNBOOK
```
