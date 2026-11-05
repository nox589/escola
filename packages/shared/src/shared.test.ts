import { describe, expect, it } from 'vitest';
import { gestibPasswordSchema, redact, REDACTED, itemView } from './index.js';
import { extractLinks } from './schemas.js';

describe('gestibPasswordSchema', () => {
  it.each(['abc123', 'Escola2026', 'a12345678901234567890123456789'])('accepts %s', (p) =>
    expect(gestibPasswordSchema.safeParse(p).success).toBe(true),
  );
  it.each(['1abc23', 'abcdef', 'ab1', 'añoo123', 'pass_123', 'a'.repeat(30) + '1'])('rejects %s', (p) =>
    expect(gestibPasswordSchema.safeParse(p).success).toBe(false),
  );
});

describe('redact', () => {
  it('removes secrets at any depth and masks emails in strings', () => {
    const out = redact({
      password: 'hunter2a',
      nested: { cookies: [{ name: 's', value: 'x' }], ok: 1 },
      msg: 'contact parent@example.com now',
      list: [{ token: 't' }],
    });
    expect(out.password).toBe(REDACTED);
    expect(out.nested.cookies).toBe(REDACTED);
    expect(out.nested.ok).toBe(1);
    expect(out.msg).toBe('contact [EMAIL] now');
    expect(out.list[0]!.token).toBe(REDACTED);
    expect(JSON.stringify(out)).not.toContain('hunter2a');
  });
});

describe('itemView', () => {
  it('requires the original text even when a translation exists', () => {
    const base = {
      id: crypto.randomUUID(),
      childId: null,
      section: 'circular',
      translation: { lang: 'en', title: 'Trip', body: 'b', summary: 's' },
      sender: null,
      postedAt: null,
      actions: [],
    };
    expect(itemView.safeParse(base).success).toBe(false);
    expect(
      itemView.safeParse({ ...base, original: { title: 'Sortida', body: 'b', lang: 'ca' } }).success,
    ).toBe(true);
  });
});

describe('extractLinks', () => {
  it('keeps real links, resolves relative ones, skips attachments and anchors', () => {
    const html =
      '<p>Info: <a href="https://escola.example/form">Formulari</a> i <a href="#top">amunt</a>' +
      '<a href="circulars/veureDocumentAdjunt.do?codiDocument=9">doc.pdf</a> <a href="mailto:secretaria@x.es">secretaria</a></p>' +
      '<p>Web: https://ceip.example/menu.</p>';
    expect(extractLinks(html)).toEqual([
      { url: 'https://escola.example/form', label: 'Formulari' },
      { url: 'mailto:secretaria@x.es', label: 'secretaria' },
      { url: 'https://ceip.example/menu', label: 'https://ceip.example/menu' },
    ]);
  });
});
