import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import {
  ACTION_KINDS,
  ACTION_STATES,
  AUDIT_ACTORS,
  CONSENT_KINDS,
  DATA_REQUEST_KINDS,
  DEADLINE_SOURCES,
  DIGEST_CADENCES,
  ITEM_STATUSES,
  MEMBER_ROLES,
  NOTIFICATION_CHANNELS,
  PORTALS,
  PORTAL_ACCOUNT_STATUSES,
  SECTIONS,
  SUBMISSION_KINDS,
  SUBMISSION_STATES,
  SUBSCRIPTION_STATUSES,
} from '@escola/shared';

/**
 * SPEC §6. Every child-content table carries `family_id` (denormalised where needed) so that
 * Postgres RLS can scope rows with a single `app.family_id` session variable.
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const stamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};
const familyRef = () =>
  uuid('family_id')
    .notNull()
    .references(() => families.id, { onDelete: 'cascade' });

export const subscriptionStatus = pgEnum('subscription_status', SUBSCRIPTION_STATUSES);
export const memberRole = pgEnum('member_role', MEMBER_ROLES);
export const portalKind = pgEnum('portal', PORTALS);
export const portalAccountStatus = pgEnum('portal_account_status', PORTAL_ACCOUNT_STATUSES);
export const sectionEnum = pgEnum('section', SECTIONS);
export const itemStatus = pgEnum('item_status', ITEM_STATUSES);
export const actionKind = pgEnum('action_kind', ACTION_KINDS);
export const actionState = pgEnum('action_state', ACTION_STATES);
export const deadlineSource = pgEnum('deadline_source', DEADLINE_SOURCES);
export const submissionKind = pgEnum('submission_kind', SUBMISSION_KINDS);
export const submissionState = pgEnum('submission_state', SUBMISSION_STATES);
export const auditActor = pgEnum('audit_actor', AUDIT_ACTORS);
export const notificationChannel = pgEnum('notification_channel', NOTIFICATION_CHANNELS);
export const digestCadence = pgEnum('digest_cadence', DIGEST_CADENCES);
export const consentKind = pgEnum('consent_kind', CONSENT_KINDS);
export const dataRequestKind = pgEnum('data_request_kind', DATA_REQUEST_KINDS);

export const users = pgTable('users', {
  id: id(),
  ...stamps,
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  locale: text('locale').notNull().default('en'),
  authProviders: jsonb('auth_providers').notNull().default({}),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const families = pgTable('families', {
  id: id(),
  ...stamps,
  name: text('name').notNull(),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id),
  subscriptionStatus: subscriptionStatus('subscription_status').notNull().default('trial'),
  revenuecatAppUserId: text('revenuecat_app_user_id'),
});

export const familyMembers = pgTable(
  'family_members',
  {
    id: id(),
    ...stamps,
    familyId: familyRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull(),
    canSubmit: boolean('can_submit').notNull().default(false),
    notificationPrefs: jsonb('notification_prefs').notNull().default({}),
  },
  (t) => [uniqueIndex('family_members_family_user').on(t.familyId, t.userId)],
);

export const portalAccounts = pgTable('portal_accounts', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  portal: portalKind('portal').notNull().default('gestib'),
  usernameHint: text('username_hint').notNull(),
  status: portalAccountStatus('status').notNull().default('active'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastErrorCode: text('last_error_code'),
  consecutiveAuthFailures: integer('consecutive_auth_failures').notNull().default(0),
  /** Bumped on every PUT credentials; the lockout guard counts failures per version. */
  credentialVersion: integer('credential_version').notNull().default(1),
  syncIntervalMin: integer('sync_interval_min').notNull().default(240),
});

export const credentials = pgTable('credentials', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  portalAccountId: uuid('portal_account_id')
    .notNull()
    .unique()
    .references(() => portalAccounts.id, { onDelete: 'cascade' }),
  ciphertext: bytea('ciphertext').notNull(),
  iv: bytea('iv').notNull(),
  authTag: bytea('auth_tag').notNull(),
  wrappedDek: bytea('wrapped_dek').notNull(),
  kmsKeyId: text('kms_key_id').notNull(),
  keyVersion: integer('key_version').notNull(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
});

