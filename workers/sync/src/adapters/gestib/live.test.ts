import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Route } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGestibLiveAdapter } from './live.js';
import { parseCardLines } from './live.js';

/**
 * Synthetic pages shaped like the 2026-11-04 capture (docs/capture). All data is invented.
 * Requests are intercepted with page routing, so nothing reaches the real GestIB.
 */
const W = 'https://www3.caib.es/xestibback/families/';

function fakePortal(opts: { password: string; captcha?: boolean }) {
  let loggedIn = false;
  let selected = 'A';
  const calls: string[] = [];
  const kids = { A: 'Ana Test', B: 'Biel Test' } as Record<string, string>;
  const shell = (body: string) =>
    `<html><body><nav class="navbar"><span id="numMissatgeMenu">1</span></nav>
     <input type="hidden" id="codiFillSeleccionat" value="SEL${selected}">
     <dd><div class="alumno-seleccionado-card"><img class="img-circle"><span>${kids[selected]}</span><small>CEIP Fake</small></div></dd>
     ${Object.entries(kids)
       .map(([k, n]) => `<form method="post"><input type="hidden" name="idFill" value="ID${k}"><button type="button" class="alumno-chip" onclick="this.closest('form').submit()"><span>${n}</span></button></form>`)
       .join('')}
     <div class="content-wrapper">${body}</div></body></html>`;

  async function handle(route: Route) {
    const req = route.request();
    const url = new URL(req.url());
    calls.push(`${req.method()} ${url.hostname}${url.pathname}`);
    const html = (b: string) => route.fulfill({ contentType: 'text/html', body: b });
    const idpForm = () =>
      html(`<form id="form-pass" method="post" action="/userNameAction"><input id="j_username" name="j_username"><input type="submit" id="loginpassbutton" name="formUCboton"></form>`);
    {
      if (url.pathname === '/userNameAction')
        return html(`<form class="captcha-form" method="post" action="/passwordLoginAction"><input type="password" id="j_password" name="j_password"><input type="hidden" name="captchaToken" class="captcha-token"><input type="submit" id="loginpassbutton" name="formUCboton"></form>${opts.captcha ? '<div class="g-recaptcha"></div>' : ''}`);
      if (url.pathname === '/passwordLoginAction') {
        const pw = new URLSearchParams(req.postData() ?? '').get('j_password');
        if (pw === opts.password && !opts.captcha) {
          loggedIn = true;
          return html(shell(''));
        }
        return html(`<p>Error</p><form method="post" action="/passwordLoginAction"><input type="password" id="j_password"><input type="submit" id="loginpassbutton"></form>`);
      }
    }
    if (url.href === 'https://www3.caib.es/xestibback/calendari/agenda/X')
      return html(`<script id="data-eventsCapDeSetmana" type="application/json">[{"events":[{"start":"2026-11-07T00:00:00+0100","id":"1","title":"Cap de setmana"}]}]</script>
        <script id="data-eventAvaluacio" type="application/json">[{"events":[{"start":"2026-12-18T00:00:00+0100","id":"77","title":"1a avaluació","allDay":true,"lloc":""}],"id":"a","className":"c"}]</script>
        <script id="data-eventReunioPares" type="application/json">[{"events":[],"id":"r","className":"c"}]</script>`);
    if (url.href.startsWith(W)) {
      if (!loggedIn) return idpForm(); // real portal redirects to idp.caib.es/passwordLoginForm
      const slug = url.pathname.slice('/xestibback/families/'.length);
      if (req.method() === 'POST' && slug === 'home') {
        const id = new URLSearchParams(req.postData() ?? '').get('idFill');
        if (id) selected = id.slice(2);
        return html(shell(''));
      }
      if (slug === 'missatges/resumMissatgesXUsuari.json')
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ llistatCodisMissatge: [11, 12], totalMissatges: 2, totalMissatgesNoLlegits: 1 }) });
      if (slug === 'missatges/llistaMissatgesXCodi.json') {
        expect(req.postData()).toBe('codisMissatges=11&codisMissatges=12');
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify([
            { codi: 11, assumpte: 'Sortida', texte: '<p>Hola <b>famílies</b></p><p>Divendres</p>', remitent: 'Tutora', data: Date.UTC(2026, 9, 1), llegit: false, teDocumentAdjunt: false, permetResposta: true },
            { codi: 12, assumpte: 'Menjador', texte: 'Text', remitent: 'Secretaria', data: Date.UTC(2026, 9, 2), llegit: true, teDocumentAdjunt: true, permetResposta: false },
          ]),
        });
      }
      if (slug === 'circulars')
        return html(shell(`<div id="circular_C1" class="box box-primary circularNoVista"><div class="box-body"><h4 class="box-title"><a><span class="text">Circular ${selected}</span></a></h4></div><div id="collapse_C1" class="panel-collapse collapse"><div class="text-enriquit"><p>Body</p></div><div class="margin-left"><ul><li><a href="circulars/veureDocumentAdjunt.do?codiDocument=9">doc.pdf</a></li></ul></div></div></div>`));
      if (slug === 'circulars/veureDocumentAdjunt.do') return route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4' });
      if (slug === 'autoritzacions')
        return html(shell(`<div id="autoritzacio_Z9" class="box box-primary"><div class="box-body"><h4 class="box-title"><a href="#collapse_Z9"><span class="text-green">01/10/2026 - Trip</span></a></h4></div><div id="collapse_Z9" class="panel-collapse collapse"><span><b>AUTORITZADA</b></span><div class="text-enriquit">Details</div></div></div>`));
      if (slug === 'calendariEscolar')
        return html(shell(`<div class="box box-primary"><form id="formCalendariEscolar_X" method="post" action="calendari/calendariCentre" target="ifr"></form><div class="calendari-iframe-box"><iframe name="ifr" class="calendari-iframe" src="calendari/calendariCentre"></iframe></div></div>`));
      if (slug === 'calendari/calendariCentre')
        return html(`<div class="month-container"><table><thead><tr><th class="month-title">Desembre</th></tr></thead><tbody><tr><td class="day old">30</td><td class="day">1</td><td class="day festiu">8</td><td class="day vacances">23</td></tr></tbody></table></div><div class="month-container"><table><thead><tr><th class="month-title">Gener</th></tr></thead><tbody><tr><td class="day vacances">2</td><td class="day new vacances">3</td><td class="day noLectiu">7</td></tr></tbody></table></div>`);
      if (slug === 'horari')
        return html(shell(`<div id="horari-container-MAT${selected}"></div><script>mostraHorariAlumne('MAT${selected}', 'CEN', 'GR', '2026');</script>`));
      if (slug === 'llistes/alumnat/quadrantHorariAlumnes.json') {
        expect(new URLSearchParams(req.postData() ?? '').get('codiMatricula')).toBe(`MAT${selected}`);
        const prof = (n: string) => ({ professor: n, actiu: 'true', mostrar: 'true', refors: 'false' });
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify([{ codiPersona: 'P', nomAlumne: 'x', sessions: [
            { codiDia: '2', horaSenceraInici: '9:00', horaSenceraFi: '10:00', materia: 'MAT', materiaLlarg: 'Matemàtiques', nomAula: '', mostrar: 'true', professors: [prof('Teacher One')] },
            { codiDia: '1', horaSenceraInici: '09:00', horaSenceraFi: '10:30', materia: 'CAT', materiaLlarg: 'Llengua catalana', nomAula: 'A1', mostrar: 'true', professors: [prof('Teacher One'), { ...prof('Old Teacher'), actiu: 'false' }] },
            { codiDia: '1', horaSenceraInici: '11:00', horaSenceraFi: '12:00', materia: 'EF', materiaLlarg: 'Educació física', nomAula: '', mostrar: 'true', professors: [prof('Teacher Two')] },
          ] }]),
        });
      }
      if (slug === 'assistencia')
        return html(shell(`<script>initAssistencia({ avui: "x", teCustodia: eval(true), esUsuariWebAlumnesMenorEdat: eval(false) });</script><script>pintaBotons("MAT${selected}", "2026", "MAT${selected}", "CEN", "ALU", "2026", "52", "2026", "14");</script>`));
      if (slug === 'alumne/llistaFaltesMatriculaAlumne.xml') {
        const q = url.searchParams;
        expect(q.get('periode')).toBe('12 Desembre 2016');
        const mes = q.get('mes');
        const y = q.get('any');
        const xml = (f: string) => route.fulfill({ contentType: 'text/xml', body: `<?xml version="1.0"?><xml><permetJustificacio>true</permetJustificacio>${f}</xml>` });
        if (mes === '9') return xml(`<falta codiFalta="F1" data="15/09/${y}" materia="" hora="1" tipus="Asistencia" justificada="true" observacionsCentre="" dataSolicitud="" descartada=""><motiuAbsencia>Malaltia</motiuAbsencia></falta>`);
        const now = new Date();
        if (Number(mes) === now.getMonth() + 1)
          return xml(`<falta codiFalta="F2" data="${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}" materia="MAT" hora="2" tipus="Asistencia" justificada="false" observacionsCentre="" dataSolicitud="" descartada=""><motiuAbsencia></motiuAbsencia></falta>`);
        return xml('');
      }
      if (slug === 'activitats')
        return html(shell(`<form id="formHorari_X" method="post" action="../calendari/agenda/X" target="i"><input name="idioma" value="es"></form>`));
      if (slug === 'home' || slug === 'missatges') return html(shell(''));
      return route.fulfill({ status: 404, body: '' });
    }
    return route.abort();
  }
  return { handle, calls };
}

