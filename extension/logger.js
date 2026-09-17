/**
 * Logging for the MV3 service worker.
 *
 * Separate from src/logger.js on purpose. The service worker imports nothing
 * from src/ (see docs/repo-structure.md): it has no `window`, no DOM, and a
 * lifecycle of its own — Chrome terminates and restarts it freely, so any
 * in-memory buffer here is short-lived by nature.
 *
 * The redaction key lists mirror src/logger.js and server/logger.js. A change
 * to one usually belongs in the others.
 *
 * Level: VITE_LOG_LEVEL, else `warn` in a production build / `debug` in dev.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const configured = String(import.meta.env?.VITE_LOG_LEVEL || '').toLowerCase();
const LEVEL = configured in LEVELS
  ? LEVELS[configured]
  : (import.meta.env?.PROD ? LEVELS.warn : LEVELS.debug);

const SECRET_KEY =
  /^(authorization|auth|token|access_?token|refresh_?token|id_?token|jwt|bearer|password|secret|api_?key|apikey|anon_?key|signature|cookie|session|[a-z0-9_]*_key)$/i;

const PII_KEY =
  /^(email|e_?mail|phone|mobile|tel|address|street|city|state|zip|postal_?code|country|ssn|dob|date_?of_?birth|first_?name|last_?name|full_?name|display_?name|name|resume|resume_?text|file_?data|cover_?letter|coverletter|answer|answers|vault|profile|user_?profile|job_?description)$/i;

// A bare `name` key is in that list on purpose, and it is a trap worth knowing
// about: profile labels, cover-letter template names and certificate names are
// all stored under `name`, so redacting it is correct. The cost is that
// `log.warn(msg, { name: err.name })` prints "[redacted]" and tells you nothing.
// Log an error class as `errName`, and a source or adapter as `source`.

const MAX_STRING = 300;
const MAX_DEPTH = 3;

function serializeError(err) {
  if (!err || typeof err !== 'object') return { message: String(err) };
  return {
    name: err.name,
    message: String(err.message || '').slice(0, MAX_STRING),
    ...(typeof err.stack === 'string' ? { stack: err.stack.split('\n').slice(0, 5).join('\n') } : {}),
  };
}

function redact(value, depth = 0) {
  if (value == null) return value;
  if (value instanceof Error) return serializeError(value);

  const type = typeof value;
  if (type === 'string') {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…(+${value.length - MAX_STRING} chars)`
      : value;
  }
  if (type === 'number' || type === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[depth limit]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));

  if (type === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) out[k] = '[secret]';
      else if (PII_KEY.test(k)) out[k] = '[redacted]';
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function emit(level, message, rest) {
  if (LEVELS[level] > LEVEL) return;

  const fields = {};
  for (const item of rest) {
    if (item instanceof Error) fields.err = serializeError(item);
    else if (item && typeof item === 'object') Object.assign(fields, redact(item));
    else if (item !== undefined) fields.detail = redact(item);
  }

  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (Object.keys(fields).length) sink('[Onextap:sw]', message, fields);
  else sink('[Onextap:sw]', message);
}

export const log = {
  error: (msg, ...rest) => emit('error', msg, rest),
  warn: (msg, ...rest) => emit('warn', msg, rest),
  info: (msg, ...rest) => emit('info', msg, rest),
  debug: (msg, ...rest) => emit('debug', msg, rest),
};

/**
 * Service-worker equivalent of window error handlers. Without these, a
 * rejected promise in the worker is invisible — the worker just stops.
 */
export function installWorkerErrorHandlers() {
  self.addEventListener('error', (event) => {
    log.error('uncaught error in service worker', event.error || event.message);
  });
  self.addEventListener('unhandledrejection', (event) => {
    log.error('unhandled promise rejection in service worker', event.reason);
  });
}
