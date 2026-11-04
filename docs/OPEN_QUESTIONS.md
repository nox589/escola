# Open questions

Status key: **[TBD]** discover from the real portal · **[OPEN]** human decision · **[ASSUMPTION]** chosen for now.

## Portal (blocks T1.4 onwards)

1. [TBD] Every selector/URL in `selectors.ts` (all `TO_BE_DISCOVERED`).
2. [TBD] Famílies entry URL that triggers the idp redirect.
3. [TBD] Child switch ("Otros alumnos"): query param, POST, or session state? Adapter assumes "click the option".
4. [TBD] Slugs for absences ("Visualiza y justifica"), document upload, questionnaires, surveys, meetings.
5. [TBD] Catalan and Spanish texts of "invalid username or password", forced-change and expiry pages.
6. [TBD] idp lockout threshold and captcha behaviour. Guard assumes strict: max 1 retry, only when ambiguous.
7. [TBD] Session lifetime (observed: overnight). Measure with the canary.
8. [TBD] Is there a JSON backend behind the pages? If yes, prefer it over DOM scraping.
9. [TBD] Attachment URL pattern and whether links are single-use.
10. [TBD] How to verify a sent reply (read back from a sent list?). `verify` currently trusts the success page.

## Product / legal

11. [OPEN] Does CAIB permit automated access? Lawyer opinion + partnership approach before public launch.
12. [OPEN] App Store / Play review stance on apps logging into government portals.
13. [OPEN] Legal entity (controller), brand name, ToS/Privacy text.
14. [OPEN] Second guardian with their own GestIB login: dedupe rule for children across accounts.
15. [OPEN] Cl@ve-only parents: unsupported; copy for asking the school for a username/password.

## Infrastructure

16. [OPEN] EU hosting (Fly.io Madrid/Paris vs AWS eu-south-2), KMS (AWS vs GCP), LLM endpoint (Bedrock EU vs Azure EU), email provider. `packages/crypto` only implements the local dev KMS; the AWS/GCP wrapper is a ~40-line add once chosen.
17. [OPEN] Embedding model → vector dimension (schema uses 1536).

## Decisions taken in this build (review)

- [ASSUMPTION] `family_id` is denormalised onto every child-content table so one RLS policy covers all of them.
- [ASSUMPTION] `portal_accounts.credential_version` added so the lockout guard can count failures per credential version (SPEC §8.4).
- [ASSUMPTION] `LoginResult` gained `ambiguous?: boolean` (extension to SPEC §8.1) so the guard knows when one retry is allowed. "Back on the password form with no error shown" is the only ambiguous case today.
- [ASSUMPTION] `submission_confirmations.invalidated_at` added; a DB trigger refuses to move a submission past `awaiting_confirmation` without a non-invalidated confirmation (backstop for golden rule 3).
- [ASSUMPTION] Embeddings: Cohere multilingual v3 on Bedrock EU, 1024 dims (good for ca/es). Change EMBEDDING_DIM + migration if the vendor changes.
- [ASSUMPTION] First sync doubles as the one-attempt login check (no separate verify_login job).
- [ASSUMPTION] Each user gets a family on first sign-in; accepting an invite removes that empty family.
- [ASSUMPTION] Children's names are replaced with placeholders before text goes to the LLM.
- [ASSUMPTION] Co-parents join with can_submit=false; the owner turns it on per person.
- [OPEN] Bedrock model IDs and region (eu-west-3 default). The direct Anthropic API is refused in production.
- Migrations are hand-applied SQL (`up`/`down`) generated from the Drizzle schema, because drizzle-kit has no down migrations.
