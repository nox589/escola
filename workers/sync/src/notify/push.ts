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
