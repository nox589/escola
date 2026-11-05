import type { FamilyAbsence, FeedItem } from './api';

export type Todo = { kind: 'item'; item: FeedItem } | { kind: 'absence'; a: FamilyAbsence };

/** Signing slips and consents first, then absences, replies, payments, the rest. */
const WEIGHT: Record<string, number> = { consent: 0, justify_absence: 1, reply: 2, pay: 3, upload_document: 4, book_meeting: 4, answer_survey: 5 };
const DAY = 86_400_000;

/** Days from today (Madrid) to the deadline; negative = overdue; null = no deadline. */
export function daysLeft(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d);
  return Math.round((new Date(`${ymd(new Date(iso))}T12:00:00`).getTime() - new Date(`${ymd(now)}T12:00:00`).getTime()) / DAY);
}

/**
 * Order of importance and time: overdue, due in 2 days, due this week, later, no deadline;
 * within each band the more important kind first, then the sooner deadline.
 */
export function sortTodos(list: Todo[], now = new Date()): Todo[] {
  const meta = (t: Todo) => {
    const due = t.kind === 'item' ? (t.item.action?.deadlineAt ?? null) : null;
    const d = daysLeft(due, now);
    const band = d === null ? (t.kind === 'absence' ? 2 : 4) : d < 0 ? 0 : d <= 2 ? 1 : d <= 7 ? 2 : 3;
    const weight = t.kind === 'absence' ? WEIGHT.justify_absence! : (WEIGHT[t.item.action?.kind ?? ''] ?? 6);
    return { band, weight, d: d ?? 9999 };
  };
  return [...list].sort((x, y) => {
    const a = meta(x);
    const b = meta(y);
    return a.band - b.band || a.weight - b.weight || a.d - b.d;
  });
}

/** School year start (1 September) for a date. */
function schoolYearStart(now: Date) {
  const y = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(y, 8, 1);
}

/**
 * Current vs past. Past: anything from before this school year; an action whose deadline passed
 * more than 3 days ago (or with no deadline, posted over 6 weeks ago); an update older than 3 weeks.
 */
export function isCurrent(item: FeedItem, now = new Date()): boolean {
  const posted = item.postedAt ? new Date(item.postedAt) : null;
  if (posted && posted < schoolYearStart(now)) return false;
  const ageDays = posted ? (now.getTime() - posted.getTime()) / DAY : 0;
  if (item.action) {
    const d = daysLeft(item.action.deadlineAt, now);
    return d === null ? ageDays <= 42 : d >= -3;
  }
  return ageDays <= 21;
}

/** "Maya Rose Nocker" → "Maya". */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
