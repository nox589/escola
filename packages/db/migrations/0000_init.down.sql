DROP TABLE IF EXISTS "attachments", "audit_log", "calendar_entries", "chat_messages", "chat_threads", "children",
  "consents", "credentials", "data_requests", "devices", "digests", "embeddings", "families", "family_members",
  "item_actions", "item_translations", "items", "notifications", "portal_accounts", "portal_sessions", "receipts",
  "submission_confirmations", "submissions", "sync_runs", "users" CASCADE;

DROP TYPE IF EXISTS "public"."action_kind", "public"."action_state", "public"."audit_actor", "public"."consent_kind",
  "public"."data_request_kind", "public"."deadline_source", "public"."digest_cadence", "public"."item_status",
  "public"."member_role", "public"."notification_channel", "public"."portal_account_status", "public"."portal",
  "public"."section", "public"."submission_kind", "public"."submission_state", "public"."subscription_status";
