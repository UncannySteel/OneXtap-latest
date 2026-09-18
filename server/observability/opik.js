/**
 * Opik tracing — a total, optional wrapper.
 *
 * ═══ THE ONE RULE ═══
 *
 * Tracing may never break a request. Observability is the thing you add to
 * find out why production is sad; an observability layer that can itself make
 * production sad has negative value. So:
 *
 *   - Every call into the SDK goes through attempt(), which swallows and logs
 *     at debug. A throw from inside Opik stops at this file.
 *   - With OPIK_API_KEY unset, NOTHING here runs beyond a string check. The
 *     SDK is not even loaded (see LAZY LOAD below), so an unconfigured deploy
 *     pays zero cold-start cost and behaves byte-for-byte as it did before
 *     this file existed.
 *   - A broken Opik config (bad URL, bad workspace, constructor throw) warns
 *     once and then degrades to no tracing — permanently, for the life of the
 *     process. It never degrades to a broken server.
 *
 * ═══ NULL-SAFE HANDLES ═══
 *
 * startTrace() never returns null. It returns a TraceHandle with the same
 * shape whether tracing is on or off, so call sites never grow `if (trace)`
 * around every span. That branch is the thing that rots: someone adds a span
 * inside an `if`, the shape drifts, and the instrumentation only works in the
 * configuration nobody runs locally. One shape, always.
 *
 *   const trace = startTrace({ name, input });   // never null
 *   const span  = trace.span({ name, type });    // never null, nestable
 *   span.update({ output }).end();               // chainable, never throws
 *
 * When disabled, every method returns the same inert frozen handle. No
 * allocation, no branching at the call site.
 *
 * ═══ LAZY LOAD ═══
 *
 * The SDK is pulled in with createRequire() at first use rather than a
 * top-level `import`, for two reasons: an unconfigured deploy should not pay
 * its module-evaluation cost on every cold start, and "zero Opik code runs
 * without a key" should be literally true rather than nearly true.
 *
 * NOTE ON SpanType: opik@2.x exports its enum as `OpikSpanType`, not
 * `SpanType`. The .d.ts lists both, but only the former exists at runtime when
 * the module is loaded — this is verified, do not "fix" it back to importing
 * `SpanType`. The values are plain strings the API accepts verbatim, so the
 * mirror below is exported instead; that keeps callers from importing the SDK
 * (and defeating the lazy load) just to name a span type.
 *
 * ═══ SERVER ONLY ═══
 *
 * OPIK_API_KEY is a credential. It lives in server/.env and is read through
 * process.env here. It must never be renamed to VITE_OPIK_API_KEY: anything
 * VITE_* is inlined into the shipped browser bundle.
 */
import { createRequire } from 'node:module';
import { log } from '../logger.js';

const opikLog = log.child('opik');
const requireCjs = createRequire(import.meta.url);

/**
 * A trace or span handle. The one shape this module hands out.
 *
 * Both the live wrapper and the inert singleton implement exactly this, and a
 * test asserts they expose the same keys — the moment they diverge, call sites
 * start needing to know which one they hold, which is the `if (trace)` problem
 * wearing a different hat.
 *
 * @typedef  {object} TraceHandle
 * @property {string|null} id      Backend id when tracing is on, null when off.
 * @property {(options?: object) => TraceHandle} span   Opens a child span.
 * @property {(patch?: object)   => TraceHandle} update Sets output/metadata.
 * @property {() => TraceHandle}                 end    Closes the node.
 */

/**
 * Span kinds, mirrored from the SDK's OpikSpanType.
 *
 * These are the literal strings the API stores, so a local copy is safe and
 * lets ingest.js name span types without loading the SDK. See NOTE ON SpanType
 * in the header for why this is a mirror and not a re-export.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SpanType = Object.freeze({
  General: 'general',
  Tool: 'tool',
  Llm: 'llm',
  Guardrail: 'guardrail',
});

/**
 * How long flushTracing() will wait before giving up on a flush.
 *
 * On Vercel the function can be frozen the instant the response is written, so
 * anything still sitting in the SDK's batch queue is simply lost — which is
 * why the flush has to happen BEFORE we respond, not after. But a flush that
 * happens before the response is, by construction, part of the request's
 * latency. An Opik endpoint that has gone slow must not become the latency
 * floor of every ingest run, so the wait is bounded and a miss costs us
 * spans, not a timeout.
 *
 * 2s is the largest number that is still invisible next to a 45-second ingest
 * budget; a healthy flush of a few hundred spans finishes in tens of ms, so
 * reaching this bound already means the endpoint is unwell.
 */
