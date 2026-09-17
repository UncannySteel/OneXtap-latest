/**
 * Client logging for the Onextap React app.
 *
 * Runs on both surfaces: the extension popup (chrome.* present) and the web
 * dashboard (chrome.* absent). It touches no chrome API directly, so there is
 * nothing to guard.
 *
 * Levels: error < warn < info < debug. Set VITE_LOG_LEVEL to override.
 * Default is `warn` in a production build and `debug` in dev, so a shipped
 * extension stays quiet in the user's console but still reports real failures.
 *
 * DUPLICATION NOTE: the redaction rules below mirror server/logger.js on
 * purpose. src/ and server/ must not import each other (see
 * docs/repo-structure.md), and a shared module would be new top-level
 * structure. This is the same deliberate split as the two page scrapers —
 * a change to the key lists here usually belongs there too.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const configured = String(import.meta.env?.VITE_LOG_LEVEL || '').toLowerCase();
const LEVEL = configured in LEVELS
  ? LEVELS[configured]
  : (import.meta.env?.PROD ? LEVELS.warn : LEVELS.debug);

const SECRET_KEY =
  /^(authorization|auth|token|access_?token|refresh_?token|id_?token|jwt|bearer|password|passwd|pwd|secret|api_?key|apikey|anon_?key|signature|cookie|session|[a-z0-9_]*_key)$/i;

const PII_KEY =
  /^(email|e_?mail|phone|phone_?number|mobile|tel|address|street|city|state|zip|postal_?code|country|ssn|dob|date_?of_?birth|first_?name|last_?name|full_?name|display_?name|name|resume|resume_?text|file_?data|cover_?letter|coverletter|answer|answers|vault|profile|user_?profile|job_?description|linkedin|github|portfolio|website)$/i;

// A bare `name` key is in that list on purpose, and it is a trap worth knowing
// about: profile labels, cover-letter template names and certificate names are
// all stored under `name`, so redacting it is correct. The cost is that
// `log.warn(msg, { name: err.name })` prints "[redacted]" and tells you nothing.
// Log an error class as `errName`, and a source or adapter as `source`.

const MAX_STRING = 300;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;

function serializeError(err) {
  if (!err || typeof err !== 'object') return { message: String(err) };
  const out = { name: err.name, message: String(err.message || '').slice(0, MAX_STRING) };
  for (const k of ['code', 'status', 'statusCode']) {
    if (err[k] !== undefined) out[k] = err[k];
  }
  if (typeof err.stack === 'string') out.stack = err.stack.split('\n').slice(0, 6).join('\n');
  return out;
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
  if (type === 'function' || type === 'symbol' || type === 'bigint') return `[${type}]`;
  if (depth >= MAX_DEPTH) return '[depth limit]';

  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1));
    return value.length > MAX_ARRAY ? [...head, `…(+${value.length - MAX_ARRAY} more)`] : head;
  }

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

// ------------------------------------------------------------------
// Recent-issue buffer
// ------------------------------------------------------------------
// A shipped extension gives you no access to the user's console, so warnings
// and errors are kept in a small in-memory ring. Deliberately NOT persisted:
// keeping it in memory means no redacted-but-still-personal data is written to
// disk, and it clears when the popup closes.
const MAX_BUFFER = 50;
const recent = [];

/** Recent warn/error entries, oldest first. For "copy diagnostics" style UI. */
export function getRecentIssues() {
  return recent.slice();
}

function record(entry) {
  recent.push(entry);
  if (recent.length > MAX_BUFFER) recent.shift();
}

// ------------------------------------------------------------------
// Emit
// ------------------------------------------------------------------
function emit(level, scope, message, rest) {
  if (LEVELS[level] > LEVEL) return;

  const fields = {};
  const detail = [];
  for (const item of rest) {
    if (item instanceof Error) fields.err = serializeError(item);
    else if (item && typeof item === 'object' && !Array.isArray(item)) Object.assign(fields, redact(item));
    else if (item !== undefined) detail.push(redact(item));
  }
  if (detail.length) fields.detail = detail.length === 1 ? detail[0] : detail;

  const tag = `[Onextap${scope ? `:${scope}` : ''}]`;
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  const hasFields = Object.keys(fields).length > 0;

  if (hasFields) sink(tag, message, fields);
  else sink(tag, message);

  if (level === 'error' || level === 'warn') {
    record({ ts: new Date().toISOString(), level, scope: scope || undefined, msg: String(message), ...fields });
  }
}

function make(scope) {
  return {
    error: (msg, ...rest) => emit('error', scope, msg, rest),
    warn: (msg, ...rest) => emit('warn', scope, msg, rest),
    info: (msg, ...rest) => emit('info', scope, msg, rest),
    debug: (msg, ...rest) => emit('debug', scope, msg, rest),
    child: (childScope) => make(scope ? `${scope}:${childScope}` : childScope),
  };
}

export const log = make('');

/**
 * Catches errors that never reach a try/catch: rejected promises with no
 * handler, and errors thrown outside React's render tree. Call once at
 * startup. Safe to call more than once.
 */
let installed = false;
export function installGlobalErrorHandlers() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    log.error('uncaught error', event.error || event.message, {
      source: event.filename,
      line: event.lineno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    log.error('unhandled promise rejection', event.reason);
  });

  // Reachable from the console as __onextapIssues() when debugging a report.
  window.__onextapIssues = getRecentIssues;
}
