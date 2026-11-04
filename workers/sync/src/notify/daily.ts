import { and, eq, gte, inArray, lt } from '@escola/db';
import type pg from 'pg';
import { schema, withFamily } from '@escola/db';
import { log } from '../core/logger.js';
import type { NotificationPrefs } from './job.js';
import type { PushMessage } from './format.js';
import type { PushSender } from './push.js';

type L = 'en' | 'es' | 'ca' | 'de' | 'fr';
const pick = (l: string): L => (['en', 'es', 'ca', 'de', 'fr'].includes(l) ? (l as L) : 'en');

const T: Record<L, { title: string; toDo: (n: number) => string; fresh: (n: number) => string; absence: string; absenceBody: string }> = {
  en: { title: 'Today at school', toDo: (n) => `${n} to do`, fresh: (n) => `${n} new`, absence: 'Attendance', absenceBody: 'New absence recorded. Open clases to see it.' },
  es: { title: 'Hoy en el cole', toDo: (n) => `${n} pendiente${n === 1 ? '' : 's'}`, fresh: (n) => `${n} nuevo${n === 1 ? '' : 's'}`, absence: 'Asistencia', absenceBody: 'Nueva falta registrada. Ábrela en clases.' },
  ca: { title: 'Avui a l’escola', toDo: (n) => `${n} pendent${n === 1 ? '' : 's'}`, fresh: (n) => `${n} nou${n === 1 ? '' : 's'}`, absence: 'Assistència', absenceBody: 'Nova falta registrada. Obre-la a clases.' },
  de: { title: 'Heute in der Schule', toDo: (n) => `${n} offen`, fresh: (n) => `${n} neu`, absence: 'Anwesenheit', absenceBody: 'Neue Fehlzeit eingetragen. In clases ansehen.' },
  fr: { title: 'Aujourd’hui à l’école', toDo: (n) => `${n} à faire`, fresh: (n) => `${n} nouveau${n === 1 ? '' : 'x'}`, absence: 'Présence', absenceBody: 'Nouvelle absence enregistrée. Voir dans clases.' },
};

/** Madrid weekday (1 = Monday) and HH:MM. */
export function madridClock(now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.find((p) => p.type === 'weekday')?.value ?? 'Mon') + 1;
  const hh = (parts.find((p) => p.type === 'hour')?.value ?? '00').replace('24', '00');
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return { day: wd, time: `${hh}:${mm}` };
}

/** The 07:30 window (two scheduler ticks); a sent row per user stops duplicates. */
export const inDailyWindow = (now: Date) => {
  const t = madridClock(now).time;
  return t >= '07:30' && t < '07:45';
};

export function dailyBody(
  locale: string,
  o: { classes: { name: string; from: string; to: string }[]; toDo: number; fresh: number },
): PushMessage | null {
  const l = T[pick(locale)];
  const parts = [
    ...o.classes.map((c) => `${c.name} ${c.from}–${c.to}`),
    ...(o.toDo ? [l.toDo(o.toDo)] : []),
    ...(o.fresh ? [l.fresh(o.fresh)] : []),
  ];
  if (!parts.length) return null; // weekend with nothing new: stay quiet
  return { title: l.title, body: parts.join(' · '), collapseKey: 'daily', data: { kind: 'daily', url: '/' } };
}

async function send(pool: pg.Pool, familyId: string, sender: PushSender, userId: string, tokens: string[], m: PushMessage, kind: string) {
  const r = tokens.length ? await sender.send(tokens, m) : { ok: 0, invalidTokens: [] as string[] };
  await withFamily(pool, familyId, async (db) => {
    await db.insert(schema.notifications).values({
      familyId,
      userId,
      channel: 'push',
      kind,
      title: m.title,
      body: m.body,
      sentAt: new Date(),
      status: tokens.length ? 'sent' : 'no_device',
      collapseKey: m.collapseKey,
    });
    if (r.invalidTokens.length) await db.delete(schema.devices).where(inArray(schema.devices.expoPushToken, r.invalidTokens));
  });
  return r.ok;
}

