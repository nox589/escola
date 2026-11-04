import { useAuth } from './auth';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  const t = useAuth.getState().tokens;
  if (!t) return false;
  const r = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: t.refreshToken }),
  });
  if (!r.ok) {
    await useAuth.getState().setTokens(null);
    return false;
  }
  const j = await r.json();
  await useAuth.getState().setTokens({ accessToken: j.accessToken, refreshToken: j.refreshToken });
  return true;
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  retry = true,
): Promise<T> {
  const t = useAuth.getState().tokens;
  const r = await fetch(`${API_URL}/v1${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(t ? { authorization: `Bearer ${t.accessToken}` } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (r.status === 401 && retry && t) {
    refreshing ??= refresh().finally(() => (refreshing = null));
    if (await refreshing) return api<T>(path, init, false);
  }
  if (r.status === 204) return undefined as T;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, (j as { error?: string }).error ?? 'error');
  return j as T;
}

/**
 * Server-sent events over XHR (works in React Native, where fetch has no streaming body).
 * Calls onDelta for each text chunk; resolves with the cited item ids.
 */
export function streamAssistant(
  threadId: string,
  content: string,
  onDelta: (t: string) => void,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/v1/assistant/threads/${threadId}/messages`);
    xhr.setRequestHeader('content-type', 'application/json');
    const t = useAuth.getState().tokens;
    if (t) xhr.setRequestHeader('authorization', `Bearer ${t.accessToken}`);
    let seen = 0;
    let cited: string[] = [];
    const pump = () => {
      const text = xhr.responseText.slice(seen);
      const events = text.split('\n\n');
      // Keep the last (possibly partial) block for next time.
      const complete = events.slice(0, -1);
      seen += complete.reduce((n, e) => n + e.length + 2, 0);
      for (const e of complete) {
        const type = /^event: (\w+)/m.exec(e)?.[1];
        const data = /^data: (.*)$/m.exec(e)?.[1];
        if (!data) continue;
        const j = JSON.parse(data);
        if (type === 'delta') onDelta(j.text);
        if (type === 'done') cited = j.citedItemIds ?? [];
        if (type === 'error') reject(new ApiError(503, j.error));
      }
    };
    xhr.onprogress = pump;
    xhr.onload = () => {
      pump();
      if (xhr.status >= 400) {
        try {
          reject(new ApiError(xhr.status, JSON.parse(xhr.responseText).error));
        } catch {
          reject(new ApiError(xhr.status, 'error'));
        }
      } else resolve(cited);
    };
    xhr.onerror = () => reject(new ApiError(0, 'network'));
    xhr.send(JSON.stringify({ content }));
  });
}

// ---- Response types (mirroring apps/api) ----
export interface Me {
  id: string;
  email: string;
  displayName: string | null;
  locale: string;
  familyId: string;
  role: 'owner' | 'guardian' | 'viewer';
  canSubmit: boolean;
}
export interface Child {
  id: string;
  displayName: string;
  schoolName: string | null;
  classLabel: string | null;
  colour: string | null;
}
export interface Action {
  id: string;
  kind: string;
  deadlineAt: string | null;
  confidence: number;
  state?: string;
  deadlineSource?: string | null;
}
export interface FeedItem {
  id: string;
  section: string;
  child: { id: string; name: string; colour: string | null } | null;
  original: { title: string; lang: string };
  title: string;
  summary: string | null;
  translated: boolean;
  checkOriginal: boolean;
  sender: string | null;
  postedAt: string | null;
  read: boolean;
  action: Action | null;
}
export interface ItemDetail {
  id: string;
  section: string;
  child: FeedItem['child'];
  original: { title: string; body: string; html: string; lang: string };
  translation: { lang: string; title: string; body: string; summary: string; checkOriginal: boolean } | null;
  sender: string | null;
  postedAt: string | null;
  actions: Action[];
  attachments: { id: string; filename: string; mime: string; size: number }[];
}
export interface PortalAccount {
  id: string;
  portal: string;
  usernameHint: string;
  status:
    | 'active'
    | 'needs_login_help'
    | 'credentials_invalid'
    | 'locked'
    | 'password_expired'
    | 'paused'
    | 'disabled';
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  lastRun?: { startedAt: string; finishedAt: string | null; result: string | null } | null;
}
export interface Summary {
  openActions: number;
  dueSoon: number;
  accounts: { id: string; status: PortalAccount['status']; lastSyncAt: string | null; stale: boolean }[];
}
export interface Submission {
  id: string;
  kind: string;
  state: string;
  userInput: Record<string, unknown>;
  draftOriginal: string | null;
  preview: string | null;
  previewHash: string | null;
  consentText: string | null;
  errorCode: string | null;
  receipt?: { verifiedAt: string; confirmationRef: string | null; screenshotUrl: string | null } | null;
}
export interface CalendarEntry {
  id: string;
  itemId: string | null;
  childId: string | null;
  child: { name: string | null; colour: string | null } | null;
  title: string;
  titleOriginal: string;
  startsAt: string;
  allDay: boolean;
  kind: string;
}
