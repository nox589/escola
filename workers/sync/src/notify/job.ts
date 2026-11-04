import { and, eq, inArray } from '@escola/db';
import type pg from 'pg';
import { schema, withFamily } from '@escola/db';
import type { Section } from '@escola/shared';
import { log } from '../core/logger.js';
import { buildPushes, inQuietHours, quietHoursEnd, type NotifyItem, type PushMessage } from './format.js';
import type { PushSender } from './push.js';

export interface NotificationPrefs {
  quietStart?: string;
  quietEnd?: string;
  timeZone?: string;
  grades?: boolean; // new grade pushes are opt-in (SPEC §10)
  muted?: boolean;
}

export type NotifyOutcome = { sent: number; deferredUntil?: Date; deferredUserIds: string[] };

async function recipients(pool: pg.Pool, familyId: string) {
  return withFamily(pool, familyId, async (db) => {
    const rows = await db
      .select({
        userId: schema.users.id,
        locale: schema.users.locale,
        prefs: schema.familyMembers.notificationPrefs,
        token: schema.devices.expoPushToken,
      })
      .from(schema.familyMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.familyMembers.userId))
      .leftJoin(schema.devices, eq(schema.devices.userId, schema.users.id));
    const byUser = new Map<string, { locale: string; prefs: NotificationPrefs; tokens: string[] }>();
    for (const r of rows) {
      const u = byUser.get(r.userId) ?? {
        locale: r.locale,
        prefs: (r.prefs ?? {}) as NotificationPrefs,
        tokens: [],
      };
      if (r.token) u.tokens.push(r.token);
      byUser.set(r.userId, u);
    }
    return byUser;
  });
}

async function deliver(
  pool: pg.Pool,
  familyId: string,
  sender: PushSender,
  userId: string,
  tokens: string[],
  msgs: (PushMessage & { itemId?: string; kind: string })[],
) {
  let sent = 0;
  for (const m of msgs) {
    const r = tokens.length ? await sender.send(tokens, m) : { ok: 0, invalidTokens: [] as string[] };
    sent += r.ok;
    await withFamily(pool, familyId, async (db) => {
      await db.insert(schema.notifications).values({
        familyId,
        userId,
        itemId: m.itemId ?? null,
        channel: 'push',
        kind: m.kind,
        title: m.title,
        body: m.body,
        sentAt: new Date(),
        status: tokens.length ? 'sent' : 'no_device',
        collapseKey: m.collapseKey,
      });
      if (r.invalidTokens.length)
        await db.delete(schema.devices).where(inArray(schema.devices.expoPushToken, r.invalidTokens));
    });
  }
  return sent;
}

/**
 * Sends item pushes to every guardian, in their own locale (SPEC §10).
 * If ANY recipient is in quiet hours the caller re-queues for `deferredUntil` (per-user delay).
 */
export async function notifyItems(o: {
  pool: pg.Pool;
  familyId: string;
  itemIds: string[];
  sender: PushSender;
  now?: Date;
  /** Bypass quiet hours (submission results the parent just triggered). */
  urgent?: boolean;
  /** Restrict to these users (used when re-running for users who were in quiet hours). */
  userIds?: string[];
}): Promise<NotifyOutcome> {
  if (!o.itemIds.length) return { sent: 0, deferredUserIds: [] };
  const now = o.now ?? new Date();
  const users = await recipients(o.pool, o.familyId);
  let sent = 0;
  let deferredUntil: Date | undefined;
  const deferredUserIds: string[] = [];

  for (const [userId, u] of users) {
    if (u.prefs.muted) continue;
    if (o.userIds && !o.userIds.includes(userId)) continue;
    const q = { start: u.prefs.quietStart, end: u.prefs.quietEnd, timeZone: u.prefs.timeZone };
    if (!o.urgent && inQuietHours(now, q)) {
      const end = quietHoursEnd(now, q);
      deferredUntil = !deferredUntil || end < deferredUntil ? end : deferredUntil;
      deferredUserIds.push(userId);
      continue;
    }
    const items = await withFamily(o.pool, o.familyId, (db) =>
      db
        .select({
          id: schema.items.id,
          section: schema.items.section,
          title: schema.items.originalTitle,
          child: schema.children.displayName,
          summary: schema.itemTranslations.summary,
          action: schema.itemActions,
        })
        .from(schema.items)
        .leftJoin(schema.children, eq(schema.children.id, schema.items.childId))
        .leftJoin(
          schema.itemTranslations,
          and(
            eq(schema.itemTranslations.itemId, schema.items.id),
            eq(schema.itemTranslations.lang, u.locale),
          ),
        )
        .leftJoin(
          schema.itemActions,
          and(eq(schema.itemActions.itemId, schema.items.id), eq(schema.itemActions.state, 'open')),
        )
        .where(inArray(schema.items.id, o.itemIds)),
    );
    const list: NotifyItem[] = items
      .filter((i) => u.prefs.grades || !['grade', 'partial_grade'].includes(i.section))
      .map((i) => ({
        itemId: i.id,
        childName: i.child ?? '',
        section: i.section as Section,
        needsAction: !!i.action,
        actionKind: i.action?.kind ?? null,
        summary: i.summary ?? i.title,
        deadline: i.action?.deadlineAt ? i.action.deadlineAt.toISOString().slice(0, 10) : null,
      }));
    const pushes = buildPushes(list, u.locale).map((p) => ({
      ...p,
      itemId: p.data.itemId,
      kind: p.data.kind,
    }));
    sent += await deliver(o.pool, o.familyId, o.sender, userId, u.tokens, pushes);
  }
  log.info({ familyId: o.familyId, items: o.itemIds.length, sent, deferred: !!deferredUntil }, 'notify');
  return { sent, deferredUntil, deferredUserIds };
}

