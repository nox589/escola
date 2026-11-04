import type { BrowserContext, Page } from 'playwright';
import { GESTIB_SECTION_SLUGS, type GestibSlug, type Section, type SubmissionKind } from '@escola/shared';
import { ParserDriftError, SelectorNotDiscoveredError, WriteNotConfirmedError } from '../errors.js';
import type {
  Credentials,
  LoginResult,
  NormalisedItem,
  PortalAdapter,
  PortalChild,
  SectionReader,
  SectionWriter,
} from '../types.js';
import { gestibSelectors, TBD, type GestibSelectors } from './selectors.js';

export const GESTIB_ADAPTER_VERSION = '0.1.0';
const NAV_TIMEOUT = 30_000;

export interface GestibAdapterOptions {
  selectors?: GestibSelectors;
  /** Writers are feature-flagged per kind (SPEC §9); none are enabled by default. */
  enabledWriters?: SubmissionKind[];
}

/** Throws instead of ever using a placeholder value. */
function need<T extends string>(value: T, key: string): T {
  if (value === TBD || value.includes(TBD)) throw new SelectorNotDiscoveredError(key);
  return value;
}

async function exists(page: Page, selector: string): Promise<boolean> {
  return (await page.locator(selector).count()) > 0;
}

async function safeText(page: Page): Promise<string> {
  try {
    return (await page.locator('body').innerText({ timeout: 5_000 })).toLowerCase();
  } catch {
    return '';
  }
}

function isNetworkError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /timeout|net::|ECONNREFUSED|ECONNRESET|ENOTFOUND|Navigation failed/i.test(m);
}

