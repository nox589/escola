# DPIA (draft template, SPEC §14)

Required before any beta beyond the founder's family. Fill with the legal entity's DPO/lawyer.

## 1. Processing description

- **Controller:** [OPEN legal entity]
- **Purpose:** read school communications from GestIB Famílies on a guardian's instruction, translate and summarise them, notify, and (optionally) submit replies/forms the guardian explicitly confirms.
- **Data subjects:** guardians (users), their children (minors), school staff named in messages.
- **Lawful basis:** contract (service), explicit consent (AI processing), guardian mandate (read; separately, submit).

## 2. Data inventory

| Data                                   | Where                             | Encryption                                    | Retention                                               |
| -------------------------------------- | --------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| GestIB username + password             | `credentials`                     | KMS envelope, AES-256-GCM, API cannot decrypt | until removed / account deleted (immediate hard delete) |
| Portal session cookies                 | `portal_sessions`                 | same envelope                                 | until expiry / invalidation                             |
| School items + attachments             | `items`, S3                       | at rest (Postgres disk, S3 SSE-KMS)           | 2 school years or account deletion [ASSUMPTION]         |
| Translations, summaries, embeddings    | `item_translations`, `embeddings` | at rest                                       | as items                                                |
| Raw HTML snapshots                     | S3                                | SSE-KMS                                       | 30 days                                                 |
| Debug HTML (parser drift)              | S3                                | SSE-KMS, redacted                             | 7 days                                                  |
| Submissions + confirmations + receipts | DB + S3                           | at rest                                       | as items                                                |
| Audit log                              | `audit_log`                       | no secrets stored                             | [OPEN]                                                  |

## 3. Flows and sub-processors

Hosting · KMS · LLM (EU region, zero retention, no training) · email · Expo push (APNs/FCM) · RevenueCat · Sentry (EU, PII scrubbing). All EU or SCC-covered. List vendors once chosen (OPEN_QUESTIONS #16).

## 4. Risks and mitigations

| Risk                                     | Mitigation                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Credential breach                        | envelope encryption, worker-only decrypt, zeroise after use, no logging (`redact()`), egress limited to `*.caib.es` |
| Locking a parent out of GestIB           | lockout guard: max 1 retry, only when ambiguous; stop + notify on rejection                                         |
| Mis-translation leads to missed deadline | original always shown; deterministic deadline parser cross-checks LLM; "Check original" badge                       |
| Unauthorised submission                  | per-action confirmation with preview hash, biometric re-check, DB trigger backstop, no auto-retry                   |
| Cross-family data leak                   | Postgres RLS forced on every family table (tested)                                                                  |
| Children's data sent to LLM              | minimise; evaluate name placeholdering [ASSUMPTION]; EU endpoint                                                    |
| Portal ToS conflict                      | [OPEN] legal review + CAIB approach                                                                                 |

## 5. Data subject rights

Export (JSON + files zip, automated within minutes). Delete (credentials/sessions immediately, all data ≤30 days, backups ≤35 days).
