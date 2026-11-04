/**
 * Worker process: BullMQ consumers for sync / enrich / notify / submit plus the scheduler tick.
 *   pnpm --filter @escola/sync-worker dev
 */
import { createServer } from 'node:http';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { chromium, type Browser } from 'playwright';
import { LocalDevKms } from '@escola/crypto';
import { createPool } from '@escola/db';
import { createProviders, llmConfigFromEnv } from '@escola/llm';
import { createBlobStore } from '@escola/storage';
import { createGestibAdapter } from './adapters/gestib/adapter.js';
import { createGestibLiveAdapter } from './adapters/gestib/live.js';
import { mockSelectors } from './adapters/gestib/selectors.mock.js';
import { log } from './core/logger.js';
import { ExpoPushSender } from './notify/push.js';
import {
  processEnrich,
  processNotify,
  processSync,
  processTick,
  type Deps,
  type EnrichJob,
  type NotifyJob,
  type SubmitJob,
  type SyncJob,
} from './pipeline/processors.js';
import { QUEUES } from './pipeline/queues.js';
import { processSubmit } from './submit/job.js';

const env = process.env;
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (env.KMS_PROVIDER && env.KMS_PROVIDER !== 'local')
  throw new Error('Only KMS_PROVIDER=local is implemented (see OPEN_QUESTIONS)');
if (!env.LOCAL_KMS_KEY) throw new Error('LOCAL_KMS_KEY is required');
if (env.NODE_ENV === 'production')
  throw new Error('Configure a cloud KMS before production (beta runs with NODE_ENV=beta)');

const connection: ConnectionOptions = { url: env.REDIS_URL ?? 'redis://localhost:6379' };
const queues = Object.fromEntries(
  Object.values(QUEUES).map((q) => [q, new Queue(q, { connection })]),
) as Record<(typeof QUEUES)[keyof typeof QUEUES], Queue>;

let browser: Browser | null = null;
const getBrowser = async () => {
  if (!browser || !browser.isConnected())
    browser = await chromium.launch({ executablePath: env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  return browser;
};

// Real GestIB only when explicitly allowed; otherwise the local mock portal.
const useMock = env.ALLOW_REAL_PORTAL !== 'true';
const adapter = useMock
  ? createGestibAdapter({
      selectors: mockSelectors(env.GESTIB_MOCK_URL ?? 'http://localhost:4010'),
      enabledWriters: (env.ENABLED_WRITERS || 'reply_message').split(',').filter(Boolean) as never[],
    })
  : createGestibLiveAdapter(); // read-only; no writers

const providers = createProviders(llmConfigFromEnv());
const opts = { removeOnComplete: 1000, removeOnFail: 5000 };
const pool = createPool(env.DATABASE_URL);
const deps: Deps = {
  pool,
  browser: getBrowser,
  kms: new LocalDevKms(env.LOCAL_KMS_KEY),
  llm: providers.translate,
  embedder: providers.embedder,
  blobs: createBlobStore(env, pool),
  sender: new ExpoPushSender(env.EXPO_ACCESS_TOKEN),
  adapterFor: () => adapter,
  enqueue: {
    sync: async (job, delay) =>
      void (await queues.sync.add('sync', job, {
        ...opts,
        delay,
        jobId: `sync-${job.portalAccountId}-${job.attempt ?? 0}-${Math.floor(Date.now() / 600_000)}`,
      })),
    enrich: async (job) =>
      void (await queues.enrich.add('enrich', job, {
        ...opts,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      })),
    notify: async (job, delay) => void (await queues.notify.add('notify', job, { ...opts, delay })),
    // Never retried by the queue: writes are non-idempotent.
    submit: async (job) =>
      void (await queues.submit.add('submit', job, {
        ...opts,
        attempts: 1,
        jobId: `submit-${job.submissionId}`,
      })),
  },
};

const concurrency = Number(env.SYNC_CONCURRENCY ?? 2);
const loginsPerMin = Number(env.SYNC_LOGIN_RATE_PER_MIN ?? 2);

new Worker<SyncJob>(QUEUES.sync, (j) => processSync(deps, j.data), {
  connection,
  concurrency,
  limiter: { max: loginsPerMin, duration: 60_000 },
});
new Worker<EnrichJob>(QUEUES.enrich, (j) => processEnrich(deps, j.data), { connection, concurrency: 4 });
new Worker<NotifyJob>(QUEUES.notify, (j) => processNotify(deps, j.data), { connection, concurrency: 4 });
new Worker<SubmitJob>(QUEUES.submit, (j) => processSubmit(deps, j.data), { connection, concurrency: 1 });
new Worker(QUEUES.tick, () => processTick(deps), { connection });

await queues.tick.upsertJobScheduler('tick-every-5-min', { every: 5 * 60_000 }, { name: 'tick' });
log.info({ mock: useMock, llm: providers.translate.name }, 'worker started');

// Hosts that only run "web services" (e.g. Render via its API) need an open port and a health check.
if (env.PORT) {
  createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'application/json' });
    res.end(req.url === '/health' ? '{"ok":true}' : '{}');
  }).listen(Number(env.PORT), '0.0.0.0');
}

const shutdown = async () => {
  await browser?.close().catch(() => undefined);
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
