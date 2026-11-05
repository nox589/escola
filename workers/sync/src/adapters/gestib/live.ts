import type { BrowserContext, Page } from 'playwright';
import { ParserDriftError } from '../errors.js';
import type {
  AgendaEvent,
  ChildDetails,
  LoginResult,
  NormalisedItem,
  PortalAbsence,
  PortalAdapter,
  PortalChild,
  SchoolDay,
  SectionReader,
} from '../types.js';
import type { TimetableSession } from '@escola/shared';
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
    // The switcher chips list every child (the selected one included, under a shorter label than
    // the card). Only an account with no chips at all falls back to the selected card.
    if (!out.length && current) out.push({ ref: currentRef, displayName: current });
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
      // Read per child: GestIB lists what belongs to the selected child; items shown for every child are family-wide.
      scope: 'child',
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

  const MONTHS: Record<string, number> = Object.fromEntries(
    [
      ['gener', 'enero', 'january'], ['febrer', 'febrero', 'february'], ['marc', 'marzo', 'march'],
      ['abril', 'abril', 'april'], ['maig', 'mayo', 'may'], ['juny', 'junio', 'june'],
      ['juliol', 'julio', 'july'], ['agost', 'agosto', 'august'], ['setembre', 'septiembre', 'september'],
      ['octubre', 'octubre', 'october'], ['novembre', 'noviembre', 'november'], ['desembre', 'diciembre', 'december'],
    ].flatMap((names, i) => names.map((n) => [n, i + 1])),
  );

  async function readSchoolCalendar(page: Page): Promise<SchoolDay[]> {
    const C = G.calendar;
    await goto(page, C.page);
    await page.waitForSelector(C.iframe, { timeout: 15_000 });
    let frame = page.frames().find((f) => f.url().includes(C.frameUrlPart));
    for (let i = 0; !frame && i < 20; i++) {
      await page.waitForTimeout(500);
      frame = page.frames().find((f) => f.url().includes(C.frameUrlPart));
    }
    if (!frame) throw new ParserDriftError('school calendar frame not found', C.page);
    await frame.waitForSelector(C.day, { timeout: 15_000 });
    const months = await frame.evaluate(
      ({ month, monthTitle, day, types }) =>
        Array.from(document.querySelectorAll(month)).map((m) => ({
          title: (m.querySelector(monthTitle) as HTMLElement | null)?.innerText.trim() ?? '',
          days: Array.from(m.querySelectorAll(day))
            .filter((d) => !d.classList.contains('old') && !d.classList.contains('new'))
            .map((d) => ({
              n: Number((d as HTMLElement).innerText.trim()),
              type: Object.keys(types).find((k) => d.classList.contains(k)) ?? null,
            }))
            .filter((d) => d.type && d.n > 0),
        })),
      { month: C.month, monthTitle: C.monthTitle, day: C.day, types: C.types },
    );
    const now = new Date();
    const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1; // school year starts Sep
    const out: SchoolDay[] = [];
    for (const m of months) {
      const norm = m.title.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
      const key = Object.keys(MONTHS).find((k) => norm.includes(k));
      if (!key) throw new ParserDriftError('unknown month title', C.page);
      const mon = MONTHS[key]!;
      const year = Number(/\b(20\d\d)\b/.exec(norm)?.[1] ?? (mon >= 9 ? startYear : startYear + 1));
      for (const d of m.days)
        out.push({
          date: `${year}-${String(mon).padStart(2, '0')}-${String(d.n).padStart(2, '0')}`,
          type: C.types[d.type as keyof typeof C.types] as SchoolDay['type'],
        });
    }
    return out;
  }


  /** Fetches a Famílies page's HTML from inside the logged-in page (no navigation). */
  const pageHtml = (page: Page, slug: string) =>
    page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`page ${r.status}`);
      return r.text();
    }, G.urls.families + slug);

  async function readTimetable(page: Page): Promise<TimetableSession[]> {
    const T = G.timetable;
    const html = await pageHtml(page, T.page);
    const mat = T.matriculaCall.exec(html)?.[1];
    if (!mat) return []; // no group this year: GestIB shows an empty page too
    const raw = await page.evaluate(
      async ({ url, mat }) => {
        const r = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
          body: `codiMatricula=${encodeURIComponent(mat)}&idioma=es`,
        });
        if (!r.ok) throw new Error(`timetable ${r.status}`);
        return r.json();
      },
      { url: T.feedUrl, mat },
    );
    if (!Array.isArray(raw)) throw new ParserDriftError('timetable feed not a list', T.page);
    const sessions = (raw[0]?.sessions ?? []) as Record<string, unknown>[];
    const hhmm = (v: unknown) => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? v.padStart(5, '0') : null);
    const out: TimetableSession[] = [];
    for (const x of sessions) {
      if (x.mostrar === 'false' || x.mostrar === false) continue;
      const day = Number(x.codiDia);
      const start = hhmm(x.horaSenceraInici);
      const end = hhmm(x.horaSenceraFi);
      if (!day || !start || !end) throw new ParserDriftError('timetable session shape', T.page);
      const teachers = [
        ...new Set(
          ((x.professors ?? []) as Record<string, unknown>[])
            .filter((p) => p.actiu !== 'false' && p.actiu !== false && p.mostrar !== 'false' && p.mostrar !== false)
            .map((p) => String(p.professor ?? '').trim())
            .filter(Boolean),
        ),
      ];
      const long = String(x.materiaLlarg ?? '').trim();
      const short = String(x.materia ?? '').trim();
      out.push({
        day,
        start,
        end,
        subject: long || short,
        subjectShort: short && short !== long ? short : null,
        room: String(x.nomAula ?? '').trim() || null,
        teachers,
      });
    }
    return out.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  }

  async function readAbsences(page: Page): Promise<PortalAbsence[]> {
    const A = G.attendance;
    const html = await pageHtml(page, A.page);
    const call = A.paramsCall.exec(html)?.[1];
    if (!call) return [];
    const args = call.split(',').map((v) => v.trim().replace(/^["']|["']$/g, ''));
    if (args.length < 8 || args.slice(0, 8).some((a) => !a)) throw new ParserDriftError('attendance params shape', A.page);
    const [codiMatricula, any, , codiCentre, codiAlumne, , codiArbre, anyArbre] = args as [string, string, string, string, string, string, string, string];
    const custody = !/teCustodia:\s*eval\(false\)/.test(html);
    const minor = /esUsuariWebAlumnesMenorEdat:\s*eval\(true\)/.test(html);

    // Months as GestIB lists them: Sep..Dec of `any`, then Jan..Jun of `any`+1, up to today.
    const y = Number(any);
    const today = new Date();
    const months = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6]
      .map((m) => ({ mes: m, year: m >= 9 ? y : y + 1 }))
      .filter((m) => new Date(m.year, m.mes - 1, 1) <= today);

    const rows = await page.evaluate(
      async ({ url, months, p }) => {
        const out: { permet: string; faltes: Record<string, string>[] }[] = [];
        for (const m of months) {
          const q =
            `codiArbre=${p.codiArbre}&anyArbre=${p.anyArbre}&idioma=es&codiMatricula=${p.codiMatricula}` +
            `&mes=${m.mes}&alumne=${p.codiAlumne}&periode=${encodeURIComponent(p.periode)}&codiCentre=${p.codiCentre}&any=${m.year}`;
          const r = await fetch(`${url}?${q}`, { credentials: 'same-origin' });
          if (!r.ok) throw new Error(`attendance ${r.status}`);
          const doc = new DOMParser().parseFromString(await r.text(), 'text/xml');
          if (doc.documentElement.nodeName.toLowerCase() === 'html') throw new Error('attendance returned html');
          out.push({
            permet: doc.querySelector('permetJustificacio')?.textContent ?? '',
            faltes: Array.from(doc.querySelectorAll('falta')).map((f) => {
              const o: Record<string, string> = {};
              for (const a of Array.from(f.attributes)) o[a.name] = a.value;
              o.motiuAbsencia = f.querySelector('motiuAbsencia')?.textContent ?? '';
              return o;
            }),
          });
        }
        return out;
      },
      { url: A.feedUrl, months, p: { codiMatricula, codiCentre, codiAlumne, codiArbre, anyArbre, periode: A.fixedPeriode } },
    );

    const out: PortalAbsence[] = [];
    for (const month of rows)
      for (const f of month.faltes) {
        const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(f.data ?? '');
        if (!f.codiFalta || !m) throw new ParserDriftError('absence shape', A.page);
        const day = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
        const requested = !!f.dataSolicitud;
        const status: PortalAbsence['status'] =
          f.justificada === 'true' ? 'justified' : f.descartada !== 'true' && requested ? 'pending' : 'unjustified';
        const ageDays = Math.round(Math.abs(today.getTime() - new Date(`${day}T12:00:00`).getTime()) / 86_400_000);
        out.push({
          ref: f.codiFalta,
          day,
          period: f.hora || null,
          subject: f.materia || null,
          kind: f.tipus || 'Asistencia',
          status,
          reason: (f.motiuAbsencia ?? '').trim() || null,
          schoolNote: (f.observacionsCentre ?? '').trim() || null,
          canJustify:
            status === 'unjustified' && month.permet === 'true' && custody && !minor && ageDays < A.justifyWindowDays,
        });
      }
    return out.sort((a, b) => b.day.localeCompare(a.day));
  }

  async function readAgenda(page: Page): Promise<AgendaEvent[]> {
    const E = G.agenda;
    const found = await page.evaluate(
      async ({ pageUrl, form, body, blocks }) => {
        const r = await fetch(pageUrl, { credentials: 'same-origin' });
        if (!r.ok) throw new Error(`activities ${r.status}`);
        const d = new DOMParser().parseFromString(await r.text(), 'text/html');
        const f = d.querySelector(form);
        if (!f) return null;
        const action = new URL(f.getAttribute('action') ?? '', pageUrl).toString();
        const a = await fetch(action, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
          body: `idioma=es&${body}`,
        });
        if (!a.ok) throw new Error(`agenda ${a.status}`);
        const ad = new DOMParser().parseFromString(await a.text(), 'text/html');
        const out: { block: string; events: Record<string, unknown>[] }[] = [];
        for (const id of Object.keys(blocks)) {
          const el = ad.getElementById(id);
          if (!el) continue;
          const v = JSON.parse(el.textContent || '[]');
          const arr = Array.isArray(v) ? v : [v];
          out.push({ block: id, events: arr.flatMap((x: { events?: Record<string, unknown>[] }) => x.events ?? []) });
        }
        return out;
      },
      { pageUrl: G.urls.families + E.page, form: E.form, body: E.formBody, blocks: E.blocks },
    );
    if (!found) return [];
    const out: AgendaEvent[] = [];
    for (const b of found) {
      const kind = E.blocks[b.block as keyof typeof E.blocks];
      for (const e of b.events) {
        const start = typeof e.start === 'string' ? e.start : null;
        if (!start || !e.title) continue;
        out.push({
          ref: `${kind}:${String(e.id ?? start)}`,
          kind,
          title: String(e.title).trim(),
          start,
          end: typeof e.end === 'string' ? e.end : null,
          allDay: e.allDay !== false,
          place: typeof e.lloc === 'string' && e.lloc.trim() ? e.lloc.trim() : null,
        });
      }
    }
    return out;
  }

  /** The selected child's card: name first, then school and class (03-home.json). */
  async function readProfile(page: Page) {
    await goto(page, 'home');
    const leaves = await page.locator(G.children.selectedCard).first().evaluate((el) =>
      Array.from(el.querySelectorAll('*'))
        .filter((e) => !e.children.length)
        .map((e) => ((e as HTMLElement).innerText ?? '').trim())
        .filter(Boolean),
    );
    return parseCardLines(leaves.slice(1));
  }

  /** Reads each part independently so one failing page never wipes the others. */
  async function readChildDetails(page: Page): Promise<ChildDetails> {
    const errors: ChildDetails['errors'] = [];
    const attempt = async <T,>(section: string, fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof SessionExpiredError) throw e;
        errors.push({ section, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
        return null;
      }
    };
    return {
      profile: await attempt('home', () => readProfile(page)),
      timetable: await attempt(G.timetable.page, () => readTimetable(page)),
      absences: await attempt(G.attendance.page, () => readAbsences(page)),
      agenda: await attempt(G.agenda.page, () => readAgenda(page)),
      errors,
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
    readSchoolCalendar,
    readChildDetails,
    writers: () => ({}), // writes stay off until the forms are captured and the parent confirms each one
  };
}

export class SessionExpiredError extends Error {
  constructor() {
    super('Portal session expired mid-run');
    this.name = 'SessionExpiredError';
  }
}

const SCHOOL_RE = /\b(CEIP|CEI|CEIPIESO|EI|EIEL|IES|CC|CP|CPI|CEPA|CIFP|EOI|Col·legi|Col\.legi|Colegio|Escola|Escuela|Institut|Instituto)\b/i;
const CLASS_RE = /(\d+\s*[ºªrnt]|\b\d+\s*(?:de|d')|\bcurs\b|\bcurso\b|Educaci|ESO|Batx|Bach|Prim|Infantil|\bP[345]\b|\bgrup\b|\bgrupo\b)/i;

/** School and class from the card lines after the name; regex first, then position. */
export function parseCardLines(lines: string[]): { schoolName: string | null; classLabel: string | null } {
  const rest = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l && l.length < 120);
  const schoolName = rest.find((l) => SCHOOL_RE.test(l)) ?? null;
  const classLabel = rest.find((l) => l !== schoolName && CLASS_RE.test(l)) ?? null;
  return { schoolName, classLabel };
}
