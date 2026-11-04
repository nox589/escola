import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Object storage for attachments, receipts and snapshots (SPEC §3, §13).
 * Production: S3-compatible bucket in an EU region with SSE-KMS per object.
 * Development/tests: local directory with HMAC-signed URLs served by the API.
 */
export interface BlobStore {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Short-lived URL (default 5 min, SPEC §7). */
  signedUrl(key: string, ttlSeconds?: number): Promise<string>;
}

const SAFE_KEY = /^[a-zA-Z0-9/_.=-]+$/;
function checkKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error('invalid blob key');
}

export class LocalBlobStore implements BlobStore {
  constructor(
    private readonly root: string,
    private readonly publicBase: string,
    private readonly secret: string,
  ) {}

  #path(key: string) {
    checkKey(key);
    const p = resolve(join(this.root, key));
    if (!p.startsWith(resolve(this.root))) throw new Error('invalid blob key');
    return p;
  }
  async put(key: string, data: Buffer, _mime?: string) {
    const p = this.#path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async get(key: string) {
    return readFile(this.#path(key));
  }
  async delete(key: string) {
    await rm(this.#path(key), { force: true });
  }
  async signedUrl(key: string, ttlSeconds = 300) {
    checkKey(key);
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `${this.publicBase}/v1/files/${key}?exp=${exp}&sig=${signLocal(this.secret, key, exp)}`;
  }
}

export function signLocal(secret: string, key: string, exp: number) {
  return createHmac('sha256', secret).update(`${key}:${exp}`).digest('hex');
}

export function verifyLocalSignature(
  secret: string,
  key: string,
  exp: number,
  sig: string,
  now = Date.now(),
) {
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const expected = Buffer.from(signLocal(secret, key, exp));
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export class S3BlobStore implements BlobStore {
  readonly #s3: S3Client;
  constructor(
    private readonly bucket: string,
    opts: { region: string; endpoint?: string; kmsKeyId?: string },
  ) {
    this.#s3 = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: !!opts.endpoint,
    });
    this.kmsKeyId = opts.kmsKeyId;
  }
  private readonly kmsKeyId?: string;

  async put(key: string, data: Buffer, mime: string) {
    checkKey(key);
    await this.#s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: mime,
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: this.kmsKeyId,
      }),
    );
  }
  async get(key: string) {
    const r = await this.#s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async delete(key: string) {
    await this.#s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async signedUrl(key: string, ttlSeconds = 300) {
    return getSignedUrl(this.#s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }
}

export function createBlobStore(env: NodeJS.ProcessEnv = process.env): BlobStore {
  if (env.S3_BUCKET) {
    return new S3BlobStore(env.S3_BUCKET, {
      region: env.S3_REGION ?? 'eu-south-2',
      endpoint: env.S3_ENDPOINT || undefined,
      kmsKeyId: env.S3_KMS_KEY_ID || undefined,
    });
  }
  if (env.NODE_ENV === 'production') throw new Error('S3_BUCKET is required in production');
  return new LocalBlobStore(
    env.LOCAL_BLOB_DIR ?? '.data/blobs',
    env.PUBLIC_API_URL ?? 'http://localhost:3000',
    env.JWT_SECRET ?? 'dev-only-secret',
  );
}