export const MAX_FLUSH_MS = 2000;

/**
 * Opik Cloud's API base. The SDK carries this same value as its default; we
 * restate it because we now always pass apiUrl explicitly — see getOpikClient.
 */
const OPIK_CLOUD_API_URL = 'https://www.comet.com/opik/api';

/**
 * Default cap on a single string in a span payload.
 *
 * Sized to keep a job description or a prompt preview readable in the Opik UI
 * while making it impossible for one resume-sized field to turn a batch of
 * spans into a multi-megabyte upload. A call site that wants a tighter cap
 * passes `maxChars`.
 */
const DEFAULT_MAX_CHARS = 2000;

/**
 * Cap on array items — and on a trace's tag list.
 *
 * One adapter page is ~50 listings, so a capped array still shows a whole
 * page's worth of shape. Past that a span is storing data rather than
 * describing it, and the count in the `…(+N more)` tail is the part that
 * actually gets read.
 */
const MAX_ARRAY_ITEMS = 50;

/**
 * Cap on nesting depth.
 *
 * Our own deepest payload is four levels (trace → source → page → db output),
 * so this bound is not for our shapes: it is for a hostile or accidentally
 * self-referential value that the cycle check cannot catch, such as a
 * proxy that manufactures a fresh child object on every property read.
 */
const MAX_DEPTH = 6;

/**
 * Cap on the SDK error text we log.
 *
 * Long enough for a real message ("401 Unauthorized", "getaddrinfo ENOTFOUND"),
 * short enough that an SDK that stuffs a stack trace into `message` cannot
 * flood a log drain one swallowed call at a time.
 */
const MAX_REASON_CHARS = 200;

/**
 * Keys whose values are replaced with '[secret]' before anything is sent.
 *
 * NOT A PII FILTER — read this before assuming it is one. A later batch
 * deliberately sends resume and profile text to Opik so prompt quality can be
 * evaluated against real inputs; that is a made decision, not an oversight.
 * The job of this list is narrower and absolute: credentials must never reach
 * a third-party trace store, no matter what a caller passes.
 */
const SECRET_KEY =
  /^(api_?key|apikey|token|access_?token|refresh_?token|id_?token|authorization|auth|bearer|jwt|password|passwd|pwd|secret|client_?secret|service_?role_?key|anon_?key|webhook_?key|signature|cookie|session)$/i;

// ------------------------------------------------------------------
// Client
// ------------------------------------------------------------------
let cachedClient = null;
let clientResolved = false;

/**
 * Whether tracing should do anything at all.
 *
 * Read at call time, never cached: tests mutate process.env, and a serverless
 * runtime can hand us a different environment than the one at module load.
 *
 * @returns {boolean} true only when OPIK_API_KEY is a non-empty string.
 */
export function isTracingEnabled() {
  const key = process.env.OPIK_API_KEY;
  return typeof key === 'string' && key.trim() !== '';
}

/**
 * The lazily constructed Opik client.
 *
 * @returns {object|null} null whenever tracing is disabled or the SDK could
 *   not be constructed. Callers should prefer startTrace(), which turns that
 *   null into an inert handle.
 */
