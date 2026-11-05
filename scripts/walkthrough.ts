/**
 * Full-stack walkthrough in a real browser at phone size, against the local stack (mock GestIB).
 * Signs up, consents, links GestIB, waits for the first sync, reads the feed, opens an item,
 * replies to the school through the confirm flow, and visits every tab. Saves screenshots.
 *
 *   pnpm stack:up        # postgres + redis + mock portal + api + worker + web (see README)
 *   pnpm tsx scripts/walkthrough.ts <path-to-api-log> [outDir]
 */
import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium, devices, type Page } from 'playwright';

const APP = process.env.WEB_URL ?? 'http://localhost:8081';
const apiLog = process.argv[2]!;
const out = process.argv[3] ?? 'walkthrough';

const step = (name: string) => process.stdout.write(`• ${name}\n`);

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
}

async function latestToken(): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const m = [...(await readFile(apiLog, 'utf8')).matchAll(/token=([\w-]{20,})/g)].at(-1);
    if (m) return m[1]!;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('no magic link in API log');
}

async function main() {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
  // IPHONE=1 emulates Safari on iPhone (checks the "Add to Home Screen" guide).
  const page = await browser.newPage(
    process.env.IPHONE ? { ...devices['iPhone 13'], locale: 'en-GB' } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-GB' },
  );
  page.on('pageerror', (e) => process.stdout.write(`  page error: ${e.message}\n`));
  page.on('console', (m) => m.type() === 'warning' && process.stdout.write(`  console: ${m.text().slice(0, 200)}\n`));
  try {
    await run(page);
  } catch (e) {
    await page.screenshot({ path: `${out}/FAILED.png` });
    throw e;
  } finally {
    await browser.close();
  }
  process.stdout.write(`screenshots in ${out}/\n`);
}

/**
 * The mock portal has no timetable/attendance pages, so the walkthrough seeds invented details
 * for the new children directly (as the DB owner) to exercise the child page. SEED_DB_URL enables it.
 */
