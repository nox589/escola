/**
 * Full-stack walkthrough in a real browser at phone size, against the local stack (mock GestIB).
 * Signs up, consents, links GestIB, waits for the first sync, reads the feed, opens an item,
 * replies to the school through the confirm flow, and visits every tab. Saves screenshots.
 *
 *   pnpm stack:up        # postgres + redis + mock portal + api + worker + web (see README)
 *   pnpm tsx scripts/walkthrough.ts <path-to-api-log> [outDir]
 */
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';

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
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'en-GB',
  });
  page.on('pageerror', (e) => process.stdout.write(`  page error: ${e.message}\n`));
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

async function run(page: Page) {

  step('welcome');
  await page.goto(APP);
  await page.getByText('School messages, in your language').waitFor();
  await shot(page, '01-welcome');
  await page.getByRole('button', { name: 'Continue' }).click();

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
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Not now' }).click();

  step('Today');
  await page.getByText('Needs you').first().waitFor({ timeout: 30_000 });
  await shot(page, '06-today');

  step('Today filtered by child, then the child page');
  await page.getByRole('button', { name: 'Alumne A' }).first().click();
  await page.getByText("Open Alumne A's page").waitFor();
  await shot(page, '06b-today-child');
  await page.getByText("Open Alumne A's page").click();
  await page.getByText('In short').waitFor();
  await shot(page, '06c-child-page');
  await page.getByRole('tab', { name: 'Documents' }).click();
  await page.waitForTimeout(800);
  await shot(page, '06d-child-documents');
  await page.getByRole('tab', { name: 'Grades' }).click();
  await page.getByText('No grades posted yet').waitFor();
  await page.goto(APP);
  await page.getByText('Needs you').first().waitFor({ timeout: 30_000 });

  step('item detail + original toggle');
  await page.getByText('[en] Sortida al Parc Natural').first().click();
  await page.getByText('Show original').first().waitFor();
  await shot(page, '07-item-translated');
  await page.getByText('Show original').first().click();
  await shot(page, '08-item-original');
  await page.goBack();

  step('reply to school with preview + confirm');
  await page.getByText('[en] Reunió de tutoria').first().click();
  await page.getByRole('button', { name: 'Reply to school' }).click();
  await page.getByLabel('Your message').fill('Thank you, Tuesday at 16:00 works for us.');
  await page.getByRole('button', { name: 'Prepare' }).click();
  await page.getByText('Exactly what the school receives').first().waitFor();
  await shot(page, '09-reply-preview');
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await page.getByRole('heading', { name: 'Sent ✓' }).waitFor({ timeout: 60_000 });
  await shot(page, '10-submission-sent');

  step('Week tab');
  await page.goto(APP);
  await page.getByRole('tab', { name: 'Week' }).click();
  await page.getByText('This week').first().waitFor();
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
