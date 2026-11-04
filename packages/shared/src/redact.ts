// Golden rule 4: never log secrets or personal data. Everything that logs goes through redact().

const SECRET_KEYS = new Set([
  'password',
  'pass',
  'pwd',
  'username',
  'credentials',
  'cookie',
  'cookies',
  'set-cookie',
  'authorization',
  'storagestate',
  'storage_state',
  'encrypted_storage_state',
  'dek',
  'plaintext',
  'ciphertext',
  'wrapped_dek',
  'token',
  'refresh_token',
  'access_token',
  'expo_push_token',
  'body',
  'bodyhtml',
  'bodytext',
  'original_body',
  'user_input',
  'draft_original',
  'email',
  'phone',
]);

export const REDACTED = '[REDACTED]';

/** Pino-compatible redaction paths, derived from the same list. */
export const PINO_REDACT_PATHS = [...SECRET_KEYS].flatMap((k) => [k, `*.${k}`, `*.*.${k}`]);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Deep-copies a value, replacing secret/personal fields and email addresses in strings. */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return REDACTED as unknown as T;
  if (value == null) return value;
  if (typeof value === 'string') return value.replace(EMAIL_RE, '[EMAIL]') as unknown as T;
  if (value instanceof Uint8Array) return REDACTED as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.has(k.toLowerCase()) ? REDACTED : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}
