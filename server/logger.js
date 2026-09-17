/**
 * Structured logging for the Onextap backend.
 *
 * No dependency — the root and server package.json files are kept in step for
 * the Vercel build, so a logging library would have to be added twice and
 * kept aligned. This is small enough not to be worth that.
 *
 * IMPORTANT: import this *after* './load-env.js' in server/index.js. It reads
 * LOG_LEVEL at module load, the same way server/supabase.js reads its keys.
 *
 * Output format:
 *   - Vercel, or LOG_FORMAT=json → one JSON object per line (log drains parse this)
 *   - anything else             → a padded human-readable line
 *
 * Levels: error < warn < info < debug. Set LOG_LEVEL to the loudest you want.
 * Default is `info` (production) / `debug` (everywhere else).
 *
 * Redaction is not optional here. Onextap's design premise is that profile
 * data never leaves the device, so a logger that dumps request bodies would
 * quietly break the product's main privacy guarantee. Every value logged goes
 * through redact() first; see SECRET_KEY / PII_KEY below.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const configuredLevel = (process.env.LOG_LEVEL || '').toLowerCase();
const LEVEL = configuredLevel in LEVELS
  ? LEVELS[configuredLevel]
  : (process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug);

const AS_JSON = !!process.env.VERCEL || process.env.LOG_FORMAT === 'json';

// ------------------------------------------------------------------
// Redaction
// ------------------------------------------------------------------
// Secrets: anything that would be a credential leak in a log drain.
const SECRET_KEY =
  /^(authorization|auth|token|access_?token|refresh_?token|id_?token|jwt|bearer|password|passwd|pwd|secret|api_?key|apikey|anon_?key|service_?role_?key|webhook_?key|signature|cookie|session|[a-z0-9_]*_key)$/i;

// PII: the profile data that is supposed to stay on the user's device.
// `userId` is deliberately NOT in here — it is the correlation key, and a
// Supabase UUID is what makes a user's bug report traceable to a log line.
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
  if (type === 'bigint') return String(value);
  if (type === 'function' || type === 'symbol') return `[${type}]`;

  if (depth >= MAX_DEPTH) return '[depth limit]';

  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1));
    return value.length > MAX_ARRAY
      ? [...head, `…(+${value.length - MAX_ARRAY} more)`]
      : head;
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

function serializeError(err) {
  if (!err || typeof err !== 'object') return { message: String(err) };
  const out = {
    name: err.name,
    message: typeof err.message === 'string' ? err.message.slice(0, MAX_STRING) : undefined,
  };
  // Supabase and fetch errors carry these; they are the useful part.
  for (const k of ['code', 'status', 'statusCode', 'details', 'hint']) {
    if (err[k] !== undefined) out[k] = redact(err[k], MAX_DEPTH - 1);
  }
  if (typeof err.stack === 'string') {
    out.stack = err.stack.split('\n').slice(0, 6).join('\n');
  }
  if (err.cause) out.cause = serializeError(err.cause);
  return out;
}

// ------------------------------------------------------------------
// Request context (correlation ids)
// ------------------------------------------------------------------
// AsyncLocalStorage is stdlib and works on Vercel. It lets a log.error() deep
// inside a route carry the request id without threading `req` through every
// call, which is what makes a user's report traceable.
const requestContext = new AsyncLocalStorage();

/** The current request's { rid, userId }, or an empty object outside a request. */
function currentContext() {
  return requestContext.getStore() || {};
}

// ------------------------------------------------------------------
// Emit
// ------------------------------------------------------------------
function emit(level, scope, message, rest) {
  if (LEVELS[level] > LEVEL) return;

  // Accept console-style varargs so existing call sites keep working:
  // an Error lands under `err`, a plain object is merged as fields, anything
  // else is appended to `detail`.
  const fields = {};
  const detail = [];
  for (const item of rest) {
    if (item instanceof Error) fields.err = serializeError(item);
    else if (item && typeof item === 'object' && !Array.isArray(item)) Object.assign(fields, redact(item));
    else if (item !== undefined) detail.push(redact(item));
  }
  if (detail.length) fields.detail = detail.length === 1 ? detail[0] : detail;

  const ctx = currentContext();
  const record = {
    ts: new Date().toISOString(),
    level,
    ...(scope ? { scope } : {}),
    msg: String(message),
    ...(ctx.rid ? { rid: ctx.rid } : {}),
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    ...fields,
  };

  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (AS_JSON) {
    sink(JSON.stringify(record));
    return;
  }

  const { ts, level: _l, msg, ...extra } = record;
  const tail = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
  sink(`${ts} ${level.toUpperCase().padEnd(5)} ${msg}${tail}`);
}

function make(scope) {
  return {
    error: (msg, ...rest) => emit('error', scope, msg, rest),
    warn: (msg, ...rest) => emit('warn', scope, msg, rest),
    info: (msg, ...rest) => emit('info', scope, msg, rest),
    debug: (msg, ...rest) => emit('debug', scope, msg, rest),
    /** A logger tagged with a sub-area, e.g. log.child('dodo'). */
    child: (childScope) => make(scope ? `${scope}:${childScope}` : childScope),
  };
}

export const log = make('');

// ------------------------------------------------------------------
// Middleware
// ------------------------------------------------------------------
/**
 * Assigns a request id, echoes it as `X-Request-Id`, and logs one line per
 * completed request. Touches neither the body nor the headers of the request
 * itself, so it is safe to mount before the raw-body webhook route.
 */
export function requestLogger(req, res, next) {
  const rid = (req.headers['x-request-id'] || randomUUID()).toString().slice(0, 36);
  const store = { rid, userId: undefined };
  req.id = rid;
  res.setHeader('X-Request-Id', rid);

  const startedAt = Date.now();

  res.on('finish', () => {
    // requireAuth sets req.userId; by `finish` it is populated if it ever will be.
    store.userId = req.userId;
    const ms = Date.now() - startedAt;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    // Query strings can carry ids; log the path only.
    emit(level, 'http', 'request', [{
      method: req.method,
      path: req.path || req.originalUrl?.split('?')[0],
      status: res.statusCode,
      ms,
    }]);
  });

  requestContext.run(store, next);
}

/**
 * Terminal Express error handler. Mount after every route.
 *
 * Without this, a throw in a route that is not already inside a try/catch
 * gets Express's default HTML stack-trace page and no log line at all.
 */
export function errorLogger(err, req, res, _next) {
  emit('error', 'http', 'unhandled route error', [err, {
    method: req.method,
    path: req.path || req.originalUrl?.split('?')[0],
  }]);

  if (res.headersSent) return;
  const status = Number(err?.status || err?.statusCode) || 500;
  res.status(status).json({
    success: false,
    error: status >= 500 ? 'Internal server error' : (err?.message || 'Request failed'),
    requestId: req.id,
  });
}

/**
 * Last-resort process handlers. Without these an unhandled rejection is a
 * silent no-op in older Node and a bare stack trace in newer.
 *
 * On Vercel the platform owns the process lifecycle, so we log and let it be.
 * Locally an uncaught exception leaves the process in an undefined state, so
 * we log and exit rather than serving from a half-dead server.
 */
export function installProcessHandlers() {
  process.on('unhandledRejection', (reason) => {
    emit('error', 'process', 'unhandled promise rejection', [reason]);
  });

  process.on('uncaughtException', (err) => {
    emit('error', 'process', 'uncaught exception', [err]);
    if (!process.env.VERCEL) {
      process.exit(1);
    }
  });
}
