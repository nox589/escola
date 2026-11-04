import { describe, expect, it } from 'vitest';
import { anonymise } from './anonymise.js';

const html = `<html><body>
<h1>Alumne: Martí Pons Ferrer (NIA 12345678)</h1>
<p>Tutora: Joana Bauzà — joana.bauza@educaib.eu — tel. 971 123 456 / +34 612345678</p>
<p>DNI pare: 43123456K, NIE mare: X1234567L</p>
<p>Germà: MARTI PONS FERRER, expedient 12345678</p>
<input type="hidden" name="csrf" value="a8f9e7d6c5">
<a href="/families/x;jsessionid=ABCDEF0123?ticket=ST-999">link</a>
</body></html>`;

describe('anonymiser', () => {
  const out = anonymise(html, { names: ['Martí Pons Ferrer', 'Joana Bauzà'] });

  it('strips names (case and accent insensitive), emails, phones, DNI/NIE, tokens and ids', () => {
    for (const secret of [
      'Martí',
      'MARTI',
      'Joana',
      'Bauzà',
      'joana.bauza@educaib.eu',
      '971 123 456',
      '612345678',
      '43123456K',
      'X1234567L',
      '12345678',
      'a8f9e7d6c5',
      'ABCDEF0123',
      'ST-999',
    ])
      expect(out).not.toContain(secret);
  });

  it('keeps replacements consistent so linked ids still match', () => {
    expect(out.match(/Persona 1/g)).toHaveLength(2); // both spellings of the child's name
    const ids = out.match(/9000\d\d/g)!;
    expect(new Set(ids).size).toBe(1); // NIA and expedient were the same number
  });

  it('keeps document structure', () => {
    expect(out).toContain('<input type="hidden" name="csrf" value="HIDDEN_1">');
    expect(out).toContain('persona1@example.test');
  });
});