export const portalSessions = pgTable('portal_sessions', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  portalAccountId: uuid('portal_account_id')
    .notNull()
    .references(() => portalAccounts.id, { onDelete: 'cascade' }),
  encryptedStorageState: bytea('encrypted_storage_state').notNull(),
  iv: bytea('iv').notNull(),
  authTag: bytea('auth_tag').notNull(),
  wrappedDek: bytea('wrapped_dek').notNull(),
  kmsKeyId: text('kms_key_id').notNull(),
  keyVersion: integer('key_version').notNull(),
  expiresAtEstimate: timestamp('expires_at_estimate', { withTimezone: true }),
  invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
});

export const children = pgTable('children', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  portalAccountId: uuid('portal_account_id')
    .notNull()
    .references(() => portalAccounts.id, { onDelete: 'cascade' }),
  portalChildRef: text('portal_child_ref').notNull(),
  displayName: text('display_name').notNull(),
  schoolName: text('school_name'),
  classLabel: text('class_label'),
  colour: text('colour'),
});

export const items = pgTable(
  'items',
  {
    id: id(),
    ...stamps,
    familyId: familyRef(),
    portalAccountId: uuid('portal_account_id')
      .notNull()
      .references(() => portalAccounts.id, { onDelete: 'cascade' }),
    childId: uuid('child_id').references(() => children.id, { onDelete: 'cascade' }),
    section: sectionEnum('section').notNull(),
    portalItemRef: text('portal_item_ref').notNull(),
    contentHash: text('content_hash').notNull(),
    originalTitle: text('original_title').notNull(),
    originalBodyHtml: text('original_body_html').notNull(),
    originalBodyText: text('original_body_text').notNull(),
    originalLang: text('original_lang'),
    sender: text('sender'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    rawSnapshotKey: text('raw_snapshot_key'),
    /** Deadline text as shown by the portal, if it has a dedicated field. */
    deadlineRaw: text('deadline_raw'),
    /** Set once the enrich job has translated/classified this version of the item. */
    enrichedHash: text('enriched_hash'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    isReadBy: jsonb('is_read_by').notNull().default({}),
    status: itemStatus('status').notNull().default('new'),
  },
  (t) => [
    // SPEC §8.3 diff key
    uniqueIndex('items_diff_key').on(t.portalAccountId, t.section, t.portalItemRef),
    index('items_feed').on(t.familyId, t.childId, t.postedAt),
  ],
);

const itemRef = () =>
  uuid('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' });

export const itemTranslations = pgTable(
  'item_translations',
  {
    id: id(),
    ...stamps,
    familyId: familyRef(),
    itemId: itemRef(),
    lang: text('lang').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    summary: text('summary').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    qualityFlags: jsonb('quality_flags').notNull().default([]),
  },
  (t) => [uniqueIndex('item_translations_item_lang').on(t.itemId, t.lang)],
);

export const itemActions = pgTable('item_actions', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  itemId: itemRef(),
  kind: actionKind('kind').notNull(),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }),
  deadlineSource: deadlineSource('deadline_source'),
  confidence: real('confidence').notNull().default(0),
  state: actionState('state').notNull().default('open'),
});

export const attachments = pgTable('attachments', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  itemId: itemRef(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  s3Key: text('s3_key').notNull(),
  portalUrlRef: bytea('portal_url_ref'),
  translatedSummary: text('translated_summary'),
});

export const calendarEntries = pgTable('calendar_entries', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  childId: uuid('child_id').references(() => children.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
  titleOriginal: text('title_original').notNull(),
  titleTranslated: text('title_translated'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  allDay: boolean('all_day').notNull().default(false),
  kind: text('kind').notNull(),
});

export const submissions = pgTable('submissions', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  childId: uuid('child_id')
    .notNull()
    .references(() => children.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
  kind: submissionKind('kind').notNull(),
  userInput: jsonb('user_input').notNull(),
  userLang: text('user_lang').notNull(),
  draftOriginal: text('draft_original'),
  payload: jsonb('payload'),
  files: jsonb('files').notNull().default([]),
  state: submissionState('state').notNull().default('draft'),
  errorCode: text('error_code'),
  attempts: integer('attempts').notNull().default(0),
});

export const submissionConfirmations = pgTable('submission_confirmations', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  submissionId: uuid('submission_id')
    .notNull()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
  deviceId: text('device_id'),
  ipHash: text('ip_hash'),
  previewHash: text('preview_hash').notNull(),
  consentTextVersion: text('consent_text_version'),
  /** Set when the submission is edited after confirming; an invalidated row can never queue. */
  invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
});

