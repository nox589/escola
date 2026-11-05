import { describe, expect, it } from 'vitest';
import type { FamilyAbsence, FeedItem } from './api';
import { daysLeft, sortTodos, type Todo } from './todo';

const now = new Date('2026-11-05T09:00:00+01:00');
const it_ = (id: string, kind: string, deadlineAt: string | null): Todo => ({
  kind: 'item',
  item: { id, action: { id, kind, deadlineAt, confidence: 1 } } as unknown as FeedItem,
});
const abs: Todo = { kind: 'absence', a: { id: 'abs' } as FamilyAbsence };

describe('to-do order', () => {
  it('overdue, then due soon (important kinds first), then this week, then later', () => {
    const list = [
      it_('reply-later', 'reply', '2026-11-20T22:59:00Z'),
      it_('reply-tomorrow', 'reply', '2026-11-06T22:59:00Z'),
      it_('consent-tomorrow', 'consent', '2026-11-06T22:59:00Z'),
      abs,
      it_('pay-overdue', 'pay', '2026-11-03T22:59:00Z'),
      it_('reply-nodate', 'reply', null),
    ];
    expect(sortTodos(list, now).map((t) => (t.kind === 'item' ? t.item.id : 'abs'))).toEqual([
      'pay-overdue',
      'consent-tomorrow',
      'reply-tomorrow',
      'abs',
      'reply-later',
      'reply-nodate',
    ]);
  });
  it('counts days in Madrid time', () => {
    expect(daysLeft('2026-11-05T22:59:00Z', now)).toBe(0);
    expect(daysLeft('2026-11-04T10:00:00Z', now)).toBe(-1);
  });
});
