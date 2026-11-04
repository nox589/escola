/**
 * `pnpm --filter @escola/sync-worker canary` — manual, READ-ONLY run against the founder's real account.
 * Never in CI. Requires ALLOW_REAL_PORTAL=true, CANARY_USERNAME, CANARY_PASSWORD, and real
 * selectors in selectors.ts (it throws SelectorNotDiscoveredError until T1.4 is done).
 * No writers are enabled. Prints counts only, never content.
 */
import { chromium } from 'playwright';
import { createGestibAdapter } from './adapters/gestib/adapter.js';
import { MemoryLockoutStore } from './core/lockoutGuard.js';
import { log } from './core/logger.js';
import { MemoryItemStore, runSync } from './core/sync.js';

if (process.env.ALLOW_REAL_PORTAL !== 'true' || process.env.CI) {
  log.error({}, 'Refusing: set ALLOW_REAL_PORTAL=true (and never run in CI)');
  process.exit(1);
}
const username = process.env.CANARY_USERNAME;
const password = process.env.CANARY_PASSWORD;
if (!username || !password) {
  log.error({}, 'CANARY_USERNAME and CANARY_PASSWORD are required');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const lockout = new MemoryLockoutStore();
lockout.accounts.set('canary', {
  id: 'canary',
  status: 'active',
  consecutiveAuthFailures: 0,
  credentialVersion: 1,
});
try {
  const report = await runSync({
    adapter: createGestibAdapter({ enabledWriters: [] }),
    browser,
    accountId: 'canary',
    lockout,
    items: new MemoryItemStore(),
    withCredentials: (fn) => fn({ username, password }),
  });
  log.info(
    {
      ok: report.ok,
      decision: report.decision?.action,
      children: report.children.length,
      counts: report.counts,
      errors: report.errors.map((e) => e.section),
    },
    'canary finished',
  );
} finally {
  await browser.close();
}
