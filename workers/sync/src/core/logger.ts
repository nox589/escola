import pino from 'pino';
import { PINO_REDACT_PATHS, redact } from '@escola/shared';

/** The only logger the worker may use (console.* is lint-banned). Golden rule 4. */
const base = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: PINO_REDACT_PATHS, censor: '[REDACTED]' },
});

export const log = {
  info: (obj: object, msg?: string) => base.info(redact(obj), msg),
  warn: (obj: object, msg?: string) => base.warn(redact(obj), msg),
  error: (obj: object, msg?: string) => base.error(redact(obj), msg),
  debug: (obj: object, msg?: string) => base.debug(redact(obj), msg),
};
