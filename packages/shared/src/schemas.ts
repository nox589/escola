import { z } from 'zod';
import {
  ACTION_KINDS,
  ACTION_STATES,
  CONSENT_KINDS,
  LOCALES,
  MEMBER_ROLES,
  PORTALS,
  PORTAL_ACCOUNT_STATUSES,
  SECTIONS,
  SUBMISSION_KINDS,
  SUBMISSION_STATES,
} from './enums.js';

// ---- GestIB password policy (SPEC §2) ----
// 6-30 chars, starts with a letter, >=1 digit, ASCII letters/digits only (no ñ/ç/accents/symbols).
export const gestibPasswordSchema = z
  .string()
  .min(6)
  .max(30)
  .regex(/^[A-Za-z][A-Za-z0-9]*$/, 'Must start with a letter and contain only letters and digits')
  .regex(/\d/, 'Must contain at least one digit');

// ---- Requests (SPEC §7) ----
export const magicLinkRequest = z.object({ email: z.string().email() });
export const verifyRequest = z.object({ token: z.string().min(16) });
export const patchMeRequest = z.object({
  locale: z.enum(LOCALES).optional(),
  displayName: z.string().min(1).max(80).optional(),
});
export const inviteRequest = z.object({ email: z.string().email(), role: z.enum(MEMBER_ROLES) });
export const consentRequest = z.object({ kind: z.enum(CONSENT_KINDS), version: z.string().min(1) });

export const createPortalAccountRequest = z.object({
  portal: z.enum(PORTALS),
  username: z.string().min(1).max(100),
  // We do not enforce the policy on input: an existing password could predate it.
  password: z.string().min(1).max(100),
});
export const updateCredentialsRequest = createPortalAccountRequest.omit({ portal: true });

export const itemsQuery = z.object({
  child_id: z.string().uuid().optional(),
  section: z.enum(SECTIONS).optional(),
  needs_action: z.coerce.boolean().optional(),
  since: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const createSubmissionRequest = z.object({
  kind: z.enum(SUBMISSION_KINDS),
  child_id: z.string().uuid(),
  item_id: z.string().uuid().optional(),
  user_input: z.record(z.string(), z.unknown()),
  files: z.array(z.string()).max(5).default([]),
});
export const confirmSubmissionRequest = z.object({ preview_hash: z.string().regex(/^[a-f0-9]{64}$/) });

// ---- Responses ----
export const portalAccountView = z.object({
  id: z.string().uuid(),
  portal: z.enum(PORTALS),
  usernameHint: z.string(),
  status: z.enum(PORTAL_ACCOUNT_STATUSES),
  lastSyncAt: z.string().datetime().nullable(),
  lastErrorCode: z.string().nullable(),
});
export type PortalAccountView = z.infer<typeof portalAccountView>;

export const itemActionView = z.object({
  id: z.string().uuid(),
  kind: z.enum(ACTION_KINDS),
  deadlineAt: z.string().datetime().nullable(),
  confidence: z.number().min(0).max(1),
  state: z.enum(ACTION_STATES),
});

export const itemView = z.object({
  id: z.string().uuid(),
  childId: z.string().uuid().nullable(),
  section: z.enum(SECTIONS),
  // Golden rule 5: the original is always returned next to any translation.
  original: z.object({ title: z.string(), body: z.string(), lang: z.string() }),
  translation: z
    .object({ lang: z.string(), title: z.string(), body: z.string(), summary: z.string().max(140) })
    .nullable(),
  sender: z.string().nullable(),
  postedAt: z.string().datetime().nullable(),
  actions: z.array(itemActionView),
});
export type ItemView = z.infer<typeof itemView>;

export const submissionView = z.object({
  id: z.string().uuid(),
  kind: z.enum(SUBMISSION_KINDS),
  state: z.enum(SUBMISSION_STATES),
  userInput: z.record(z.string(), z.unknown()),
  draftOriginal: z.string().nullable(),
  preview: z.string().nullable(),
  previewHash: z.string().nullable(),
});
export type SubmissionView = z.infer<typeof submissionView>;
