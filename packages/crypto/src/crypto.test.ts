import { randomBytes } from 'node:crypto';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  createKmsWrapper,
  LocalDevKms,
  maskUsername,
  open,
  seal,
  sealCredentials,
  withCredentials,
  type KmsWrapper,
} from './index.js';

const key = randomBytes(32).toString('base64');
const kms = new LocalDevKms(key);

describe('envelope encryption', () => {
  it('round-trips credentials', async () => {
    const env = await sealCredentials(kms, { username: 'jdoe', password: 'abc12345' }, 'acc-1');
    expect(Buffer.from(env.ciphertext).toString()).not.toContain('abc12345');
    const got = await withCredentials(kms, env, 'acc-1', async (c) => c);
    expect(got).toEqual({ username: 'jdoe', password: 'abc12345' });
  });

  it('uses a fresh DEK and IV every time', async () => {
    const a = await seal(kms, Buffer.from('same'), 'x');
    const b = await seal(kms, Buffer.from('same'), 'x');
    expect(Buffer.from(a.wrappedDek).equals(Buffer.from(b.wrappedDek))).toBe(false);
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
  });

  it('fails if the envelope is moved to another account (AAD binding)', async () => {
    const env = await sealCredentials(kms, { username: 'u', password: 'p1aaaa' }, 'acc-1');
    await expect(withCredentials(kms, env, 'acc-2', async (c) => c)).rejects.toThrow();
  });

  it('fails on tampered ciphertext', async () => {
    const env = await seal(kms, Buffer.from('hello'), 'x');
    const ct = Buffer.from(env.ciphertext);
    ct[0] = ct[0]! ^ 0xff;
    await expect(open(kms, { ...env, ciphertext: ct }, 'x')).rejects.toThrow();
  });

  it('API-side wrapper type has no decrypt capability', () => {
    const w: KmsWrapper = createKmsWrapper({ provider: 'local', localKey: key });
    expectTypeOf<KmsWrapper>().not.toHaveProperty('unwrapKey');
    expect(w.keyId).toBe('local-dev');
  });

  it('refuses the local KMS in production', () => {
    expect(() => createKmsWrapper({ provider: 'local', localKey: key, nodeEnv: 'production' })).toThrow();
  });

  it('masks usernames', () => {
    expect(maskUsername('jdoe2026')).toBe('j******6');
    expect(maskUsername('ab')).toBe('**');
  });
});
