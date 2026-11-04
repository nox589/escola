import { describe, expect, it } from 'vitest';
import { buildPushes, formatItemPush, inQuietHours, type NotifyItem } from './format.js';

const it1 = (p: Partial<NotifyItem> = {}): NotifyItem => ({
  itemId: 'i1',
  childName: 'Leo',
  section: 'circular',
  needsAction: true,
  actionKind: 'consent',
  summary: 'Sign and return the permission slip for the nature park trip.',
  deadline: '2026-11-13',
  ...p,
});

describe('push formatting', () => {
  it('uses "{Child} · {Kind}" and appends the deadline within 110 chars', () => {
    const m = formatItemPush(it1(), 'en');
    expect(m.title).toBe('Leo · Consent needed');
    expect(m.body).toMatch(/by Fri 13 Nov$/);
    expect(m.body.length).toBeLessThanOrEqual(110);
    const long = formatItemPush(it1({ summary: 'x'.repeat(300) }), 'en');
    expect(long.body.length).toBeLessThanOrEqual(110);
  });

  it('never shows grade or attendance detail on the lock screen', () => {
    const m = formatItemPush(
      it1({ section: 'grade', summary: 'Maths: 4.5 (suspès)', actionKind: null, deadline: null }),
      'en',
    );
    expect(m.title).toBe('Leo · New grade');
    expect(m.body).not.toContain('4.5');
  });

  it('localises', () => {
    expect(formatItemPush(it1(), 'es').title).toBe('Leo · Autorización');
    expect(formatItemPush(it1(), 'de').body).toContain('bis');
  });

  it('batches more than 3 items per child', () => {
    const items = Array.from({ length: 5 }, (_, i) => it1({ itemId: `i${i}` }));
    const pushes = buildPushes([...items, it1({ childName: 'Maya', itemId: 'm1' })], 'en');
    expect(pushes).toHaveLength(2);
    expect(pushes[0]!.body).toContain('5 new updates for Leo');
    expect(pushes[1]!.title).toBe('Maya · Consent needed');
  });

  it('quiet hours cross midnight in Europe/Madrid', () => {
    expect(inQuietHours(new Date('2026-11-04T21:30:00Z'))).toBe(true); // 22:30 Madrid
    expect(inQuietHours(new Date('2026-11-04T05:30:00Z'))).toBe(true); // 06:30
    expect(inQuietHours(new Date('2026-11-04T06:30:00Z'))).toBe(false); // 07:30
    expect(inQuietHours(new Date('2026-11-04T12:00:00Z'))).toBe(false);
  });
});