async function members(pool: pg.Pool, familyId: string) {
  return withFamily(pool, familyId, async (db) => {
    const rows = await db
      .select({ userId: schema.users.id, locale: schema.users.locale, prefs: schema.familyMembers.notificationPrefs, token: schema.devices.expoPushToken })
      .from(schema.familyMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.familyMembers.userId))
      .leftJoin(schema.devices, eq(schema.devices.userId, schema.users.id));
    const m = new Map<string, { locale: string; prefs: NotificationPrefs; tokens: string[] }>();
    for (const r of rows) {
      const u = m.get(r.userId) ?? { locale: r.locale, prefs: (r.prefs ?? {}) as NotificationPrefs, tokens: [] };
      if (r.token) u.tokens.push(r.token);
      m.set(r.userId, u);
    }
    return m;
  });
}

/** Morning summary: today's classes per child, things to do, what's new since yesterday. Once a day per user. */
export async function sendDailySummaries(o: { pool: pg.Pool; familyId: string; sender: PushSender; now?: Date }): Promise<number> {
  const now = o.now ?? new Date();
  const { day } = madridClock(now);
  const since = new Date(now.getTime() - 20 * 3600_000);
  const data = await withFamily(o.pool, o.familyId, async (db) => {
    const kids = await db.select({ name: schema.children.displayName, timetable: schema.children.timetable }).from(schema.children);
    const open = await db.select({ id: schema.itemActions.id }).from(schema.itemActions).where(eq(schema.itemActions.state, 'open'));
    const abs = await db.select({ id: schema.absences.id }).from(schema.absences).where(eq(schema.absences.status, 'unjustified'));
    const fresh = await db.select({ id: schema.items.id }).from(schema.items).where(gte(schema.items.firstSeenAt, new Date(now.getTime() - 24 * 3600_000)));
    const sentToday = await db
      .select({ userId: schema.notifications.userId })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.kind, 'daily_summary'), gte(schema.notifications.createdAt, since)));
    // School holiday or non-teaching day today (entries are stored at 00:00 Madrid).
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(now);
    const dayStart = new Date(`${ymd}T00:00:00+01:00`);
    const offToday =
      (
        await db
          .select({ id: schema.calendarEntries.id })
          .from(schema.calendarEntries)
          .where(
            and(
              eq(schema.calendarEntries.kind, 'school'),
              gte(schema.calendarEntries.startsAt, new Date(dayStart.getTime() - 3600_000)),
              lt(schema.calendarEntries.startsAt, new Date(dayStart.getTime() + 23 * 3600_000)),
            ),
          )
      ).length > 0;
    return { kids, toDo: open.length + abs.length, fresh: fresh.length, sent: new Set(sentToday.map((s) => s.userId)), offToday };
  });
  const classes = data.kids
    .map((k) => {
      const s = k.timetable.filter((x) => x.day === day).sort((a, b) => a.start.localeCompare(b.start));
      return s.length ? { name: k.name.split(/\s+/)[0]!, from: s[0]!.start, to: s[s.length - 1]!.end } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  let sent = 0;
  for (const [userId, u] of await members(o.pool, o.familyId)) {
    if (u.prefs.muted || data.sent.has(userId)) continue;
    const m = dailyBody(u.locale, { classes: data.offToday ? [] : classes, toDo: data.toDo, fresh: data.fresh });
    if (!m) continue;
    sent += await send(o.pool, o.familyId, o.sender, userId, u.tokens, m, 'daily_summary');
  }
  log.info({ familyId: o.familyId, sent }, 'daily summary');
  return sent;
}

/** New absence found by a sync. Lock-screen text says only that something is new (SPEC §10). */
export async function notifyNewAbsences(o: { pool: pg.Pool; familyId: string; sender: PushSender; children: { childId: string; name: string }[] }) {
  if (!o.children.length) return 0;
  let sent = 0;
  for (const [userId, u] of await members(o.pool, o.familyId)) {
    if (u.prefs.muted) continue;
    for (const c of o.children) {
      const l = T[pick(u.locale)];
      const m: PushMessage = {
        title: `${c.name.split(/\s+/)[0]} · ${l.absence}`,
        body: l.absenceBody,
        collapseKey: `absence-${c.childId}`,
        data: { kind: 'absence', url: `/child/${c.childId}?tab=attendance` },
      };
      sent += await send(o.pool, o.familyId, o.sender, userId, u.tokens, m, 'absence');
    }
  }
  return sent;
}
