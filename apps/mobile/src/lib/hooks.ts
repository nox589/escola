import { useQueries, useQuery } from '@tanstack/react-query';
import { api, type Child, type ChildProfile, type FamilyAbsence, type Me, type PortalAccount, type Summary, type Thread, type TimetableSession } from './api';
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
export const useChildProfile = (id: string | undefined) =>
  useQuery({ queryKey: ['profile', id], queryFn: () => api<ChildProfile>(`/children/${id}/profile`), enabled: !!id });
/** Profiles for every child (timetables for the Week view). */
export const useProfiles = (ids: string[]) =>
  useQueries({ queries: ids.map((id) => ({ queryKey: ['profile', id], queryFn: () => api<ChildProfile>(`/children/${id}/profile`) })) });
export const useAbsences = () =>
  useQuery({ queryKey: ['absences'], queryFn: () => api<FamilyAbsence[]>('/absences') });

/** Subject in the UI language when translated (original kept alongside). */
export const subjectOf = (s: TimetableSession) => s.subjectTranslated || s.subject;

/** "Tue 4 Nov" from a YYYY-MM-DD day, no timezone shift. */
export function dayLabel(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(`${day}T12:00:00`),
  );
}

/** Weekday name (1 = Monday) in the UI language. */
export function weekdayName(day: number, locale: string, style: 'long' | 'short' = 'long'): string {
  const ref = new Date(2024, 0, day); // 1 Jan 2024 was a Monday
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, { weekday: style }).format(ref);
}

export const useThreads = () =>
  useQuery({ queryKey: ['threads'], queryFn: () => api<Thread[]>('/threads'), refetchInterval: 120_000 });

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

/** Same key the API uses for a sender's conversation (base64url of the sender, or 'school'). */
export function threadKeyOf(sender: string | null): string {
  if (!sender) return 'school';
  const bytes = new TextEncoder().encode(sender);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
