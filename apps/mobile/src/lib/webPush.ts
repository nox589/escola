import { Platform } from 'react-native';
import { api } from './api';

/** Web-only helpers for the installed web app: Home Screen state and push subscriptions. */
const w = (): (Window & typeof globalThis) | null => (Platform.OS === 'web' && typeof window !== 'undefined' ? window : null);

export function isIos(): boolean {
  const win = w();
  if (!win) return false;
  const ua = win.navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && win.navigator.maxTouchPoints > 1);
}

/** True when running from the Home Screen (installed), not a browser tab. */
export function isStandalone(): boolean {
  const win = w();
  if (!win) return false;
  return win.matchMedia?.('(display-mode: standalone)').matches || (win.navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function webPushSupported(): boolean {
  const win = w();
  return !!win && 'serviceWorker' in win.navigator && 'PushManager' in win && 'Notification' in win;
}

export type WebPushState = 'unsupported' | 'needs-install' | 'default' | 'granted' | 'denied';

export function webPushState(): WebPushState {
  const win = w();
  if (!win) return 'unsupported';
  // iPhone only offers web push to apps added to the Home Screen.
  if (isIos() && !isStandalone()) return 'needs-install';
  if (!webPushSupported()) return 'unsupported';
  return win.Notification.permission as WebPushState;
}

const b64ToBytes = (b64: string) => {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(s);
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
};

async function registration() {
  const win = w()!;
  return (await win.navigator.serviceWorker.getRegistration('/')) ?? win.navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/** Subscribes this browser and registers it with the API. Call from a tap (iOS requires a user gesture). */
export async function enableWebPush(locale: string): Promise<boolean> {
  const win = w();
  if (!win || !webPushSupported()) return false;
  const perm = win.Notification.permission === 'granted' ? 'granted' : await win.Notification.requestPermission();
  if (perm !== 'granted') return false;
  const { vapidPublicKey } = await api<{ vapidPublicKey: string | null }>('/push/config');
  if (!vapidPublicKey) return false;
  const reg = await registration();
  await win.navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidPublicKey) }));
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) return false;
  await api('/devices', { body: { webPush: { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } }, platform: 'web', locale } });
  return true;
}

/** On every app open: if notifications are already allowed, refresh the subscription quietly. */
export async function refreshWebPush(locale: string) {
  if (webPushState() === 'granted') await enableWebPush(locale).catch(() => undefined);
}