export function getOpikClient() {
  if (!isTracingEnabled()) return null;
  if (clientResolved) return cachedClient;

  // Latched BEFORE the construction attempt, so a constructor that throws is
  // not retried on every subsequent span — and so the warning below is emitted
  // exactly once. A misconfigured Opik degrades to no tracing for the life of
  // the process, never to a per-request retry storm against an endpoint that
  // is already refusing us.
  clientResolved = true;

  // Not routed through attempt(): this is the one failure worth more than a
  // debug line, because it means no trace will ever arrive and nobody would
  // otherwise go looking.
  try {
    const { Opik } = requireCjs('opik');
    const options = {
      apiKey: process.env.OPIK_API_KEY,
      projectName: process.env.OPIK_PROJECT_NAME || 'onextap',
      workspaceName: process.env.OPIK_WORKSPACE || 'default',
    };
    // ═══ apiUrl IS ALWAYS PASSED, EVEN FOR OPIK CLOUD ═══
    //
    // The obvious version of this sets apiUrl only for self-hosted installs and
    // lets Opik Cloud fall through to the SDK's own default. That is what this
    // did, and it meant tracing was silently off for the life of the deploy.
    //
    // The SDK imports `dotenv/config` itself, so it re-reads the same .env we
    // did and builds its own config from process.env — and it strips only
    // `undefined`, not ''. A line reading `OPIK_URL_OVERRIDE=` with nothing
    // after it therefore does not mean "unset": it overwrites the SDK's own
    // default with an empty string, and the constructor throws
    // "OPIK_URL_OVERRIDE is not set" — naming the variable that IS set as the
    // one that is not. Our guard below never sees it, because the SDK's read
    // happens independently of the options we pass.
    //
    // So resolve it here and always pass a concrete value. The SDK's env read
    // cannot then contribute anything, and an empty line in a .env is inert
    // instead of load-bearing.
    const urlOverride = process.env.OPIK_URL_OVERRIDE;
    options.apiUrl =
      typeof urlOverride === 'string' && urlOverride.trim() !== ''
        ? urlOverride.trim()
        : OPIK_CLOUD_API_URL;
    cachedClient = new Opik(options);
  } catch (err) {
    cachedClient = null;
    // warn, not error: the server is fine, we just lost observability.
    opikLog.warn('tracing disabled — client could not be created', {
      errName: err?.name,
      reason: String(err?.message || err).slice(0, MAX_REASON_CHARS),
    });
  }

  return cachedClient;
}

// ------------------------------------------------------------------
// Handles
// ------------------------------------------------------------------
/**
 * The shared inert handle. Disabled tracing allocates nothing.
 *
 * @type {TraceHandle}
 */
const INERT_HANDLE = (() => {
  const handle = {
    id: null,
    span: () => handle,
    update: () => handle,
    end: () => handle,
  };
  return Object.freeze(handle);
})();

/**
 * Record something the SDK threw at us.
 *
 * debug, not warn: a trace store that is misbehaving should not turn every
 * request into a log line at the level people alert on.
 *
 * The field is `errName` rather than `name` on purpose — server/logger.js
 * redacts `name` as PII, which would blank out the one field that identifies
 * the failure.
 *
 * @param {string}  where Which call failed, e.g. 'span'.
 * @param {unknown} err   Whatever was thrown.
 * @returns {void}
 */
function swallow(where, err) {
  try {
    opikLog.debug(`tracing call failed: ${where}`, {
      errName: err?.name,
      reason: String(err?.message || err).slice(0, MAX_REASON_CHARS),
    });
  } catch {
    // A logger that throws must not take the request with it either.
  }
}

/**
 * Run one SDK call behind the swallow barrier.
 *
 * Every entry point into the SDK goes through here, so THE ONE RULE is a
 * single function to audit rather than six try/catch blocks that have to stay
 * in step with each other.
 *
 * @template T
 * @param {string}   where      Label for the debug line, e.g. 'span'.
 * @param {() => T}  fn         The SDK call.
 * @param {T}        [fallback] Returned when fn throws.
 * @returns {T|undefined} fn's result, or fallback.
 */
function attempt(where, fn, fallback) {
  try {
    return fn();
  } catch (err) {
    swallow(where, err);
    return fallback;
  }
}

/**
 * Build the options object the SDK's trace() and span() constructors take.
 *
 * Shared so the two node kinds cannot drift in how they coerce a name, redact
 * a payload, or decide whether a key is present at all. A key the caller did
 * not supply is omitted rather than sent as undefined: the SDK persists the
 * fields it is given, and an explicit `metadata: undefined` is not the same
 * row as no metadata.
 *
 * @param {unknown} options Whatever the call site passed; junk is tolerated.
 * @param {'trace'|'span'} kind Which constructor this is for. A span carries a
 *   type and no tags; a trace carries tags and no type.
 * @returns {object} Ready to hand to the SDK.
 */
function nodeOptions(options, kind) {
  const source = options && typeof options === 'object' ? options : {};
  const { name, type, input, metadata, tags } = source;
  const isSpan = kind === 'span';

  const body = { name: String(name || (isSpan ? 'span' : 'trace')) };
  if (isSpan) body.type = typeof type === 'string' ? type : SpanType.General;
  body.input = toPayload(input);
  if (metadata !== undefined) body.metadata = toPayload(metadata);
  if (!isSpan && Array.isArray(tags)) {
    body.tags = tags.slice(0, MAX_ARRAY_ITEMS).map((tag) => String(tag));
  }
  return body;
}