const CHROME = process.env.CHROME_PATH ?? ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
// --no-proxy-server: everything is intercepted; never let a request reach a proxy or the network.
const launch = () => chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--no-proxy-server'] });
const hasBrowser = await launch()
  .then((b) => (b.close(), true))
  .catch(() => false);
const d = hasBrowser ? describe : describe.skip;

d('GestIB live adapter (synthetic capture-shaped pages)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launch();
  });
  afterAll(async () => browser?.close());

  async function ctxFor(p: ReturnType<typeof fakePortal>): Promise<BrowserContext> {
    const ctx = await browser.newContext();
    await ctx.route('**/*', (r) => p.handle(r));
    return ctx;
  }

  it('logs in through the two-step idp and reads children, messages, circulars, authorisations', async () => {
    const p = fakePortal({ password: 'secret1' });
    const a = createGestibLiveAdapter();
    const res = await a.login(await ctxFor(p), { username: 'parent', password: 'secret1' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const page = res.page;

    const kids = await a.listChildren(page);
    expect(kids.map((k) => k.displayName)).toEqual(['Ana Test', 'Biel Test']);

    await a.switchChild(page, kids[1]!);
    const [msgs, circs, auths] = a.sections();
    expect(msgs!.scope).toBe('account');
    const m = await msgs!.read(page);
    expect(m.map((x) => x.portalRef)).toEqual(['msg-11', 'msg-12']);
    expect(m[0]!.bodyText).toBe('Hola famílies\nDivendres');
    expect(m[0]!.postedAt).toBe('2026-10-01T00:00:00.000Z');

    const c = await circs!.read(page);
    expect(c[0]).toMatchObject({ portalRef: 'circ-C1', title: 'Circular B', bodyText: 'Body' });
    expect((await c[0]!.attachments[0]!.download(page)).toString()).toBe('%PDF-1.4');

    const z = await auths!.read(page);
    expect(z[0]).toMatchObject({ portalRef: 'auth-Z9', extra: { status: 'AUTORITZADA' } });

    const cal = await a.readSchoolCalendar!(page);
    const y = new Date().getMonth() >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    expect(cal).toEqual([
      { date: `${y}-12-08`, type: 'public_holiday' },
      { date: `${y}-12-23`, type: 'holiday' },
      { date: `${y + 1}-01-02`, type: 'holiday' },
      { date: `${y + 1}-01-07`, type: 'non_teaching' },
    ]);

    const det = await a.readChildDetails!(page, kids[1]!);
    expect(det.errors).toEqual([]);
    expect(det.profile).toEqual({ schoolName: 'CEIP Fake', classLabel: null });
    expect(det.timetable).toEqual([
      { day: 1, start: '09:00', end: '10:30', subject: 'Llengua catalana', subjectShort: 'CAT', room: 'A1', teachers: ['Teacher One'] },
      { day: 1, start: '11:00', end: '12:00', subject: 'Educació física', subjectShort: 'EF', room: null, teachers: ['Teacher Two'] },
      { day: 2, start: '09:00', end: '10:00', subject: 'Matemàtiques', subjectShort: 'MAT', room: null, teachers: ['Teacher One'] },
    ]);
    expect(det.absences![0]).toMatchObject({ ref: 'F2', status: 'unjustified', canJustify: true, subject: 'MAT', period: '2' });
    expect(det.absences!.find((x) => x.ref === 'F1')).toMatchObject({ status: 'justified', reason: 'Malaltia', canJustify: false });
    expect(det.agenda).toEqual([
      { ref: 'evaluation:77', kind: 'evaluation', title: '1a avaluació', start: '2026-12-18T00:00:00+0100', end: null, allDay: true, place: null },
    ]);

    // Read-only: no mark-as-read, delete, reply or submit endpoints were ever called.
    expect(p.calls.filter((x) => /Llegit|Vista|Esborra|envia|marca/i.test(x))).toEqual([]);
  });

  it('stops without retrying on a wrong password or a CAPTCHA', async () => {
    const a = createGestibLiveAdapter();
    const wrong = fakePortal({ password: 'right1' });
    const r1 = await a.login(await ctxFor(wrong), { username: 'parent', password: 'wrong1' });
    expect(r1).toMatchObject({ ok: false, code: 'UNKNOWN_PAGE', ambiguous: false });
    expect(wrong.calls.filter((c) => c.includes('passwordLoginAction'))).toHaveLength(1);

    const cap = fakePortal({ password: 'right1', captcha: true });
    const r2 = await a.login(await ctxFor(cap), { username: 'parent', password: 'right1' });
    expect(r2).toMatchObject({ ok: false });
  });
});

describe('child card lines', () => {
  it('finds school and class whatever the order', () => {
    expect(parseCardLines(['CEIP Exemple', '3r B'])).toEqual({ schoolName: 'CEIP Exemple', classLabel: '3r B' });
    expect(parseCardLines(['2n de Primària A', 'Escola Graduada'])).toEqual({ schoolName: 'Escola Graduada', classLabel: '2n de Primària A' });
    expect(parseCardLines(['something else'])).toEqual({ schoolName: null, classLabel: null });
  });
});
