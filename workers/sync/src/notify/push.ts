import type { PushMessage } from './format.js';

export interface PushSender {
  send(tokens: string[], msg: PushMessage): Promise<{ ok: number; invalidTokens: string[] }>;
}

/** Expo push service → APNs/FCM. https://docs.expo.dev/push-notifications/sending-notifications/ */
export class ExpoPushSender implements PushSender {
  constructor(private readonly accessToken?: string) {}
  async send(tokens: string[], msg: PushMessage) {
    if (!tokens.length) return { ok: 0, invalidTokens: [] };
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify(
        tokens.map((to) => ({
          to,
          title: msg.title,
          body: msg.body,
          data: msg.data,
          sound: 'default',
          channelId: 'default',
        })),
      ),
    });
    if (!res.ok) throw new Error(`expo push failed: ${res.status}`);
    const json = (await res.json()) as { data: { status: string; details?: { error?: string } }[] };
    const invalidTokens = json.data
      .map((d, i) => (d.details?.error === 'DeviceNotRegistered' ? tokens[i]! : null))
      .filter((t): t is string => !!t);
    return { ok: json.data.filter((d) => d.status === 'ok').length, invalidTokens };
  }
}

export class MemoryPushSender implements PushSender {
  readonly sent: { tokens: string[]; msg: PushMessage }[] = [];
  async send(tokens: string[], msg: PushMessage) {
    this.sent.push({ tokens, msg });
    return { ok: tokens.length, invalidTokens: [] };
  }
}

/** Web push subscriptions are stored as device tokens with this prefix + the subscription JSON. */
export const WEB_PUSH_PREFIX = 'webpush:';

type WebPushLib = {
  sendNotification(
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    opts: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL: number; urgency?: 'normal' | 'high' },
  ): Promise<{ statusCode: number }>;
};

/** Standard Web Push (VAPID) for the installed web app: Apple, Google and Mozilla push services. */
export class WebPushSender implements PushSender {
  constructor(
    private readonly lib: WebPushLib,
    private readonly vapid: { subject: string; publicKey: string; privateKey: string },
  ) {}
  async send(tokens: string[], msg: PushMessage) {
    let ok = 0;
    const invalidTokens: string[] = [];
    const payload = JSON.stringify({ title: msg.title, body: msg.body, data: msg.data ?? {} });
    for (const t of tokens) {
      let sub: { endpoint: string; keys: { p256dh: string; auth: string } };
      try {
        sub = JSON.parse(t.slice(WEB_PUSH_PREFIX.length));
      } catch {
        invalidTokens.push(t);
        continue;
      }
      try {
        await this.lib.sendNotification(sub, payload, { vapidDetails: this.vapid, TTL: 12 * 3600, urgency: 'normal' });
        ok++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // 404/410: the browser dropped the subscription; the app re-subscribes on next open.
        if (code === 404 || code === 410) invalidTokens.push(t);
      }
    }
    return { ok, invalidTokens };
  }
}

/** Sends each token through the right service: web push subscriptions vs Expo (native apps). */
export class RoutingPushSender implements PushSender {
  constructor(
    private readonly expo: PushSender,
    private readonly web: PushSender | null,
  ) {}
  async send(tokens: string[], msg: PushMessage) {
    const web = tokens.filter((t) => t.startsWith(WEB_PUSH_PREFIX));
    const native = tokens.filter((t) => !t.startsWith(WEB_PUSH_PREFIX));
    const a = native.length ? await this.expo.send(native, msg) : { ok: 0, invalidTokens: [] };
    const b = web.length && this.web ? await this.web.send(web, msg) : { ok: 0, invalidTokens: [] };
    return { ok: a.ok + b.ok, invalidTokens: [...a.invalidTokens, ...b.invalidTokens] };
  }
}
