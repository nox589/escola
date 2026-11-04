import type { BrowserContext, Page } from 'playwright';
import { ParserDriftError } from '../errors.js';
import type { LoginResult, NormalisedItem, PortalAdapter, PortalChild, SectionReader } from '../types.js';
import { gestibLive as G } from './selectors.js';

/**
 * GestIB Famílies adapter built from the 2026-11-04 capture (docs/capture/*.json).
 * Read-only: it never calls the endpoints that mark items read, delete, reply or submit.
 * Login is conservative: anything other than a clear success stops (no automatic retry).
 */
export const GESTIB_LIVE_VERSION = '1.0.0';
const NAV_TIMEOUT = 30_000;

const exists = async (page: Page, sel: string) => (await page.locator(sel).count()) > 0;
const onIdp = (page: Page) => new URL(page.url()).hostname === G.urls.idpHost;
const pathOf = (page: Page) => {
  try {
    const u = new URL(page.url());
    return u.hostname + u.pathname;
  } catch {
    return 'unknown';
  }
};
const isNetworkError = (e: unknown) =>
  /timeout|net::|ECONNREFUSED|ECONNRESET|ENOTFOUND|Navigation failed/i.test(
    e instanceof Error ? e.message : String(e),
  );
const firstLine = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean) ?? '';
const htmlToText = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export function createGestibLiveAdapter(): PortalAdapter {
  async function isLoggedIn(page: Page) {
    return !onIdp(page) && (await exists(page, G.login.loggedInMarker));
  }

  async function classify(page: Page): Promise<LoginResult> {
    if (await isLoggedIn(page)) return { ok: true, page };
    if (await exists(page, G.login.captchaMarker)) return { ok: false, code: 'CAPTCHA' };
    // Wrong password, forced change, expired or timed-out login: we have not captured how GestIB
    // shows these yet, so stop and alert instead of guessing (and never retry automatically).
    return { ok: false, code: 'UNKNOWN_PAGE', ambiguous: false, detail: `landed on ${pathOf(page)}` };
  }

  async function login(ctx: BrowserContext, creds: { username: string; password: string }): Promise<LoginResult> {
    const page = await ctx.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT);
    try {
      const res = await page.goto(G.urls.home, { waitUntil: 'load' });
      if (res && res.status() >= 500) return { ok: false, code: 'PORTAL_DOWN', detail: `HTTP ${res.status()}` };
      if (await isLoggedIn(page)) return { ok: true, page };
      if (!(await exists(page, G.login.usernameInput))) {
        await page.close();
        return { ok: false, code: 'UNKNOWN_PAGE', ambiguous: false, detail: `no login form at ${pathOf(page)}` };
      }

      // Step 1: username (idp.caib.es/passwordLoginForm)
      await page.fill(G.login.usernameInput, creds.username);
      await Promise.all([page.waitForLoadState('load'), page.click(G.login.usernameSubmit)]);
      try {
        await page.waitForSelector(G.login.passwordInput, { timeout: 15_000 });
      } catch {
        const r = await classify(page);
        if (!r.ok) await page.close();
        return r;
      }

      // Step 2: password, then wait to land back in Famílies.
      await page.fill(G.login.passwordInput, creds.password);
      await Promise.all([
        page.waitForURL((u) => u.hostname !== G.urls.idpHost, { timeout: NAV_TIMEOUT }).catch(() => undefined),
        page.click(G.login.passwordSubmit),
      ]);
      await page.waitForLoadState('load').catch(() => undefined);
      const r = await classify(page);
      if (!r.ok) await page.close();
      return r;
    } catch (e) {
      await page.close().catch(() => undefined);
      if (isNetworkError(e)) return { ok: false, code: 'PORTAL_DOWN', detail: (e as Error).message.slice(0, 200) };
      throw e;
    }
  }

  async function goto(page: Page, slug: string) {
    const res = await page.goto(G.urls.families + slug, { waitUntil: 'load' });
    if (res && res.status() >= 500) throw new Error(`net:: portal returned ${res.status()}`);
    if (!(await isLoggedIn(page))) throw new SessionExpiredError();
  }

  async function selectedName(page: Page) {
    const card = page.locator(G.children.selectedCard);
    if (!(await card.count())) return '';
    // First element in the card that holds text (the name); school/class follow it.
    return card.first().evaluate((el) => {
      const leaf = Array.from(el.querySelectorAll('*')).find((e) => !e.children.length && (e as HTMLElement).innerText?.trim());
      return ((leaf as HTMLElement | undefined)?.innerText ?? '').trim();
    });
  }

  async function listChildren(page: Page): Promise<PortalChild[]> {
    await goto(page, 'home');
    const out: PortalChild[] = [];
    const seen = new Set<string>();
    const current = await selectedName(page);
    const currentRef = await page.locator(G.children.selectedRef).first().inputValue();
    for (const chip of await page.locator(G.children.chip).all()) {
      const name = firstLine(await chip.innerText());
      const ref = await chip.locator('xpath=ancestor::form[1]').locator(G.children.chipRefInput).first().inputValue();
      if (!ref || !name || seen.has(name)) continue;
      seen.add(name);
      out.push({ ref, displayName: name });
    }
    // Single-child accounts may have no switcher; the selected card is then the only child.
    if (current && !seen.has(current)) out.unshift({ ref: currentRef, displayName: current });
    if (!out.length) throw new ParserDriftError('no children found on home');
    return out;
  }

  async function switchChild(page: Page, child: PortalChild) {
    await goto(page, 'home');
    if ((await selectedName(page)) === child.displayName) return;
    let target = null;
    for (const chip of await page.locator(G.children.chip).all()) {
      const ref = await chip.locator('xpath=ancestor::form[1]').locator(G.children.chipRefInput).first().inputValue();
      if (ref === child.ref || firstLine(await chip.innerText()) === child.displayName) target = chip;
    }
    if (!target) throw new ParserDriftError('child not in switcher');
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), target.click()]);
    if ((await selectedName(page)) !== child.displayName) throw new ParserDriftError('child switch did not take effect');
  }

  // Fetched from inside the logged-in page (same cookies as the parent's browser), as base64.
  const download = (href: string) => async (p: Page) => {
    const url = new URL(href, G.urls.families).toString();
    const b64 = await p.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`attachment download failed: ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }, url);
    return Buffer.from(b64, 'base64');
  };

  const messages: SectionReader = {
    section: 'message',
    slug: G.messages.page,
    scope: 'account',
    async read(page) {
      await goto(page, G.messages.page);
      const raw = await page.evaluate(
        async ({ summaryUrl, listUrl, listParam }) => {
          const headers = { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' };
          const s = await fetch(summaryUrl, { method: 'POST', headers, body: '', credentials: 'same-origin' });
          if (!s.ok) throw new Error(`summary ${s.status}`);
          const sum = await s.json();
          const codes: number[] = (sum.llistatCodisMissatge ?? []).slice(0, 200);
          if (!codes.length) return [];
          const b = new URLSearchParams();
          codes.forEach((c) => b.append(listParam, String(c)));
          const l = await fetch(listUrl, { method: 'POST', headers, body: b.toString(), credentials: 'same-origin' });
          if (!l.ok) throw new Error(`list ${l.status}`);
          const j = await l.json();
          return Array.isArray(j) ? j : (Object.values(j).find(Array.isArray) ?? []);
        },
        G.messages,
      );
      if (!Array.isArray(raw)) throw new ParserDriftError('messages feed not a list', G.messages.page);
      return (raw as Record<string, unknown>[]).map((m) => {
        if (typeof m.codi !== 'number') throw new ParserDriftError('message without codi', G.messages.page);
        const html = String(m.texte ?? '');
        return {
          portalRef: `msg-${m.codi}`,
          section: 'message' as const,
          title: String(m.assumpte ?? ''),
          bodyHtml: html,
          bodyText: htmlToText(html),
          sender: m.remitent ? String(m.remitent) : undefined,
          postedAt: typeof m.data === 'number' ? new Date(m.data).toISOString() : undefined,
          // Attachment download flow for messages is not captured yet (carregaCodiDocumentMissatge.json).
          attachments: [],
          extra: { readInGestib: m.llegit === true, hasAttachment: m.teDocumentAdjunt === true, canReply: m.permetResposta === true },
        };
      });
    },
  };

  function htmlBoxes(section: 'circular' | 'authorisation', cfg: typeof G.circulars | typeof G.authorisations): SectionReader {
    return {
      section,
      slug: cfg.page,
      scope: section === 'authorisation' ? 'account' : 'child',
      async read(page) {
        await goto(page, cfg.page);
        const items: NormalisedItem[] = [];
        for (const box of await page.locator(cfg.item).all()) {
          const id = (await box.getAttribute('id'))?.slice(cfg.idPrefix.length);
          if (!id) throw new ParserDriftError('item without id', cfg.page);
          const title = box.locator(cfg.title);
          const body = box.locator(cfg.body);
          const html = (await body.count()) ? await body.first().innerHTML() : '';
          const status = 'status' in cfg ? box.locator(cfg.status) : null;
          const attachments: NormalisedItem['attachments'] = [];
          for (const a of await box.locator(cfg.attachment).all()) {
            const href = await a.getAttribute('href');
            if (href) attachments.push({ name: firstLine(await a.innerText()) || 'document.pdf', download: download(href) });
          }
          items.push({
            portalRef: `${section === 'circular' ? 'circ' : 'auth'}-${id}`,
            section,
            title: (await title.count()) ? firstLine(await title.first().innerText()) : '',
            bodyHtml: html,
            bodyText: htmlToText(html),
            attachments,
            extra: {
              ...(status && (await status.count()) ? { status: (await status.first().innerText()).trim() } : {}),
              ...('unreadClass' in cfg ? { readInGestib: !((await box.getAttribute('class')) ?? '').includes(cfg.unreadClass) } : {}),
            },
          });
        }
        return items;
      },
    };
  }

  const readers = [messages, htmlBoxes('circular', G.circulars), htmlBoxes('authorisation', G.authorisations)];

  return {
    id: 'gestib',
    version: GESTIB_LIVE_VERSION,
    login,
    isLoggedIn,
    async resumeSession(page) {
      const res = await page.goto(G.urls.home, { waitUntil: 'load' });
      if (res && res.status() >= 500) return false;
      return isLoggedIn(page);
    },
    listChildren,
    switchChild,
    sections: () => readers,
    writers: () => ({}), // writes stay off until the forms are captured and the parent confirms each one
  };
}

export class SessionExpiredError extends Error {
  constructor() {
    super('Portal session expired mid-run');
    this.name = 'SessionExpiredError';
  }
}
