import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalBlobStore, verifyLocalSignature } from './index.js';

describe('LocalBlobStore', () => {
  it('stores, signs and refuses path traversal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'blobs-'));
    const s = new LocalBlobStore(dir, 'http://api', 'secret');
    await s.put('fam/a.pdf', Buffer.from('hi'), 'application/pdf');
    expect((await s.get('fam/a.pdf')).toString()).toBe('hi');
    await expect(s.put('../x', Buffer.from(''), 'x')).rejects.toThrow();

    const url = new URL(await s.signedUrl('fam/a.pdf', 300));
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig')!;
    expect(verifyLocalSignature('secret', 'fam/a.pdf', exp, sig)).toBe(true);
    expect(verifyLocalSignature('secret', 'fam/b.pdf', exp, sig)).toBe(false);
    expect(verifyLocalSignature('secret', 'fam/a.pdf', exp, sig, (exp + 1) * 1000)).toBe(false);
  });
});
