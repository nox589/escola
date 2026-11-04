import type { Section } from '@escola/shared';

/**
 * SPEC §10 push rules: title "{Child} · {Kind}", body = summary ≤110 chars + "by Fri 14 Nov",
 * no sensitive detail on the lock screen (grades/attendance say only that something is new),
 * >3 items in one sync → one batched push, quiet hours 21:00–07:00 local.
 */

type L = 'en' | 'es' | 'ca' | 'de' | 'fr';
const pick = (locale: string): L => (['en', 'es', 'ca', 'de', 'fr'].includes(locale) ? (locale as L) : 'en');

const KIND: Record<
  L,
  Partial<Record<Section | 'consent' | 'deadline' | 'account' | 'submission', string>>
> = {
  en: {
    message: 'Message',
    circular: 'Circular',
    authorisation: 'Consent needed',
    notification: 'Notice',
    attendance: 'Attendance',
    grade: 'New grade',
    partial_grade: 'New grade',
    assessment: 'Assessment',
    activity: 'Activity',
    calendar_event: 'Calendar',
    consent: 'Consent needed',
    deadline: 'Reminder',
    other: 'Update',
  },
  es: {
    message: 'Mensaje',
    circular: 'Circular',
    authorisation: 'Autorización',
    notification: 'Aviso',
    attendance: 'Asistencia',
    grade: 'Nueva nota',
    partial_grade: 'Nueva nota',
    assessment: 'Evaluación',
    activity: 'Actividad',
    calendar_event: 'Calendario',
    consent: 'Autorización',
    deadline: 'Recordatorio',
    other: 'Novedad',
  },
  ca: {
    message: 'Missatge',
    circular: 'Circular',
    authorisation: 'Autorització',
    notification: 'Avís',
    attendance: 'Assistència',
    grade: 'Nova nota',
    partial_grade: 'Nova nota',
    assessment: 'Avaluació',
    activity: 'Activitat',
    calendar_event: 'Calendari',
    consent: 'Autorització',
    deadline: 'Recordatori',
    other: 'Novetat',
  },
  de: {
    message: 'Nachricht',
    circular: 'Rundschreiben',
    authorisation: 'Einverständnis nötig',
    notification: 'Hinweis',
    attendance: 'Anwesenheit',
    grade: 'Neue Note',
    partial_grade: 'Neue Note',
    assessment: 'Bewertung',
    activity: 'Aktivität',
    calendar_event: 'Kalender',
    consent: 'Einverständnis nötig',
    deadline: 'Erinnerung',
    other: 'Neuigkeit',
  },
  fr: {
    message: 'Message',
    circular: 'Circulaire',
    authorisation: 'Autorisation',
    notification: 'Avis',
    attendance: 'Présence',
    grade: 'Nouvelle note',
    partial_grade: 'Nouvelle note',
    assessment: 'Évaluation',
    activity: 'Activité',
    calendar_event: 'Calendrier',
    consent: 'Autorisation',
    deadline: 'Rappel',
    other: 'Nouveauté',
  },
};

const BY: Record<L, string> = { en: 'by', es: 'antes del', ca: 'abans del', de: 'bis', fr: 'avant le' };
const NEW_FOR: Record<L, (n: number, c: string) => string> = {
  en: (n, c) => `${n} new updates for ${c}`,
  es: (n, c) => `${n} novedades para ${c}`,
  ca: (n, c) => `${n} novetats per a ${c}`,
  de: (n, c) => `${n} neue Mitteilungen für ${c}`,
  fr: (n, c) => `${n} nouveautés pour ${c}`,
};
const SENSITIVE_BODY: Record<L, (c: string) => string> = {
  en: (c) => `Open the app to see it for ${c}.`,
  es: (c) => `Abre la app para verlo (${c}).`,
  ca: (c) => `Obre l'app per veure-ho (${c}).`,
  de: (c) => `Öffne die App, um es zu sehen (${c}).`,
  fr: (c) => `Ouvrez l'app pour le voir (${c}).`,
};

/** Sections whose content must not appear on the lock screen. */
const SENSITIVE: Section[] = ['grade', 'partial_grade', 'assessment', 'attendance'];

export interface NotifyItem {
  itemId: string;
  childName: string;
  section: Section;
  needsAction: boolean;
  actionKind?: string | null;
  summary: string;
  deadline?: string | null;
}

export interface PushMessage {
  title: string;
  body: string;
  collapseKey: string;
  data: { itemId?: string; childName?: string; kind: 'item' | 'batch' };
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function formatDeadline(iso: string, locale: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Madrid',
  }).format(d);
}

export function formatItemPush(it: NotifyItem, locale: string): PushMessage {
  const l = pick(locale);
  const kindKey = it.actionKind === 'consent' ? 'consent' : it.section;
  const kind = KIND[l][kindKey] ?? KIND[l].other!;
  const title = `${it.childName} · ${kind}`;
  let body: string;
  if (SENSITIVE.includes(it.section)) {
    body = SENSITIVE_BODY[l](it.childName);
  } else {
    const dl = it.deadline ? ` ${BY[l]} ${formatDeadline(it.deadline, locale)}` : '';
    body = truncate(it.summary, 110 - dl.length) + dl;
  }
  return {
    title,
    body,
    collapseKey: `item:${it.itemId}`,
    data: { itemId: it.itemId, childName: it.childName, kind: 'item' },
  };
}

/** One push per item, or one per child when that child has more than 3 new items. */
export function buildPushes(items: NotifyItem[], locale: string): PushMessage[] {
  const byChild = new Map<string, NotifyItem[]>();
  for (const it of items) byChild.set(it.childName, [...(byChild.get(it.childName) ?? []), it]);
  const out: PushMessage[] = [];
  for (const [child, list] of byChild) {
    if (list.length > 3) {
      const actions = list.filter((i) => i.needsAction).length;
      out.push({
        title: child,
        body:
          NEW_FOR[pick(locale)](list.length, child) +
          (actions ? ` · ${actions} ${KIND[pick(locale)].consent}` : ''),
        collapseKey: `batch:${child}`,
        data: { childName: child, kind: 'batch' },
      });
    } else out.push(...list.map((i) => formatItemPush(i, locale)));
  }
  return out;
}

/** True when `now` is inside quiet hours in the recipient's time zone. Window may cross midnight. */
export function inQuietHours(
  now: Date,
  prefs: { start?: string; end?: string; timeZone?: string } = {},
): boolean {
  const start = prefs.start ?? '21:00';
  const end = prefs.end ?? '07:00';
  const hm = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: prefs.timeZone ?? 'Europe/Madrid',
  }).format(now);
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const t = toMin(hm);
  const a = toMin(start);
  const b = toMin(end);
  return a <= b ? t >= a && t < b : t >= a || t < b;
}

/** When quiet hours end next (for scheduling delayed delivery). */
export function quietHoursEnd(now: Date, prefs: { end?: string; timeZone?: string } = {}): Date {
  const end = prefs.end ?? '07:00';
  for (let m = 1; m <= 24 * 60; m++) {
    const t = new Date(now.getTime() + m * 60_000);
    const hm = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: prefs.timeZone ?? 'Europe/Madrid',
    }).format(t);
    if (hm === end) return t;
  }
  return new Date(now.getTime() + 10 * 3600_000);
}