export function createGestibAdapter(opts: GestibAdapterOptions = {}): PortalAdapter {
  const S = opts.selectors ?? gestibSelectors;
  const enabled = new Set(opts.enabledWriters ?? []);

  /** Classifies the landing page after a login step into a LoginResult. */
  async function classify(page: Page): Promise<LoginResult> {
    const L = S.login;
    if (await exists(page, need(L.loggedInMarker, 'login.loggedInMarker'))) return { ok: true, page };
    if (await exists(page, need(L.accountLockedMarker, 'login.accountLockedMarker')))
      return { ok: false, code: 'ACCOUNT_LOCKED' };
    if (await exists(page, need(L.captchaMarker, 'login.captchaMarker')))
      return { ok: false, code: 'CAPTCHA' };
    if (await exists(page, need(L.forcedPasswordChangeMarker, 'login.forcedPasswordChangeMarker')))
      return { ok: false, code: 'FORCED_PASSWORD_CHANGE' };
    if (await exists(page, need(L.passwordExpiredMarker, 'login.passwordExpiredMarker')))
      return { ok: false, code: 'PASSWORD_EXPIRED' };

    const text = await safeText(page);
    if (
      (await exists(page, need(L.invalidCredentialsMarker, 'login.invalidCredentialsMarker'))) ||
      L.invalidCredentialsTexts.some((t) => text.includes(t.toLowerCase()))
    )
      return { ok: false, code: 'INVALID_CREDENTIALS', ambiguous: false };

    // Back on the password form with no error shown: we cannot tell why. One fresh-context retry allowed.
    if (await exists(page, need(L.passwordInput, 'login.passwordInput')))
      return {
        ok: false,
        code: 'INVALID_CREDENTIALS',
        ambiguous: true,
        detail: 'password form re-shown without error',
      };

    return { ok: false, code: 'UNKNOWN_PAGE', detail: 'unrecognised page after login' };
  }

  async function login(ctx: BrowserContext, creds: Credentials): Promise<LoginResult> {
    const L = S.login;
    const page = await ctx.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT);
    try {
      const res = await page.goto(need(S.urls.entry, 'urls.entry'), { waitUntil: 'load' });
      if (res && res.status() >= 500)
        return { ok: false, code: 'PORTAL_DOWN', detail: `HTTP ${res.status()}` };
      if (await exists(page, need(L.loggedInMarker, 'login.loggedInMarker'))) return { ok: true, page };

      // Step 1: username
      if (!(await exists(page, need(L.usernameInput, 'login.usernameInput')))) return classify(page);
      await page.fill(L.usernameInput, creds.username);
      await Promise.all([
        page.waitForLoadState('load'),
        page.click(need(L.usernameSubmit, 'login.usernameSubmit')),
      ]);

      // Step 2: password (idp.caib.es/passwordLoginForm)
      const pwd = need(L.passwordInput, 'login.passwordInput');
      try {
        await page.waitForSelector(pwd, { timeout: 10_000 });
      } catch {
        return classify(page);
      }
      await page.fill(pwd, creds.password);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'load' }).catch(() => undefined),
        page.click(need(L.passwordSubmit, 'login.passwordSubmit')),
      ]);
      const result = await classify(page);
      if (!result.ok) await page.close();
      return result;
    } catch (e) {
      await page.close().catch(() => undefined);
      if (e instanceof SelectorNotDiscoveredError) throw e;
      if (isNetworkError(e))
        return { ok: false, code: 'PORTAL_DOWN', detail: (e as Error).message.slice(0, 200) };
      throw e;
    }
  }

  async function isLoggedIn(page: Page) {
    return exists(page, need(S.login.loggedInMarker, 'login.loggedInMarker'));
  }

  async function gotoSection(page: Page, slug: string) {
    const res = await page.goto(need(S.urls.familiesBase, 'urls.familiesBase') + slug, { waitUntil: 'load' });
    if (res && res.status() >= 500) throw new Error(`net:: portal returned ${res.status()}`);
    if (!(await isLoggedIn(page))) throw new SessionExpiredError();
  }

  async function listChildren(page: Page): Promise<PortalChild[]> {
    const C = S.children;
    if (!(await isLoggedIn(page))) await gotoSection(page, 'home');
    const opts = await page.locator(need(C.option, 'children.option')).all();
    const out: PortalChild[] = [];
    for (const o of opts) {
      const ref = await o.getAttribute(need(C.refAttr, 'children.refAttr'));
      if (!ref) throw new ParserDriftError('child option without ref');
      out.push({
        ref,
        displayName: (await o.innerText()).trim(),
        schoolName: (await o.getAttribute(need(C.schoolAttr, 'children.schoolAttr'))) ?? undefined,
        classLabel: (await o.getAttribute(need(C.classAttr, 'children.classAttr'))) ?? undefined,
      });
    }
    return out;
  }

  async function switchChild(page: Page, child: PortalChild): Promise<void> {
    const C = S.children;
    need(C.switchMechanism, 'children.switchMechanism');
    await gotoSection(page, 'home');
    const option = page.locator(
      `${need(C.option, 'children.option')}[${need(C.refAttr, 'children.refAttr')}="${child.ref}"]`,
    );
    if ((await option.count()) === 0) throw new ParserDriftError(`child ${child.ref} not in switcher`);
    const current = await option.first().getAttribute(need(C.currentAttr, 'children.currentAttr'));
    if (current) return;
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), option.first().click()]);
    const nowCurrent = await page
      .locator(`${C.option}[${C.refAttr}="${child.ref}"]`)
      .first()
      .getAttribute(C.currentAttr);
    if (!nowCurrent) throw new ParserDriftError(`switch to child ${child.ref} did not take effect`);
  }

  function reader(slug: GestibSlug, section: Section): SectionReader {
    const X = S.section;
    return {
      slug,
      section,
      scope: 'child',
      async read(page) {
        await gotoSection(page, slug);
        const items: NormalisedItem[] = [];
        for (const el of await page.locator(need(X.item, 'section.item')).all()) {
          const ref = await el.getAttribute(need(X.itemRefAttr, 'section.itemRefAttr'));
          if (!ref) throw new ParserDriftError('item without ref', slug);
          const opt = async (sel: string, key: string) => {
            const l = el.locator(need(sel, key));
            return (await l.count()) ? (await l.first().innerText()).trim() : undefined;
          };
          const bodyLoc = el.locator(need(X.body, 'section.body'));
          const dateLoc = el.locator(need(X.date, 'section.date'));
          const attachments: NormalisedItem['attachments'] = [];
          for (const a of await el.locator(need(X.attachment, 'section.attachment')).all()) {
            const href = await a.getAttribute('href');
            const name = (await a.innerText()).trim();
            if (!href) continue;
            attachments.push({
              name,
              // Downloaded inside the authenticated context; never a raw URL handed elsewhere.
              download: async (p) => {
                const r = await p.context().request.get(new URL(href, p.url()).toString());
                if (!r.ok()) throw new Error(`attachment download failed: ${r.status()}`);
                return Buffer.from(await r.body());
              },
            });
          }
          items.push({
            portalRef: ref,
            section,
            title: (await opt(X.title, 'section.title')) ?? '',
            bodyHtml: (await bodyLoc.count()) ? await bodyLoc.first().innerHTML() : '',
            bodyText: (await bodyLoc.count()) ? (await bodyLoc.first().innerText()).trim() : '',
            sender: await opt(X.sender, 'section.sender'),
            postedAt: (await dateLoc.count())
              ? ((await dateLoc.first().getAttribute(need(X.dateAttr, 'section.dateAttr'))) ?? undefined)
              : undefined,
            deadlineRaw: await opt(X.deadline, 'section.deadline'),
            attachments,
          });
        }
        return items;
      },
    };
  }

  const readers: SectionReader[] = (Object.entries(GESTIB_SECTION_SLUGS) as [GestibSlug, Section | null][])
    .filter((e): e is [GestibSlug, Section] => e[1] !== null)
    .map(([slug, section]) => reader(slug, section));

  const replyWriter: SectionWriter = {
    kind: 'reply_message',
    async prepare(page, sub) {
      if (!/^[a-f0-9]{64}$/.test(sub.previewHash)) throw new WriteNotConfirmedError();
      if (!sub.itemRef) throw new Error('reply_message requires itemRef');
      const R = S.reply;
      await page.goto(need(R.formUrl(sub.itemRef), 'reply.formUrl'), { waitUntil: 'load' });
      if (!(await isLoggedIn(page))) throw new SessionExpiredError();
      await page.fill(need(R.text, 'reply.text'), sub.text);
      const echo = await page.inputValue(R.text);
      return { screenshot: await page.screenshot(), fieldEcho: { text: echo } };
    },
    async submit(page) {
      const R = S.reply;
      try {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'load' }),
          page.click(need(R.submit, 'reply.submit')),
        ]);
      } catch (e) {
        if (e instanceof SelectorNotDiscoveredError) throw e;
        // We may or may not have sent it. Never retry; go to verify.
        return { status: 'ambiguous', detail: 'navigation after submit failed' };
      }
      return (await exists(page, need(R.successMarker, 'reply.successMarker')))
        ? { status: 'submitted' }
        : { status: 'ambiguous', detail: 'no success marker' };
    },
    async verify(page) {
      // [TBD] Real verification should read the message back from the sent list.
      const R = S.reply;
      const marker = page.locator(need(R.successMarker, 'reply.successMarker'));
      if (!(await marker.count())) return { verified: false };
      return {
        verified: true,
        confirmationRef:
          (await marker.first().getAttribute(need(R.successRefAttr, 'reply.successRefAttr'))) ?? undefined,
        pageText: (await safeText(page)).slice(0, 2000),
      };
    },
  };

  async function resumeSession(page: Page) {
    const res = await page.goto(need(S.urls.entry, 'urls.entry'), { waitUntil: 'load' });
    if (res && res.status() >= 500) return false;
    return isLoggedIn(page);
  }

  return {
    id: 'gestib',
    version: GESTIB_ADAPTER_VERSION,
    login,
    isLoggedIn,
    resumeSession,
    listChildren,
    switchChild,
    sections: () => readers,
    writers: () => (enabled.has('reply_message') ? { reply_message: replyWriter } : {}),
  };
}

export class SessionExpiredError extends Error {
  constructor() {
    super('Portal session expired mid-run');
    this.name = 'SessionExpiredError';
  }
}
