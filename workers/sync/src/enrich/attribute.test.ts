import { describe, expect, it } from 'vitest';
import { attributeChild } from './job.js';

const kids = [
  { id: 'a', name: 'Maria Test Garcia' },
  { id: 'b', name: 'Biel Test' },
];

describe('attributeChild', () => {
  it('assigns an item to the one child it names (first name, accents ignored)', () => {
    expect(attributeChild('01/10 - MARIA TEST GARCIA - Sortida', kids)).toBe('a');
    expect(attributeChild('Benvolguda família de la Maria,', kids)).toBe('a');
    expect(attributeChild("Reunió de pares de 2n: en Biel va d'excursió", kids)).toBe('b');
  });
  it('leaves family-wide or ambiguous items without a child', () => {
    expect(attributeChild('Menjador: canvi de menú', kids)).toBeNull();
    expect(attributeChild('Maria i Biel', kids)).toBeNull();
    expect(attributeChild('Mariano', kids)).toBeNull(); // no partial-word matches
  });
});
