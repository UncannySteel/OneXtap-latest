/**
 * Client for the job search API.
 *
 * Four calls: browse the pool, rank it against a resume, explain one job, and
 * ask what is actually in the pool. Every one of them goes through the Express
 * backend with a Supabase JWT — nothing here talks to Supabase directly, and
 * nothing here scores anything, because the scoring inputs (job descriptions,
 * the prompt library, the model key) all live server-side by design.
 *
 * ═══ WHY authFetch IS COPIED AND NOT IMPORTED ═══
 *
 * `src/creditManager.js` has the best error extraction in this codebase: it
 * reads the body once as text, tries JSON, falls back to stripping HTML out of
 * a proxy's error page, and never lets a non-string `error` field reach a
 * toast as "[object Object]". That is exactly what these calls need.
 *
 * It is module-private there, and creditManager.js is the credit surface —
 * the file where "did the server say the balance changed" is decided. Adding
 * an export to it to save thirty lines here would widen that file's API for
 * the benefit of an unrelated feature, and every future reader of an
 * `authFetch` import would have to go and check whether the credit file does
 * something special. Two small copies, each obvious in place.
 *
 * ═══ THIS FILE SHIPS IN BOTH BUILDS ═══
 *
 * The same source is the extension popup and the web dashboard, so nothing
 * here may assume `chrome` exists. It does not: these are plain fetches.
 */
import { API_URL } from './config';
import { getAccessToken } from './auth';
import { withTimeout } from './answerStudio';
import { log as baseLog } from './logger';

const log = baseLog.child('jobs');

/**
 * Ranking is slower than a normal request by a wide margin — it is a pool
 * read, a prefilter, and up to three rounds of batched LLM calls. The default
 * fetch timeouts elsewhere in this app are sized for a single completion and
 * would abort a healthy rank.
 */
export const RANK_TIMEOUT_MS = 60000;

/**
 * Explaining one job is two model calls against a full description — the
 * analysis and then the tailoring pass — so it is sized like a rank rather
 * than like a single completion.
 */
export const EXPLAIN_TIMEOUT_MS = 60000;

/**
 * Browsing the pool is a single indexed query with no model in it, so twenty
 * seconds is already far past healthy. It is set where it is to survive a cold
 * Supabase project's first connection, not to wait out a slow one: past that
 * point the honest answer is the empty state with a reason, which is what
 * fetchJobs returns when this fires.
 */
export const BROWSE_TIMEOUT_MS = 20000;

/**
 * Authenticated fetch with the backend's error shape unwrapped.
 *
 * See the file header for why this is a copy of the one in creditManager.js.
 *
 * @param {string} path Path beginning with '/'.
 * @param {RequestInit} [options]
 * @returns {Promise<any>} The parsed JSON body.
 * @throws {Error} With the server's own message where there is one.
 */
async function authFetch(path, options = {}) {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const raw = await res.text();
    let message = `HTTP ${res.status}`;
    if (raw) {
      try {
        const body = JSON.parse(raw);
        message = body.error || body.message || message;
        if (typeof message !== 'string') message = raw.slice(0, 300);
      } catch {
        message = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || message;
      }
    }
    throw new Error(message);
  }
  return res.json();
}

/**
 * Drop empty filter values so they do not become `?location=` in the query.
 *
 * It also keeps the server's cache honest: an empty string and an absent key
 * are the same question, and cacheKey() canonicalises them the same way, so
 * sending one would only add a round trip nobody benefits from.
 *
 * @param {object} [filters]
 * @returns {object} A new object with undefined/null/'' entries removed.
 */
