/**
 * T1.3 trace recorder. Run on YOUR machine, by a human, with a visible browser:
 *
 *   pnpm tsx scripts/record-session.ts [--chrome /path/to/chrome]
 *
 * - Opens GestIB Famílies. YOU log in by hand; the script never sees or types your password.
 * - Browse every section you want captured (home, missatges, circulars, autoritzacions, ...),
 *   switch child via "Otros alumnos", open forms (do NOT submit anything you don't mean to).
 * - Every page load is saved as raw HTML to fixtures/gestib/raw/ (gitignored) plus a Playwright
 *   trace (gestib.trace.zip, gitignored). Close the browser window to finish.
 * - Then anonymise each raw file into fixtures/gestib/<section>/ — see docs/SELECTOR_DISCOVERY.md.
 *
 * Raw files contain real personal data. Never commit them, never paste them into a chat or an LLM.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const ENTRY = 'https://www3.caib.es/xestibback/families/home'; // KNOWN slug, SPEC §2
const OUT = new URL('../fixtures/gestib/raw/', import.meta.url);

async function main() {
  const chromeIdx = process.argv.indexOf('--chrome');
  const executablePath = chromeIdx > 0 ? process.argv[chromeIdx + 1] : undefined;
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: false, executablePath });
  const context = await browser.newContext();
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();

  let n = 0;
  const save = async () => {
    try {
      const url = new URL(page.url());
      const slug = (url.hostname + url.pathname).replace(/[^a-z0-9]+/gi, '_').slice(-80);
      const file = new URL(`${String(++n).padStart(3, '0')}_${slug}.html`, OUT);
      await writeFile(
        file,
        `<!-- captured from ${url.origin}${url.pathname} at ${new Date().toISOString()} -->\n${await page.content()}`,
      );
      process.stdout.write(`saved ${file.pathname}\n`);
    } catch {
      /* page navigated away mid-save; the next load will be captured */
    }
  };
  page.on('load', save);

  await page.goto(ENTRY);
  process.stdout.write('Log in by hand in the browser window. Close it when done.\n');
  await new Promise<void>((resolve) => {
    browser.on('disconnected', () => resolve());
    page.on('close', () => resolve());
  });
  await context.tracing.stop({ path: 'gestib.trace.zip' }).catch(() => undefined);
  await browser.close().catch(() => undefined);
}

void main();
