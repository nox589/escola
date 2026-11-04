import { Queue } from 'bullmq';
import { createKmsWrapper } from '@escola/crypto';
import { createPool } from '@escola/db';
import { createProviders, llmConfigFromEnv } from '@escola/llm';
import { QUEUES } from '@escola/shared';
import { createBlobStore } from '@escola/storage';
import { buildApp } from './app.js';
import { createOAuthVerifier } from './services/auth.js';
import { ConsoleMailer, PostmarkMailer } from './services/mail.js';

const env = process.env;
const required = (k: string) => {
  const v = env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};

const connection = { url: env.REDIS_URL ?? 'redis://localhost:6379' };
const syncQ = new Queue(QUEUES.sync, { connection });
const submitQ = new Queue(QUEUES.submit, { connection });
const providers = createProviders(llmConfigFromEnv());
const jwtSecret = required('JWT_SECRET');

const pool = createPool(required('DATABASE_URL'));
const app = await buildApp({
  pool,
  kms: createKmsWrapper({
    provider: (env.KMS_PROVIDER as 'local') ?? 'local',
    localKey: env.LOCAL_KMS_KEY,
    nodeEnv: env.NODE_ENV,
  }),
  blobs: createBlobStore(process.env, pool),
  llm: providers.translate,
  chatLlm: providers.chat,
  embedder: providers.embedder,
  queue: {
    sync: async (job) =>
      void (await syncQ.add('sync', job, {
        jobId: `sync-${job.portalAccountId}-m-${Math.floor(Date.now() / 60_000)}`,
        removeOnComplete: 1000,
      })),
    submit: async (job) =>
      void (await submitQ.add('submit', job, { jobId: `submit-${job.submissionId}`, attempts: 1 })),
  },
  mailer:
    env.EMAIL_PROVIDER === 'postmark'
      ? new PostmarkMailer(required('EMAIL_API_KEY'), required('EMAIL_FROM'))
      : new ConsoleMailer(),
  oauth: createOAuthVerifier({
    appleClientId: env.APPLE_CLIENT_ID,
    googleClientIds: env.GOOGLE_OAUTH_CLIENT_IDS?.split(','),
  }),
  config: {
    jwtSecret,
    appUrl: env.APP_URL ?? 'escola://',
    blobSecret: env.BLOB_SECRET || jwtSecret,
    enabledWriters: (env.ENABLED_WRITERS || (env.ALLOW_REAL_PORTAL === 'true' ? '' : 'reply_message'))
      .split(',')
      .filter(Boolean),
    adminToken: env.ADMIN_TOKEN,
    revenuecatWebhookSecret: env.REVENUECAT_WEBHOOK_SECRET,
    assistantDailyLimit: Number(env.ASSISTANT_DAILY_LIMIT ?? 50),
  },
});

await app.listen({ port: Number(env.PORT ?? 3000), host: '0.0.0.0' });