/**
 * Wrap a live SDK trace/span node in the null-safe handle shape.
 *
 * @param {object|null|undefined} node An Opik Trace or Span.
 * @returns {TraceHandle} A handle. Always — a missing or non-object node
 *   degrades to the inert singleton rather than to null.
 */
function wrapNode(node) {
  if (!node || typeof node !== 'object') return INERT_HANDLE;

  /** @type {TraceHandle} */
  const handle = {
    id: node?.data?.id ?? node?.id ?? null,

    span(options) {
      return attempt('span', () => wrapNode(node.span(nodeOptions(options, 'span'))), INERT_HANDLE);
    },

    update(patch) {
      attempt('update', () => {
        const source = patch && typeof patch === 'object' ? patch : {};
        const body = {};
        if (source.output !== undefined) body.output = toPayload(source.output);
        if (source.metadata !== undefined) body.metadata = toPayload(source.metadata);
        if (Object.keys(body).length) node.update(body);
      });
      return handle;
    },

    end() {
      attempt('end', () => node.end());
      return handle;
    },
  };

  return handle;
}

/**
 * Open a root trace.
 *
 * @param {object}   [options]
 * @param {string}   [options.name]     Trace name, e.g. 'job_ingest'.
 * @param {unknown}  [options.input]    Redacted before it leaves the process.
 * @param {unknown}  [options.metadata] Same.
 * @param {string[]} [options.tags]     Capped at MAX_ARRAY_ITEMS.
 * @returns {TraceHandle} Never null. `id` is the trace id when tracing is on,
 *   null when it is off.
 */
export function startTrace(options = {}) {
  const client = getOpikClient();
  if (!client) return INERT_HANDLE;

  return attempt('trace', () => wrapNode(client.trace(nodeOptions(options, 'trace'))), INERT_HANDLE);
}

/**
 * Push whatever is batched in the SDK to the backend, bounded by MAX_FLUSH_MS.
 *
 * Resolves in every case — flush failure, flush rejection, flush hang. A
 * caller awaiting this is awaiting "we tried", not "it landed".
 *
 * @returns {Promise<void>}
 */
