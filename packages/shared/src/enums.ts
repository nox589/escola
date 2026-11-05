// Single source of truth for enums (SPEC §6). Used by db, api, worker and mobile.

export const LOCALES = ['en', 'es', 'ca', 'de', 'fr', 'it', 'nl', 'ru', 'uk', 'ar', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];

export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'grace', 'expired'] as const;
export const MEMBER_ROLES = ['owner', 'guardian', 'viewer'] as const;
export const PORTALS = ['gestib'] as const;
export type Portal = (typeof PORTALS)[number];

export const PORTAL_ACCOUNT_STATUSES = [
  'active',
  'needs_login_help',
  'credentials_invalid',
  'locked',
  'password_expired',
  'paused',
  'disabled',
] as const;
export type PortalAccountStatus = (typeof PORTAL_ACCOUNT_STATUSES)[number];

export const SECTIONS = [
  'message',
  'circular',
  'authorisation',
  'notification',
  'calendar_event',
  'timetable',
  'activity',
  'attendance',
  'grade',
  'partial_grade',
  'assessment',
  'questionnaire',
  'survey',
  'meeting',
  'other',
] as const;
export type Section = (typeof SECTIONS)[number];

export const ITEM_STATUSES = ['new', 'seen', 'archived'] as const;

export const ACTION_KINDS = [
  'reply',
  'consent',
  'justify_absence',
  'upload_document',
  'answer_survey',
  'book_meeting',
  'pay',
  'read_only_external',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_STATES = ['open', 'done_in_app', 'done_elsewhere', 'expired', 'dismissed'] as const;
export const DEADLINE_SOURCES = ['parsed', 'llm', 'portal_field'] as const;

export const SUBMISSION_KINDS = [
  'reply_message',
  'justify_absence',
  'authorisation',
  'upload_document',
  'answer_survey',
  'request_meeting',
  'new_message',
] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

export const SUBMISSION_STATES = [
  'draft',
  'awaiting_confirmation',
  'confirmed',
  'queued',
  'submitting',
  'verifying',
  'succeeded',
  'failed',
  'needs_manual',
] as const;
export type SubmissionState = (typeof SUBMISSION_STATES)[number];

export const AUDIT_ACTORS = ['user', 'worker', 'system', 'admin'] as const;
export const NOTIFICATION_CHANNELS = ['push', 'email', 'whatsapp'] as const;
export const DIGEST_CADENCES = ['only_when_new_daily', 'weekly'] as const;
export const CONSENT_KINDS = [
  'tos',
  'privacy',
  'mandate_read',
  'mandate_submit',
  'ai_processing',
  'marketing',
] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];
export const DATA_REQUEST_KINDS = ['export', 'delete'] as const;

export const LOGIN_FAILURE_CODES = [
  'INVALID_CREDENTIALS',
  'PASSWORD_EXPIRED',
  'FORCED_PASSWORD_CHANGE',
  'ACCOUNT_LOCKED',
  'CAPTCHA',
  'MFA_REQUIRED',
  'PORTAL_DOWN',
  'UNKNOWN_PAGE',
] as const;
export type LoginFailureCode = (typeof LOGIN_FAILURE_CODES)[number];

/** GestIB section slugs observed under /xestibback/families/ (SPEC §2). Known, not invented. */
export const GESTIB_SECTION_SLUGS = {
  home: null,
  missatges: 'message',
  circulars: 'circular',
  autoritzacions: 'authorisation',
  notificacions: 'notification',
  calendariEscolar: 'calendar_event',
  horari: 'timetable',
  activitats: 'activity',
  assistencia: 'attendance',
  qualificacions: 'grade',
  notesParcials: 'partial_grade',
  valoracions: 'assessment',
} as const satisfies Record<string, Section | null>;
export type GestibSlug = keyof typeof GESTIB_SECTION_SLUGS;
