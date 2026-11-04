import { api } from './api';
import { useAuth } from './auth';

export async function signInWithToken(token: string, locale: string) {
  const r = await api<{ accessToken: string; refreshToken: string }>('/auth/verify', {
    body: { token, locale },
  });
  await useAuth.getState().setTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken });
}

export async function signOut() {
  const t = useAuth.getState().tokens;
  if (t) await api('/auth/logout', { body: { refreshToken: t.refreshToken } }).catch(() => undefined);
  await useAuth.getState().setTokens(null);
}
