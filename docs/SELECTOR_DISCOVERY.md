# Selector discovery (T1.3 / T1.4)

Golden rule 1: GestIB internals are never guessed. They come from real pages, captured by a human,
anonymised, committed as fixtures, and only then written into
`workers/sync/src/adapters/gestib/selectors.ts` with a comment naming the fixture.

## 1. Capture (human, on your own machine)

```bash
pnpm i
pnpm tsx scripts/record-session.ts            # add --chrome /path/to/chrome if Playwright has no browser
```

A visible browser opens on GestIB Famílies. Log in **by hand** (the script never touches your password).
Then visit, in order:

| Area          | What to capture                                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login         | username page, password page, a deliberately wrong password once (invalid creds page)                                                                                                                                |
| Home          | logged-in home, the "Otros alumnos" switcher, home after switching child                                                                                                                                             |
| Sections      | `missatges`, `circulars`, `autoritzacions`, `notificacions`, `calendariEscolar`, `horari`, `activitats`, `assistencia`, `qualificacions`, `notesParcials`, `valoracions` (populated and, if you can find one, empty) |
| Unknown slugs | "Visualiza y justifica", "Envía documentación al centro", cuestionarios, encuestas, reuniones: note the URL                                                                                                          |
| Forms         | open (do **not** submit) a reply form, an absence justification form, an authorisation                                                                                                                               |
| Attachments   | click one attachment so the download URL pattern is recorded in the trace                                                                                                                                            |

**Only one wrong password, ever.** The lockout threshold is unknown (SPEC §19.3).

Close the window. Raw HTML lands in `fixtures/gestib/raw/` and the trace in `gestib.trace.zip`.
Both are gitignored and contain real personal data: never commit them, never paste them into an LLM.

## 2. Anonymise

```bash
printf "Child Name\nOther Child\nYour Name\nTeacher Name\nSchool Name\n" > /tmp/names.txt
pnpm anonymise fixtures/gestib/raw/005_..._circulars.html fixtures/gestib/circulars/populated.html --names /tmp/names.txt
```

The anonymiser replaces listed names (case/accent-insensitive), emails, phones, DNI/NIE, hidden input
values (CSRF tokens), long numeric ids and session tokens, consistently within a file. **Open every output
file and read it** before committing. Delete `/tmp/names.txt`.

Target layout:

```
fixtures/gestib/login/{username.html,password.html,invalid.html,forced-change.html}
fixtures/gestib/home/{single-child.html,multi-child.html,after-switch.html}
fixtures/gestib/<slug>/{populated.html,empty.html}
fixtures/gestib/forms/<kind>/{form.html,success.html,error.html}
```

## 3. Write selectors against fixtures

For each `TO_BE_DISCOVERED` value in `selectors.ts`:

1. Open the fixture, find a **stable** hook (id, name attribute, form action) over styling classes.
2. Replace the placeholder and add a comment: `// fixtures/gestib/circulars/populated.html`.
3. Add a snapshot test that parses the fixture to expected JSON (T1.4 AC).
4. Teach `apps/mock-portal` to serve the real fixture for that route (it currently serves synthetic pages).

Answer these in `docs/OPEN_QUESTIONS.md` as you go: child-switch mechanism (query param / POST / session),
whether pages are server-rendered or call a JSON backend (check the trace's Network tab: if there is JSON,
prefer it), pagination, attachment URL pattern, Catalan/Spanish texts of the error messages.

## 4. Canary

Once login + home + missatges + circulars are filled:

```bash
ALLOW_REAL_PORTAL=true CANARY_USERNAME=... CANARY_PASSWORD=... pnpm --filter @escola/sync-worker canary
```

Read-only, prints counts only. Never in CI.
