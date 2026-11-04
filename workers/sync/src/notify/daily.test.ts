import { describe, expect, it } from 'vitest';
import { dailyBody, inDailyWindow, madridClock } from './daily.js';
import { MemoryPushSender, RoutingPushSender, WEB_PUSH_PREFIX, WebPushSender } from './push.js';

describe('daily summary', () => {
  it('runs in the 07:30 Madrid window only', () => {
    expect(inDailyWindow(new Date('2026-11-05T06:31:00Z'))).toBe(true); // 07:31 CET
    expect(inDailyWindow(new Date('2026-11-05T06:50:00Z'))).toBe(false);
    expect(madridClock(new Date('2026-11-05T06:31:00Z')).day).toBe(4); // Thursday
  });
  it('lists classes, to-dos and new items; stays quiet with nothing to say', () => {
    expect(dailyBody('en', { classes: [{ name: 'Maya', from: '09:00', to: '14:00' }], toDo: 2, fresh: 1 })).toMatchObject({
      title: 'Today at school',
      body: 'Maya 09:00–14:00 · 2 to do · 1 new',
    });
    expect(dailyBody('es', { classes: [], toDo: 1, fresh: 0 })!.body).toBe('1 pendiente');
    expect(dailyBody('en', { classes: [], toDo: 0, fresh: 0 })).toBeNull();
  });
});

describe('push routing', () => {
  it('sends web subscriptions via web push, others via Expo, and reports dropped subscriptions', async () => {
    const calls: string[] = [];
    const lib = {
      async sendNotification(sub: { endpoint: string }) {
        calls.push(sub.endpoint);
        if (sub.endpoint.endsWith('/gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
        return { statusCode: 201 };
      },
    };
    const web = new WebPushSender(lib, { subject: 'https://x.test', publicKey: 'p', privateKey: 'k' });
    const expo = new MemoryPushSender();
    const sub = (e: string) => `${WEB_PUSH_PREFIX}${JSON.stringify({ endpoint: e, keys: { p256dh: 'aaaaaaaaaaaa', auth: 'bbbbbbbb' } })}`;
    const r = await new RoutingPushSender(expo, web).send(['ExponentPushToken[abc]', sub('https://push.test/ok'), sub('https://push.test/gone')], {
      title: 't',
      body: 'b',
      collapseKey: 'c',
      data: { kind: 'daily' },
    });
    expect(expo.sent[0]!.tokens).toEqual(['ExponentPushToken[abc]']);
    expect(calls).toEqual(['https://push.test/ok', 'https://push.test/gone']);
    expect(r.ok).toBe(2);
    expect(r.invalidTokens).toEqual([sub('https://push.test/gone')]);
  });
});