export const receipts = pgTable('receipts', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  submissionId: uuid('submission_id')
    .notNull()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  screenshotS3Key: text('screenshot_s3_key'),
  pageTextAfter: text('page_text_after'),
  portalConfirmationRef: text('portal_confirmation_ref'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
});

export const auditLog = pgTable('audit_log', {
  id: id(),
  ...stamps,
  actor: auditActor('actor').notNull(),
  actorId: text('actor_id'),
  familyId: uuid('family_id').references(() => families.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  target: text('target'),
  metadata: jsonb('metadata').notNull().default({}),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const devices = pgTable('devices', {
  id: id(),
  ...stamps,
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expoPushToken: text('expo_push_token').notNull().unique(),
  platform: text('platform').notNull(),
  locale: text('locale').notNull(),
  lastSeen: timestamp('last_seen', { withTimezone: true }),
});

export const notifications = pgTable('notifications', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
  channel: notificationChannel('channel').notNull(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  status: text('status').notNull().default('pending'),
  collapseKey: text('collapse_key'),
});

export const digests = pgTable('digests', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  recipientEncrypted: bytea('recipient').notNull(),
  channel: notificationChannel('channel').notNull(),
  cadence: digestCadence('cadence').notNull().default('only_when_new_daily'),
  sendTimeLocal: text('send_time_local').notNull().default('18:00'),
  active: boolean('active').notNull().default(true),
});

export const consents = pgTable('consents', {
  id: id(),
  ...stamps,
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: consentKind('kind').notNull(),
  version: text('version').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

/** [depends on model] Embedding dimension; change with EMBEDDING_MODEL and add a migration. */
export const EMBEDDING_DIM = 1024;

export const embeddings = pgTable('embeddings', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  itemId: itemRef(),
  chunkIdx: integer('chunk_idx').notNull(),
  text: text('text').notNull(),
  vector: vector('vector', { dimensions: EMBEDDING_DIM }).notNull(),
});

export const chatThreads = pgTable('chat_threads', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'),
});

export const chatMessages = pgTable('chat_messages', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  threadId: uuid('thread_id')
    .notNull()
    .references(() => chatThreads.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  citedItemIds: uuid('cited_item_ids')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
});

export const syncRuns = pgTable('sync_runs', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  portalAccountId: uuid('portal_account_id')
    .notNull()
    .references(() => portalAccounts.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  result: text('result'),
  sections: jsonb('sections').notNull().default({}),
  adapterVersion: text('adapter_version').notNull(),
});

// ---- Auth (not family-scoped; accessed only by API auth service code) ----

export const authTokens = pgTable('auth_tokens', {
  id: id(),
  ...stamps,
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: id(),
  ...stamps,
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  /** All tokens descending from one login share a chain; reuse of a rotated token revokes the chain. */
  chainId: uuid('chain_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const familyInvites = pgTable('family_invites', {
  id: id(),
  ...stamps,
  familyId: familyRef(),
  email: text('email').notNull(),
  role: memberRole('role').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  invitedByUserId: uuid('invited_by_user_id').references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
});

export const dataRequests = pgTable('data_requests', {
  id: id(),
  ...stamps,
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: dataRequestKind('kind').notNull(),
  state: text('state').notNull().default('pending'),
  fileS3Key: text('file_s3_key'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

/** Tables protected by family-scoped RLS (see migrations/0001_rls.up.sql). */
export const FAMILY_SCOPED_TABLES = [
  'family_members',
  'portal_accounts',
  'credentials',
  'portal_sessions',
  'children',
  'items',
  'item_translations',
  'item_actions',
  'attachments',
  'calendar_entries',
  'submissions',
  'submission_confirmations',
  'receipts',
  'notifications',
  'digests',
  'embeddings',
  'chat_threads',
  'chat_messages',
  'sync_runs',
] as const;
