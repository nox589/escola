# CLAUDE.md — build instructions for the GestIB parent app

Read `SPEC.md` fully before writing code. It is the source of truth. If code and spec disagree, stop and ask.

## Golden rules (never break)

1. **Do not invent GestIB internals.** Any selector, URL, form field, or HTTP flow marked `TO BE DISCOVERED` must be found from recorded HTML fixtures or a human-run session. Put discovered values ONLY in `workers/sync/src/adapters/gestib/selectors.ts` with a comment naming the fixture they came from.
2. **Never retry a rejected password more than once.** On a second "invalid credentials" result the account goes to `credentials_invalid`, all logins stop, and the parent is notified.
3. **Never auto-submit a consent/authorisation or any write action.** Every write needs an explicit, per-action parent confirmation recorded in `submission_confirmations`.
4. **Never log secrets or personal data.** Passwords, session cookies, decrypted vault material, and child content must not reach logs, Sentry, or LLM prompts beyond what is required. Use the `redact()` helper.
5. **Always store and show the original text** next to any translation.
6. EU-only infrastructure and EU-region LLM endpoints.

## Stack & conventions

- pnpm workspaces + Turborepo. Node 20 LTS. TypeScript `strict: true` everywhere.
- Mobile: Expo SDK (latest stable), Expo Router, React Query, Zustand, i18next.
- API: Fastify + Zod + Drizzle ORM (Postgres 16 + pgvector). Queue: BullMQ on Redis.
- Worker: Playwright (Chromium), same Drizzle schema via `packages/db`.
- Shared Zod schemas & types live in `packages/shared`; never duplicate types.
- Lint: ESLint + Prettier. Tests: Vitest (unit/integration), Playwright test (worker vs mock portal), Maestro (mobile E2E).
- Conventional commits. One milestone task per PR. Each PR: tests pass, acceptance criteria in SPEC ticked in the PR description.

## Commands (create these in M0)

```
pnpm i
pnpm dev            # api + worker + mock-portal + expo
pnpm test           # all unit/integration
pnpm test:worker    # worker vs mock portal fixtures
pnpm db:migrate
pnpm mock-portal    # serves fixtures at http://localhost:4010
```

## Working style

- Work task by task from SPEC §17 (Milestones). Don't start the next task until acceptance criteria pass.
- Prefer small, typed modules. No real GestIB calls in tests or CI — only `apps/mock-portal`.
- When you hit an unknown, add it to `docs/OPEN_QUESTIONS.md` and stub behind an interface.
