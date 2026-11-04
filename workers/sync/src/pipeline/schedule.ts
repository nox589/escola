/**
 * SPEC §8.3 default schedule [ASSUMPTION]: 07:00, 12:00, 16:00, 20:00 Europe/Madrid on school days
 * (Mon–Fri), once at 10:00 on weekends, each with ±10 min jitter.
 */
export const WEEKDAY_SLOTS = ['07:00', '12:00', '16:00', '20:00'];
export const WEEKEND_SLOTS = ['10:00'];
export const JITTER_MS = 10 * 60_000;
const TZ = 'Europe/Madrid';

function madridParts(d: Date) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => f.find((p) => p.type === t)!.value;
  return {
    date: `${g('year')}-${g('month')}-${g('day')}`,
    hm: `${g('hour')}:${g('minute')}`,
    weekday: g('weekday'),
  };
}

/** Most recent scheduled slot at or before `now`, as a Date. Walks back minute by minute (≤ 3 days). */
export function lastSlotBefore(now: Date): Date {
  for (let m = 0; m < 3 * 24 * 60; m++) {
    const t = new Date(Math.floor(now.getTime() / 60_000) * 60_000 - m * 60_000);
    const p = madridParts(t);
    const weekend = p.weekday === 'Sat' || p.weekday === 'Sun';
    if ((weekend ? WEEKEND_SLOTS : WEEKDAY_SLOTS).includes(p.hm)) return t;
  }
  return new Date(now.getTime() - 24 * 3600_000);
}

/** Due if a slot has passed since the last sync (or it has never synced). */
export function isDue(now: Date, lastSyncAt: Date | null): boolean {
  if (!lastSyncAt) return true;
  return lastSyncAt < lastSlotBefore(now);
}

export function jitter(rand = Math.random): number {
  return Math.floor(rand() * JITTER_MS);
}