async function seedDetails() {
  const url = process.env.SEED_DB_URL;
  if (!url) return false;
  const q = (sql: string) => execFileSync('psql', [url, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const kids = { rows: q(`SELECT id || '|' || family_id FROM children ORDER BY created_at DESC LIMIT 2`).trim().split('\n').filter(Boolean).map((l) => ({ id: l.split('|')[0]!, family_id: l.split('|')[1]! })) };
  const tt = (t1: string) => [
    { day: 1, start: '09:00', end: '10:00', subject: 'Llengua catalana', subjectTranslated: 'Catalan', subjectShort: 'CAT', room: null, teachers: [t1] },
    { day: 1, start: '10:00', end: '11:00', subject: 'Matemàtiques', subjectTranslated: 'Maths', subjectShort: 'MAT', room: null, teachers: [t1] },
    { day: 2, start: '09:00', end: '10:00', subject: 'Educació física', subjectTranslated: 'PE', subjectShort: 'EF', room: 'Gimnàs', teachers: ['Teacher Two'] },
    ...[3, 4, 5].map((day) => ({ day, start: '09:00', end: '13:30', subject: 'Matemàtiques', subjectTranslated: 'Maths', subjectShort: 'MAT', room: null, teachers: [t1] })),
  ];
  const today = new Date().toISOString().slice(0, 10);
  for (const [i, k] of kids.rows.entries()) {
    const f = lit(k.family_id);
    const id = lit(k.id);
    q(`UPDATE children SET timetable = ${lit(JSON.stringify(tt(i ? 'Teacher Three' : 'Teacher One')))}::jsonb, details_synced_at = now() WHERE id = ${id}`);
    q(`INSERT INTO absences (family_id, child_id, portal_ref, day, period, kind, status, reason, can_justify) VALUES
       (${f},${id},'F1','2026-09-15','1','Asistencia','justified','Malaltia',false),
       (${f},${id},'F2',${lit(today)},'2','Asistencia','unjustified',null,true)`);
    q(`INSERT INTO calendar_entries (family_id, child_id, title_original, title_translated, starts_at, all_day, kind, source_ref)
       VALUES (${f},${id},'1a avaluació','1st evaluation', now() + interval '20 days', true, 'evaluation', 'evaluation:1')`);
  }
  return kids.rows.length > 0;
}

async function run(page: Page) {

  step('welcome');
  await page.goto(APP);
  await page.getByText(/All of GestIB/).waitFor();
  await page.getByRole('button', { name: /Language: English/ }).click();
  await page.getByRole('button', { name: 'Español' }).click();
  await page.getByText('Todos los mensajes del cole, en español').waitFor();
  await page.getByRole('button', { name: /Español/ }).first().click();
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByText('Every school message, in English').waitFor();
  await shot(page, '01-welcome');

  step('password guide before signing in');
  await page.getByText('Need your GestIB password?').click();
  await page.getByText("What's my username?").click();
  await page.getByLabel('Your DNI or NIE').fill('1234567K');
  await page.getByText('e1234567k').waitFor();
  await page.getByText('I forgot my password').click();
  await page.getByText('Open GestIB password reset').waitFor();
  await shot(page, '01b-guide');
  await page.getByRole('button', { name: 'I have my username and password' }).click();

  step('sign in with magic link');
  await page.getByLabel('Email').fill(`anna+${Date.now()}@example.test`);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await page.getByText('Check your email').first().waitFor();
  await page.getByLabel('Or paste the link here').fill(`${APP}/auth?token=${await latestToken()}`);
  await shot(page, '02-sign-in');
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();

  step('consent');
  await page.getByRole('heading', { name: 'Before we start' }).waitFor();
  for (const s of await page.getByRole('switch').all()) await s.click();
  await shot(page, '03-consent');
  await page.getByRole('button', { name: 'I agree' }).click();

  step('link GestIB (mock portal)');
  await page.getByText('Connect GestIB').first().waitFor();
  await page.getByLabel('GestIB username').fill('parent1');
  await page.getByLabel('GestIB password').fill('escola123');
  await shot(page, '04-link-gestib');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  step('children found after first sync');
  await page.getByRole('heading', { name: 'Your children' }).waitFor();
  await page.getByText('CEIP Exemple · 3r B').waitFor({ timeout: 60_000 });
  await shot(page, '05-children');
  const seeded = await seedDetails();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Not now' }).click();

  step('Today');
  await page.getByText('Needs you', { exact: true }).first().waitFor({ timeout: 30_000 });
  if (process.env.SEED_DB_URL) await page.getByText(/needs a reason/).first().waitFor();
  if (process.env.IPHONE) {
    await page.getByText('Add clases to your Home Screen').waitFor();
    await shot(page, '06-today-iphone-setup');
    await page.getByRole('button', { name: 'Later' }).click();
    await page.getByText('Add clases to your Home Screen').waitFor({ state: 'detached' });
  }
  await shot(page, '06-today');

  step('Today: Current/Past, then a child chip opens the child page');
  await page.getByRole('tab', { name: 'Past' }).click();
  await shot(page, '06a-today-past');
  await page.getByRole('tab', { name: 'Current' }).click();
  await page.getByRole('button', { name: 'Call school' }).first().waitFor();
  await page.getByRole('button', { name: 'Alumne', exact: true }).first().click();
  await page.getByText('In short').waitFor();
  await shot(page, '06c-child-page');
  if (seeded) {
    await page.getByText(/Teacher (One|Three)/).first().waitFor();
    await page.getByText(/Next class:/).waitFor();
    await page.getByText(/2 absences this year · 1 to justify/).waitFor();
    await page.getByText('1st evaluation').filter({ visible: true }).first().waitFor();
    await shot(page, '06c2-child-profile');
    await page.getByRole('tab', { name: 'Timetable' }).click();
    await page.getByRole('button', { name: 'Mon' }).click();
    await page.getByText('Catalan').first().waitFor();
    await page.getByText('Llengua catalana').first().waitFor();
    await page.getByText(/with Teacher (One|Three)/).first().waitFor();
    await shot(page, '06e-child-timetable');
    await page.getByRole('tab', { name: /Attendance/ }).click();
    await page.getByText('Not justified').first().waitFor();
    await page.getByText('Malaltia').waitFor();
    await shot(page, '06f-child-attendance');
  }
  await page.getByRole('tab', { name: 'Documents' }).click();
  await page.waitForTimeout(800);
  await shot(page, '06d-child-documents');
  await page.getByRole('link', { name: /\.pdf/ }).first().click();
  await page.locator('canvas').first().waitFor({ timeout: 30_000 });
  await shot(page, '06g-document');
  await page.getByRole('link', { name: 'Back' }).first().click();
  await page.getByRole('tab', { name: 'Grades' }).click();
  await page.getByText('No grades posted yet').waitFor();
  await page.goto(APP);
  await page.getByText('Needs you', { exact: true }).first().waitFor({ timeout: 30_000 });

  step('item detail + original toggle');
  await page.getByText('[en] Sortida al Parc Natural').first().click();
  await page.getByText('Show original').first().waitFor();
  await shot(page, '07-item-translated');
  await page.getByText('Show original').first().click();
  await shot(page, '08-item-original');
  await page.goBack();

  step('Messages tab: chat, translate, send');
  await page.goto(APP);
  await page.getByRole('tab', { name: /Messages/ }).click();
  await page.getByText('[en] Reunió de tutoria').first().click();
  await page.getByText(/Show original/).first().waitFor();
  await page.getByPlaceholder('Write in English').fill('Thank you, Tuesday at 16:00 works for us.');
  await page.getByRole('button', { name: 'Translate' }).click();
  await page.getByText('The school will receive').waitFor();
  await page.getByText('Back-translation').waitFor();
  await shot(page, '09-chat-preview');
  await page.getByRole('button', { name: 'Send to school' }).click();
  await page.getByText(/Delivered/).waitFor({ timeout: 90_000 });
  await shot(page, '10-chat-sent');
  await page.goto(APP);
  await page.getByRole('tab', { name: /Messages/ }).click();
  await page.getByText(/DIRECCIÓ GENERAL/).first().click();
  await page.getByText(/caib\.es\/beques/).first().waitFor({ timeout: 15_000 });
  await shot(page, '10b-chat-long-sender');

  step('Week tab');
  await page.goto(APP);
  await page.getByRole('tab', { name: 'Week' }).click();
  await page.getByText('This week').first().waitFor();
  if (process.env.SEED_DB_URL) await page.getByText(/classes · 09:00 to/).first().waitFor();
  await shot(page, '11-week');
  await page.getByLabel('Next week').click();
  await page.waitForTimeout(600);
  await shot(page, '11b-week-next');

  step('Ask bar opens Ask');
  await page.goto(APP);
  await page.getByText('Ask: "When\'s the trip?"').click();
  await page.getByText('What is due this week?').click();
  await page.getByText('Sources').first().waitFor({ timeout: 15_000 });
  await shot(page, '13-ask');

  step('Settings from the header');
  await page.goto(APP);
  await page.getByLabel('Settings').filter({ visible: true }).first().click();
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  await shot(page, '14-settings');
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