const SETUP: Record<string, (n: number) => [string, string]> = {
  en: (n) => [
    "You're set up",
    n
      ? `${n} ${n === 1 ? 'thing needs' : 'things need'} your attention.`
      : 'All caught up. We will tell you when something new arrives.',
  ],
  es: (n) => [
    'Todo listo',
    n ? `${n} cosas necesitan tu atención.` : 'Todo al día. Te avisaremos cuando llegue algo nuevo.',
  ],
  ca: (n) => [
    'Tot a punt',
    n ? `${n} coses necessiten la vostra atenció.` : 'Tot al dia. Us avisarem quan arribi una novetat.',
  ],
  de: (n) => [
    'Alles eingerichtet',
    n ? `${n} Dinge brauchen deine Aufmerksamkeit.` : 'Alles erledigt. Wir melden uns bei Neuem.',
  ],
  fr: (n) => [
    'Tout est prêt',
    n ? `${n} éléments demandent votre attention.` : 'Tout est à jour. Nous vous préviendrons.',
  ],
};

const PROBLEM: Record<string, Record<string, [string, string]>> = {
  update_password: {
    en: ['GestIB login stopped', 'Your GestIB password was not accepted. Please update it in the app.'],
    es: ['Acceso a GestIB detenido', 'GestIB no aceptó tu contraseña. Actualízala en la app.'],
  },
  password_expired: {
    en: [
      'GestIB password expired',
      'GestIB asks for a new password. Change it on GestIB, then update it here.',
    ],
    es: [
      'Contraseña de GestIB caducada',
      'GestIB pide una nueva contraseña. Cámbiala en GestIB y actualízala aquí.',
    ],
  },
  account_locked: {
    en: ['GestIB account locked', 'GestIB has locked the account. Contact the school, then update it here.'],
    es: ['Cuenta de GestIB bloqueada', 'GestIB ha bloqueado la cuenta. Contacta con el centro.'],
  },
  login_help: {
    en: ['GestIB needs you', 'GestIB asked for an extra check we cannot do for you. Open the app for help.'],
    es: ['GestIB te necesita', 'GestIB pide una comprobación extra. Abre la app para ver cómo seguir.'],
  },
};

export async function notifyBackfillSummary(o: {
  pool: pg.Pool;
  familyId: string;
  openActions: number;
  sender: PushSender;
}) {
  const users = await recipients(o.pool, o.familyId);
  for (const [userId, u] of users) {
    const [title, body] = (SETUP[u.locale] ?? SETUP.en!)(o.openActions);
    await deliver(o.pool, o.familyId, o.sender, userId, u.tokens, [
      { title, body, collapseKey: 'setup', data: { kind: 'batch' }, kind: 'setup' },
    ]);
  }
}

export async function notifyAccountProblem(o: {
  pool: pg.Pool;
  familyId: string;
  problem: keyof typeof PROBLEM;
  sender: PushSender;
}) {
  const users = await recipients(o.pool, o.familyId);
  for (const [userId, u] of users) {
    const [title, body] = PROBLEM[o.problem]![u.locale] ?? PROBLEM[o.problem]!.en!;
    // Account problems are not deferred by quiet hours only when urgent; they are rare and important.
    await deliver(o.pool, o.familyId, o.sender, userId, u.tokens, [
      {
        title,
        body,
        collapseKey: `account:${o.problem}`,
        data: { kind: 'batch' },
        kind: `account_${o.problem}`,
      },
    ]);
  }
}

const SUBMIT: Record<string, Record<'ok' | 'manual' | 'failed', [string, string]>> = {
  en: {
    ok: ['Sent ✓', 'Your message reached the school. Receipt saved in the app.'],
    manual: ['Please check GestIB', "We couldn't confirm it was sent. Open the app to see how to check."],
    failed: ["Couldn't send", 'Nothing was sent. Open the app to see how to do it yourself.'],
  },
  es: {
    ok: ['Enviado ✓', 'Tu mensaje llegó al centro. Recibo guardado en la app.'],
    manual: ['Revisa GestIB', 'No pudimos confirmar el envío. Abre la app para ver cómo comprobarlo.'],
    failed: ['No se pudo enviar', 'No se envió nada. Abre la app para hacerlo tú.'],
  },
};

/** Submission results bypass quiet hours: the parent just triggered them (SPEC §10). */
export async function notifySubmissionResult(o: {
  pool: pg.Pool;
  familyId: string;
  userId: string;
  submissionId: string;
  outcome: 'ok' | 'manual' | 'failed';
  sender: PushSender;
}) {
  const users = await recipients(o.pool, o.familyId);
  const u = users.get(o.userId);
  if (!u) return;
  const [title, body] = (SUBMIT[u.locale] ?? SUBMIT.en!)[o.outcome];
  await deliver(o.pool, o.familyId, o.sender, o.userId, u.tokens, [
    {
      title,
      body,
      collapseKey: `submission:${o.submissionId}`,
      data: { kind: 'item' },
      kind: `submission_${o.outcome}`,
    },
  ]);
}