export async function flushTracing() {
  const client = getOpikClient();
  if (!client) return;

  let timer = null;
  try {
    // The catch is attached to the flush promise itself, not just to the
    // race: if the timeout wins and the flush rejects afterwards, an
    // un-caught rejection here would be an unhandledRejection on a process
    // whose whole point was that tracing cannot break it.
    const flushed = Promise.resolve()
      .then(() => client.flush())
      .catch((err) => { swallow('flush', err); });

    const timedOut = new Promise((resolve) => {
      timer = setTimeout(() => {
        swallow('flush', new Error(`flush exceeded ${MAX_FLUSH_MS}ms`));
        resolve();
      }, MAX_FLUSH_MS);
      // Deliberately NOT unref()'d. An unref'd timer lets the event loop exit
      // while it is pending, so if a hung flush is the only outstanding work
      // this promise would never settle and the await below would deadlock —
      // which is precisely the failure the bound exists to prevent. It is
      // cleared in the finally the moment the flush wins, so it holds the loop
      // for at most MAX_FLUSH_MS.
    });

    await Promise.race([flushed, timedOut]);
  } catch (err) {
    swallow('flush', err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ------------------------------------------------------------------
// Redaction
// ------------------------------------------------------------------
/**
 * Make an arbitrary value safe and small enough to attach to a span.
 *
 * Total by construction: null, undefined, numbers, functions, circular graphs,
 * megabyte buffers and 10MB strings all return something rather than throwing.
 * Instrumentation that can throw on its own input is the same bug as
 * instrumentation that can throw on the SDK.
 *
 * Again: this is NOT a PII filter — see SECRET_KEY above. It stops
 * credentials, and it stops payload size from getting silly. Profile text
 * reaching Opik is a product decision made elsewhere.
 *
 * @param {unknown} value
 * @param {{maxChars?: number}} [options] A non-object, a missing maxChars and
 *   a nonsensical one all fall back to DEFAULT_MAX_CHARS.
 * @returns {unknown} A structurally similar value, safe to serialize.
 */
export function redactForTrace(value, options = {}) {
  const rawMax = Number(options?.maxChars);
  const maxChars = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : DEFAULT_MAX_CHARS;
  try {
    return walk(value, maxChars, 0, new WeakSet());
  } catch {
    return '[unredactable]';
  }
}

/**
 * Recursive worker behind redactForTrace().
 *
 * @param {unknown}  value
 * @param {number}   maxChars Per-string cap.
 * @param {number}   depth    Current nesting depth.
 * @param {WeakSet}  seen     Objects already visited on this walk.
 * @returns {unknown}
 */
function walk(value, maxChars, depth, seen) {
  if (value === null || value === undefined) return value;

  const type = typeof value;

  if (type === 'string') {
    return value.length > maxChars
      ? `${value.slice(0, maxChars)}…(+${value.length - maxChars} chars)`
      : value;
  }
  if (type === 'number') return Number.isFinite(value) ? value : String(value);
  if (type === 'boolean') return value;
  if (type === 'bigint') return String(value);
  if (type === 'function') return '[function]';
  if (type === 'symbol') return String(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: walk(String(value.message ?? ''), maxChars, depth + 1, seen),
    };
  }
  if (value instanceof Date) return value.toISOString();

  // Binary is summarised, never walked. A Buffer or TypedArray is not an
  // Array, so without this it falls through to the object branch and expands
  // into one key PER BYTE — a 1MB request body becomes a million-key object,
  // and MAX_ARRAY_ITEMS never gets a chance to cap it.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `[${value?.constructor?.name || 'binary'} ${value.byteLength} bytes]`;
  }

  if (depth >= MAX_DEPTH) return '[depth limit]';

  // One WeakSet for the whole walk: a value that appears twice as a sibling is
  // not a cycle, but reporting it as one is harmless and the alternative
  // (tracking the current path) costs more than it is worth here.
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY_ITEMS).map((v) => walk(v, maxChars, depth + 1, seen));
    return value.length > MAX_ARRAY_ITEMS
      ? [...head, `…(+${value.length - MAX_ARRAY_ITEMS} more)`]
      : head;
  }

  if (value instanceof Map) return walk(Object.fromEntries(value), maxChars, depth, seen);
  if (value instanceof Set) return walk([...value], maxChars, depth, seen);

  // Keys first, then each value inside its own try. Object.entries() would
  // read every property up front, so a single throwing getter would take the
  // whole payload down to '[unredactable]' and the span would lose the context
  // it was added to capture. One hostile property costs that property.
  let keys;
  try {
    keys = Object.keys(value);
  } catch {
    return '[unreadable]';
  }

  const out = {};
  for (const k of keys) {
    if (SECRET_KEY.test(k)) {
      out[k] = '[secret]';
      continue;
    }
    try {
      out[k] = walk(value[k], maxChars, depth + 1, seen);
    } catch {
      out[k] = '[unreadable]';
    }
  }
  return out;
}

/**
 * Coerce anything into the object shape Opik expects for input/output, with
 * redaction applied.
 *
 * Redacting here rather than at each call site is deliberate: "remember to
 * redact" is a rule that holds until the day somebody adds a span in a hurry.
 * Call sites may still pre-redact with a tighter maxChars.
 *
 * Scalars and arrays are boxed as `{ value: … }` because the SDK's input and
 * output fields are records, not free-form JSON.
 *
 * @param {unknown} value
 * @returns {object} Always a plain object.
 */
function toPayload(value) {
  const safe = redactForTrace(value);
  if (safe && typeof safe === 'object' && !Array.isArray(safe)) return safe;
  return { value: safe === undefined ? null : safe };
}

// ------------------------------------------------------------------
// Test seam
// ------------------------------------------------------------------
/**
 * Replace the cached client. TEST ONLY — but not dead code: this is the
 * supported seam, and removing it removes the only coverage the enabled path
 * has.
 *
 * Everything interesting in this file — that a throwing SDK degrades to inert
 * handles, that a hung flush is bounded, that a trace forwards with the right
 * shape — lives on the path taken only when a client exists. Injecting a
 * stand-in is what lets that path be exercised with no OPIK_API_KEY, no Opik
 * account and no network, in a suite where every other test asserts the
 * opposite (that no key means no SDK load at all).
 *
 * @param {object|null} client A stand-in with trace()/flush(), or null to
 *   clear the cache so the next call reconstructs.
 * @returns {void}
 */
export function __setOpikClientForTests(client) {
  cachedClient = client ?? null;
  clientResolved = client != null;
}
