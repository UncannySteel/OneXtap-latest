/**
 * Shared adapter plumbing.
 *
 * fetchJson() is lifted from callGemini() in server/index.js: AbortController +
 * setTimeout, cleared in a `finally`. Without the clearTimeout the timer keeps
 * the event loop alive for its full duration after a fast response, which on a
 * serverless function means paying for ten seconds of nothing.
 *
 * This module exists so that idiom — plus the status→reason mapping and the
 * body truncation — is written once instead of copied into each network
 * adapter, where the three copies would drift apart the first time one of them
 * was fixed. emptyResult() and clampPageSize() live here for the same reason:
 * they are the rest of what every adapter needs and nothing else.
 *
 * Nothing here throws. Callers translate the `error` reason into the adapter
 * contract's return shape; see the contract header in ./index.js.
 */

/** Every adapter shares this ceiling. See the budget maths in ingest.js. */
export const PER_ADAPTER_TIMEOUT_MS = 10_000;

/**
 * How much of a provider's response body reaches a log line — matching
 * callGemini()'s slice. Long enough to recognise an HTML error page or a
 * rate-limit notice, short enough that a provider returning a megabyte of
 * markup cannot flood a log drain.
 */
const MAX_BODY_LOG = 300;

/**
 * HTTP status → contract reason.
 *
 * 4xx that is not 401/403/429 collapses into 'network'. The reason enum is
 * closed on purpose — it is rendered in an API response and stored in
 * job_ingest_state.last_error — and a 400 from a provider is, from here,
 * indistinguishable in kind from a 502: their end rejected us and there is
 * nothing this run can do about it. The status itself is in the log line.
 *
 * @param {number} status HTTP status code from the provider.
 * @returns {'bad_key'|'quota'|'network'} A reason from the contract enum.
 */
function reasonForStatus(status) {
  if (status === 401 || status === 403) return 'bad_key';
  if (status === 429) return 'quota';
  return 'network';
}

/**
 * GET a URL and parse its body as JSON, under a timeout, without ever throwing.
 *
 * Both timeouts are honoured: this call's own `timeoutMs`, and the
 * orchestrator's run-wide budget signal. Whichever fires first aborts the
 * request and surfaces as `error: 'timeout'` — ingest.js is what decides
 * whether to relabel that as 'budget'.
 *
 * @param {string} url Fully-formed request URL, query string included.
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal] The orchestrator's run-wide budget signal.
 * @param {number} [opts.timeoutMs=PER_ADAPTER_TIMEOUT_MS] Per-request ceiling.
 * @returns {Promise<{ok: boolean, status: number, data: any, error: string|null, snippet: string}>}
 *   `ok` true means `data` is the parsed body and `error` is null. Otherwise
 *   `error` is a contract reason and `snippet` holds up to MAX_BODY_LOG
 *   characters of whatever came back, for the caller's log line.
 */
export async function fetchJson(url, { signal, timeoutMs = PER_ADAPTER_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // The orchestrator's own budget signal, chained by hand rather than with
  // AbortSignal.any() — that is Node 20+, and this repo has no `engines` field
  // pinning the deploy target above 18.
  const onOuterAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    const status = Number(res?.status) || 0;
    const readText = typeof res?.text === 'function'
      ? () => res.text()
      : null;

    if (!res?.ok) {
      const body = readText ? await readText().catch(() => '') : '';
      return {
        ok: false,
        status,
        data: null,
        error: reasonForStatus(status),
        snippet: String(body).slice(0, MAX_BODY_LOG),
      };
    }

    if (!readText) {
      return { ok: false, status, data: null, error: 'parse', snippet: 'response has no body reader' };
    }

    const text = await readText();
    try {
      return { ok: true, status, data: JSON.parse(text), error: null, snippet: '' };
    } catch {
      // A 200 with an unparseable body is nearly always an HTML error page or
      // a captive-portal interstitial. 'parse' says that precisely.
      return {
        ok: false,
        status,
        data: null,
        error: 'parse',
        snippet: String(text).slice(0, MAX_BODY_LOG),
      };
    }
  } catch (err) {
    const name = err?.name;
    const error = name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'network';
    return {
      ok: false,
      status: 0,
      data: null,
      error,
      snippet: String(err?.message || name || 'fetch failed').slice(0, MAX_BODY_LOG),
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener?.('abort', onOuterAbort);
  }
}

/**
 * An empty page in the adapter contract's shape.
 *
 * Every failure path in every adapter returns this, which is what keeps
 * "fetch() never throws" cheap to honour.
 *
 * @param {string|null} [error] A contract reason, or null for a genuinely
 *   empty-but-successful page.
 * @returns {{items: any[], hasMore: boolean, error: string|null}}
 */
export function emptyResult(error = null) {
  return { items: [], hasMore: false, error };
}

/**
 * Clamp a caller-supplied page size into [1, max].
 *
 * `max` doubles as the fallback: both network adapters request their provider's
 * maximum page size by default, because the free tiers cap it anyway and a
 * smaller page just means more round trips inside the same budget.
 *
 * @param {unknown} value Caller-supplied size; anything non-numeric or zero
 *   falls back to `max`.
 * @param {number} max The provider's per-page ceiling.
 * @returns {number}
 */
export function clampPageSize(value, max) {
  return Math.min(Math.max(Number(value) || max, 1), max);
}
