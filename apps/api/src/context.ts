import type pg from 'pg';
import type { KmsWrapper } from '@escola/crypto';
import type { Embedder, LlmProvider } from '@escola/llm';
import type { BlobStore } from '@escola/storage';

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Producer side of the worker queues. */
export interface JobQueue {
  sync(job: { familyId: string; portalAccountId: string; manual?: boolean }): Promise<void>;
  submit(job: { familyId: string; submissionId: string }): Promise<void>;
}

export interface OAuthVerifier {
  /** Returns the verified email for a Sign in with Apple / Google ID token. */
  verify(provider: 'apple' | 'google', idToken: string): Promise<{ email: string; subject: string }>;
}

export interface AppDeps {
  pool: pg.Pool;
  /** Encrypt-only. The API can never decrypt credentials (SPEC §13). */
  kms: KmsWrapper;
  blobs: BlobStore;
  llm: LlmProvider;
  chatLlm: LlmProvider;
  embedder: Embedder;
  queue: JobQueue;
  mailer: Mailer;
  oauth: OAuthVerifier;
  config: {
    jwtSecret: string;
    appUrl: string;
    /** Blob signing secret for the local blob store's /v1/files route. */
    blobSecret: string;
    enabledWriters: string[];
    adminToken?: string;
    revenuecatWebhookSecret?: string;
    assistantDailyLimit: number;
  };
  now?: () => Date;
}
