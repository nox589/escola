import { describe, expect, it } from 'vitest';
import { teachersFromTimetable } from '@escola/shared';
import { parseLabelReply } from './labels.js';

describe('label translation reply', () => {
  it('accepts only an array of the right length', () => {
    expect(parseLabelReply('Sure: ["Maths", "PE"]', 2)).toEqual(['Maths', 'PE']);
    expect(parseLabelReply('["Maths"]', 2)).toBeNull();
    expect(parseLabelReply('no json', 1)).toBeNull();
  });
});

describe('teachers from timetable', () => {
  it('orders by weekly hours and lists subjects', () => {
    const s = (day: number, start: string, end: string, subject: string, teachers: string[]) => ({ day, start, end, subject, subjectShort: null, room: null, teachers });
    expect(
      teachersFromTimetable([s(1, '09:00', '10:30', 'Catalan', ['A']), s(2, '09:00', '10:00', 'Maths', ['A']), s(1, '11:00', '12:00', 'PE', ['B'])]),
    ).toEqual([
      { name: 'A', subjects: ['Catalan', 'Maths'], hoursPerWeek: 2.5 },
      { name: 'B', subjects: ['PE'], hoursPerWeek: 1 },
    ]);
  });
});