function cleanFilters(filters = {}) {
  const out = {};
  for (const [key, value] of Object.entries(filters || {})) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

/**
 * Rank the job pool against a resume.
 *
 * ═══ minMatch IS NOT SENT ═══
 *
 * The "minimum match" control filters the list this function returns, in the
 * component, against `job.score`. It is never a request parameter. Sending it
 * would make every position of the slider a separate server call and a
 * separate cache entry; keeping it local makes re-filtering instant and free.
 * The matching server comment is above POST /api/jobs/rank.
 *
 * @param {object} params
 * @param {object} params.resumeProfile The PARSED resume shape —
 *   `{skills, titles, seniority, yearsExperience}`. Not a built ResumeProfile:
 *   that holds a Map, which JSON silently flattens to `{}`. The server builds
 *   the profile from these fields.
 * @param {object} [params.filters] `{limit, cursor, remote, location, source,
 *   q, since}`. Empty values are dropped.
 * @param {string} [params.resumeHash] Changes invalidate the server cache.
 * @param {number} [params.matcherVersion] Same.
 * @returns {Promise<{jobs: object[], loops: number, reformulations: object[],
 *   degraded: boolean, scoredBy: string, limited: boolean, cached: boolean,
 *   meta: object}>}
 */
export async function rankJobs({ resumeProfile, filters, resumeHash, matcherVersion } = {}) {
  return withTimeout(
    authFetch('/api/jobs/rank', {
      method: 'POST',
      body: JSON.stringify({
        resumeProfile: resumeProfile || {},
        filters: cleanFilters(filters),
        resumeHash: resumeHash || '',
        matcherVersion: matcherVersion ?? null,
      }),
    }),
    RANK_TIMEOUT_MS,
    'Ranking timed out'
  );
}

/**
 * Explain one job in depth. Costs one credit, charged by the server only after
 * the generation succeeds.
 *
 * `tailoringSuggestions` come back as `{corpusRef, currentText, reason,
 * suggestedAngle}`. `currentText` is a verbatim quotation of the user's own
 * material and `suggestedAngle` describes a direction — there is deliberately
 * no field containing replacement prose, and a renderer must not present one.
 *
 * @param {object} params
 * @param {object} params.job The job, INCLUDING its description. The pool
 *   browse does not return descriptions; this is the one call that uses one.
 * @param {Array<{ref: string, kind: string, text: string}>} [params.corpus]
 *   The user's corpus. Sent from the client because profile material is
 *   local-only by design and is never stored server-side.
 * @param {object} [params.resumeProfile] Parsed resume shape, as above.
 * @returns {Promise<{fitAnalysis: string, gaps: object[], strengths: object[],
 *   tailoringSuggestions: object[], creditsRemaining: number|null}>}
 */
export async function explainJob({ job, corpus, resumeProfile } = {}) {
  return withTimeout(
    authFetch('/api/jobs/explain', {
      method: 'POST',
      body: JSON.stringify({
        job: job || null,
        corpus: Array.isArray(corpus) ? corpus : [],
        resumeProfile: resumeProfile || {},
      }),
    }),
    EXPLAIN_TIMEOUT_MS,
    'Job analysis timed out'
  );
}

/**
 * Browse the pool with no resume and no LLM.
 *
 * This is the path that still works when every AI provider is down, so it
 * returns an empty list rather than throwing when the pool cannot be read —
 * a browse that fails should show "nothing to show" with a reason, not an
 * error boundary.
 *
 * @param {object} [filters] `{limit, cursor, remote, location, source, q, since}`
 * @returns {Promise<{jobs: object[], nextCursor: string|null, total: number,
 *   error?: string}>}
 */
export async function fetchJobs(filters = {}) {
  const query = new URLSearchParams(
    Object.entries(cleanFilters(filters)).map(([k, v]) => [k, String(v)])
  ).toString();
  const path = query ? `/api/jobs?${query}` : '/api/jobs';

  try {
    return await withTimeout(authFetch(path), BROWSE_TIMEOUT_MS, 'Loading jobs timed out');
  } catch (error) {
    log.warn('job browse failed', error?.message || error);
    return { jobs: [], nextCursor: null, total: 0, error: error?.message || String(error) };
  }
}

/**
 * What is in the pool, and what is broken.
 *
 * The honest empty state depends on this: "no jobs" caused by a dead source
 * key looks identical to "no jobs" caused by a quiet market unless something
 * reports the per-source `lastError` and `lastRunAt`.
 *
 * Returns a shaped empty answer rather than throwing, for the same reason —
 * a meta call that fails must not be the thing that stops the page rendering
 * its explanation of why the list is empty.
 *
 * @returns {Promise<{sources: object[], total: number,
 *   oldestPostedAt: string|null, degraded?: boolean, error?: string}>}
 *   `degraded` is true when part of the answer could not be read — from the
 *   server when only some of its queries failed, and from here when the call
 *   itself did.
 */
export async function fetchJobsMeta() {
  try {
    return await withTimeout(
      authFetch('/api/jobs/meta'),
      BROWSE_TIMEOUT_MS,
      'Loading job sources timed out'
    );
  } catch (error) {
    log.warn('job meta failed', error?.message || error);
    return {
      sources: [],
      total: 0,
      oldestPostedAt: null,
      degraded: true,
      error: error?.message || String(error),
    };
  }
}

/**
 * The namespace import, matching `creditManager` in src/creditManager.js so
 * the two client modules are reached the same way: `import { jobsApi } from
 * './jobsApi'`. There is deliberately no default export — a default that
 * aliases this would be a third spelling of one thing.
 */
export const jobsApi = { rankJobs, explainJob, fetchJobs, fetchJobsMeta };
