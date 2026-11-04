import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * KMS is split into two capabilities (SPEC §13):
 *  - KmsWrapper: Encrypt only. This is the ONLY thing the API process is ever given.
 *  - KmsUnwrapper: Decrypt. Only the sync worker is constructed with one.
 * In production these map to separate IAM roles; the API role has no kms:Decrypt.
 * Because the API's type has no unwrap method, "API cannot decrypt" is enforced at compile time too.
 */
export interface KmsWrapper {
  readonly keyId: string;
  readonly keyVersion: number;
  wrapKey(dek: Uint8Array): Promise<Uint8Array>;
}

export interface KmsUnwrapper {
  unwrapKey(wrapped: Uint8Array, keyId: string, keyVersion: number): Promise<Uint8Array>;
}

export class KmsError extends Error {}

/**
 * Local development KMS: AES-256-GCM with a 32-byte key from LOCAL_KMS_KEY (base64).
 * Never use in production; the factory refuses it when NODE_ENV=production.
 */
export class LocalDevKms implements KmsWrapper, KmsUnwrapper {
  readonly keyId = 'local-dev';
  readonly keyVersion = 1;
  readonly #key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) throw new KmsError('LOCAL_KMS_KEY must be 32 bytes, base64-encoded');
    this.#key = key;
  }

  async wrapKey(dek: Uint8Array): Promise<Uint8Array> {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.#key, iv);
    const ct = Buffer.concat([c.update(dek), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
  }

  async unwrapKey(wrapped: Uint8Array, keyId: string): Promise<Uint8Array> {
    if (keyId !== this.keyId) throw new KmsError(`Unknown key id`);
    const buf = Buffer.from(wrapped);
    const d = createDecipheriv('aes-256-gcm', this.#key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
  }
}

export interface KmsConfig {
  provider: 'aws' | 'gcp' | 'local';
  keyId?: string;
  region?: string;
  localKey?: string;
  nodeEnv?: string;
}

/** API side: returns a wrapper only. */
export function createKmsWrapper(cfg: KmsConfig): KmsWrapper {
  return createLocalOrThrow(cfg);
}

/** Worker side: returns an unwrapper. */
export function createKmsUnwrapper(cfg: KmsConfig): KmsUnwrapper {
  return createLocalOrThrow(cfg);
}

function createLocalOrThrow(cfg: KmsConfig): LocalDevKms {
  if (cfg.provider === 'local') {
    if (cfg.nodeEnv === 'production') throw new KmsError('Local KMS is not allowed in production');
    if (!cfg.localKey) throw new KmsError('LOCAL_KMS_KEY is required for the local KMS provider');
    return new LocalDevKms(cfg.localKey);
  }
  // [OPEN] SPEC §4: EU KMS vendor (AWS eu-south-2 / GCP europe-southwest1) not chosen yet.
  // Implement AwsKmsWrapper / AwsKmsUnwrapper here once decided; see docs/OPEN_QUESTIONS.md.
  throw new KmsError(`KMS provider '${cfg.provider}' not implemented yet`);
}
