import type { BrowserContext, Page } from 'playwright';
import type { LoginFailureCode, Section, SubmissionKind, TimetableSession } from '@escola/shared';

/** SPEC §8.1. Any future regional portal (itaca, raices, xtec...) implements this interface. */
export interface PortalAdapter {
  id: 'gestib' | string;
  version: string;
  login(ctx: BrowserContext, creds: Credentials): Promise<LoginResult>;
  isLoggedIn(page: Page): Promise<boolean>;
  /** Navigates with saved cookies; true if still authenticated (no credentials used). */
  resumeSession?(page: Page): Promise<boolean>;
  listChildren(page: Page): Promise<PortalChild[]>;
  switchChild(page: Page, child: PortalChild): Promise<void>;
  sections(): SectionReader[];
  /** Optional: the school's term calendar (holidays, non-teaching days). Read-only. */
  readSchoolCalendar?(page: Page): Promise<SchoolDay[]>;
  /** Optional: timetable, absences and agenda for the child currently selected. Read-only. */
  readChildDetails?(page: Page, child: PortalChild): Promise<ChildDetails>;
  writers(): Partial<Record<SubmissionKind, SectionWriter>>;
}

export interface Credentials {
  username: string;
  password: string;
}

export type LoginResult =
  | { ok: true; page: Page }
  | {
      ok: false;
      code: LoginFailureCode;
      detail?: string;
      /**
       * Extension to SPEC §8.1, used by the lockout guard (§8.4): true when the page could not be
       * classified with confidence, so ONE retry in a fresh context is permitted. Default false.
       */
      ambiguous?: boolean;
    };

export interface PortalChild {
  ref: string;
  displayName: string;
  schoolName?: string;
  classLabel?: string;
}

export interface SectionReader {
  section: Section;
  slug: string;
  scope: 'child' | 'account';
  /** Must not mutate portal state. */
  read(page: Page, child?: PortalChild): Promise<NormalisedItem[]>;
}

export interface SubmissionPayload {
  submissionId: string;
  kind: SubmissionKind;
  itemRef?: string;
  childRef: string;
  /** Exact original-language text the parent confirmed (submissions.draft_original). */
  text: string;
  fields: Record<string, string>;
  /** Hash of what the parent saw; the writer refuses to run without it. */
  previewHash: string;
}

export interface PreparedForm {
  screenshot: Buffer;
  fieldEcho: Record<string, string>;
}
export type SubmitResult = { status: 'submitted' | 'ambiguous' | 'failed'; detail?: string };
export type VerifyResult = { verified: boolean; confirmationRef?: string; pageText?: string };

export interface SectionWriter {
  kind: SubmissionKind;
  prepare(page: Page, sub: SubmissionPayload): Promise<PreparedForm>;
  submit(page: Page, prepared: PreparedForm): Promise<SubmitResult>;
  verify(page: Page, sub: SubmissionPayload): Promise<VerifyResult>;
}

export interface NormalisedItem {
  portalRef: string;
  section: Section;
  title: string;
  bodyHtml: string;
  bodyText: string;
  sender?: string;
  postedAt?: string;
  deadlineRaw?: string;
  attachments: { name: string; download: (page: Page) => Promise<Buffer> }[];
  extra?: Record<string, unknown>;
}

export type SchoolDayType = 'holiday' | 'public_holiday' | 'local_holiday' | 'non_teaching' | 'free_choice';
export interface SchoolDay {
  /** YYYY-MM-DD */
  date: string;
  type: SchoolDayType;
}

export interface PortalAbsence {
  ref: string;
  /** YYYY-MM-DD */
  day: string;
  period: string | null;
  subject: string | null;
  kind: string;
  status: 'justified' | 'pending' | 'unjustified';
  reason: string | null;
  schoolNote: string | null;
  canJustify: boolean;
}

export interface AgendaEvent {
  ref: string;
  kind: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  place: string | null;
}

/** Each part is null when that page failed, so stored data is kept rather than wiped. */
export interface ChildDetails {
  timetable: TimetableSession[] | null;
  absences: PortalAbsence[] | null;
  agenda: AgendaEvent[] | null;
  errors: { section: string; error: string }[];
}
