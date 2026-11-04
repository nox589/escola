import { useQuery } from '@tanstack/react-query';
import { api, type Child, type Me, type PortalAccount, type Summary } from './api';
import { useAuth } from './auth';

export const useMe = () => {
  const signedIn = !!useAuth((s) => s.tokens);
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), enabled: signedIn });
};
export const useChildren = () =>
  useQuery({ queryKey: ['children'], queryFn: () => api<Child[]>('/children') });
export const useAccounts = () =>
  useQuery({ queryKey: ['accounts'], queryFn: () => api<PortalAccount[]>('/portal-accounts') });
export const useSummary = () =>
  useQuery({ queryKey: ['summary'], queryFn: () => api<Summary>('/summary'), refetchInterval: 60_000 });
export const useConsents = () =>
  useQuery({ queryKey: ['consents'], queryFn: () => api<{ kind: string; version: string }[]>('/consents') });

/** Relative time like "2 h ago" in the UI language. */
export function relative(iso: string | null, locale: string): string {
  if (!iso) return '';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

/** "Fri 14 Nov" style in the UI language, Europe/Madrid (SPEC §15). */
export function shortDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Madrid',
  }).format(new Date(iso));
}

export const CONSENT_VERSION = '2026-11-1';
