/**
 * Job source adapters — the ingest cascade.
 *
 * ═══ THE CONTRACT ═══
 *
 *   {
 *     id: string,
 *     enabled(): boolean,
 *     supportsPaging: boolean,
 *     supportsSearch?: boolean,
 *     async fetch({ query, category, location, country, remote, limit, page, signal })
 *         -> { items: RawItem[], hasMore: boolean, error: string|null },
 *     toListing(rawItem): NormalizedListing | null
 *   }
 *
 * Every adapter file declares its members in exactly that order, so the four
 * read as one family and a missing member is visible by shape alone.
 *
 * ─── fetch() NEVER THROWS ───
 *
 * That is the entire point of this layer. The orchestrator runs sources in
 * order and falls through to the next one; a throw from adapter #1 would take
 * the whole run down and adapters #2-#4 would never be tried. So every network
 * error, every 500, every unparseable body is caught and returned as
 * `{ items: [], hasMore: false, error: '<reason>' }`.
 *
 * ─── BUT EMPTY IS NOT THE SAME AS FINE ───
 *
 * A failed fetch and a genuinely empty result page look identical from the row
 * count. `error` is what separates them, and it is persisted to
 * job_ingest_state.last_error and surfaced in the ingest API response. A dead
 * Adzuna key must never be indistinguishable from a quiet job market — that is
 * the failure mode where the product looks fine and silently serves nothing
 * for a month.
 *
 * `error` is one of:
 *   'timeout'  - AbortController fired; the provider did not answer in time
 *   'quota'    - 429; rate limited or the plan's ceiling is hit
 *   'bad_key'  - 401/403; credentials are wrong, missing, or revoked
 *   'parse'    - a 200 whose body is not the JSON shape we expect
 *   'network'  - 5xx, DNS, connection reset; the provider's problem
 *   'disabled' - the adapter is registered but intentionally off
 *
 * ─── NO RETRY, NO BACKOFF ───
 *
 * Deliberate, and consistent with the rest of this repo, which retries nothing
 * anywhere. A failed page is recorded and skipped; the cursor does not advance
 * past it, and the next daily run picks it up. Retrying inside a function with
 * a 45-second budget and a 60-second platform ceiling mostly converts one
 * recorded failure into one killed run.
 *
 * ─── toListing() ───
 *
 * Provider field names -> the shared shape consumed by
 * server/jobs/normalizeListing.js, which does the universal work (id prefix,
 * truncation, keyword extraction, dedupe hash). Returns null to skip an item.
 */
import { adzunaAdapter } from './adzuna.js';
import { remotiveAdapter } from './remotive.js';
import { atsAdapter } from './ats.js';
import { arbeitnowAdapter } from './arbeitnow.js';
import { remoteokAdapter } from './remoteok.js';
import { jobicyAdapter } from './jobicy.js';
import { himalayasAdapter } from './himalayas.js';
import { cacheAdapter } from './cache.js';

/**
 * The contract above, as a type the adapter files can point at.
 *
 * @typedef {object} JobAdapter
 * @property {string} id Stable source key; also the job_listings.source value
 *   and the job_ingest_state primary key, so it is not free to rename.
 * @property {() => boolean} enabled Whether this source should run at all.
 * @property {boolean} supportsPaging False means one page exists; the
 *   orchestrator wraps the cursor back to 1 after every run.
 * @property {boolean} [supportsSearch] True means the provider has a real
 *   free-text/category search, so ingest should rotate the occupation
 *   taxonomy (jobs/searchTerms.js) through this source's cursor. Absent or
 *   false means ingest asks for the plain feed. This is a claim about the
 *   PROVIDER, not the adapter: Remotive's adapter maps `query` to `search`
 *   perfectly well, but its free API returns the same 16 rows whatever it is
 *   sent, so rotating terms there would spend calls re-reading one page.
 * @property {(opts?: object) => Promise<{items: object[], hasMore: boolean, error: string|null}>} fetch
 *   Never throws; failures come back as an `error` reason.
 * @property {(raw: unknown) => object|null} toListing Provider shape to the
 *   shared listing shape; null skips the item.
 */

/**
 * The closed set of reasons an adapter may report. Rendered in the ingest API
 * response and stored in job_ingest_state.last_error, so widening it is a
 * change to two contracts at once, not a local edit.
 *
 * Note that ingest.js additionally writes 'budget' and 'db: <message>' into
 * its own perSource[].error — those are orchestrator states, not adapter
 * reasons, and are deliberately outside this list.
 */
export const ERROR_REASONS = Object.freeze([
  'timeout',
  'quota',
  'bad_key',
  'parse',
  'network',
  'disabled',
]);

/**
 * Order IS the cascade order. Adzuna first (widest coverage, paged), Remotive
 * second (keyless, so it still works when Adzuna's key lapses), ATS third
 * (Greenhouse/Lever/Ashby boards — narrow coverage, but the only source whose
 * descriptions are the COMPLETE posting, so it runs before the fixtures),
 * cache last as the offline floor.
 *
 * ═══ WELLFOUND IS NOT HERE, AND SHOULD NOT BE ADDED ═══
 *
 * It was, as a permanently-disabled placeholder, and was removed because a
 * source that can never return a row is not a source — it reached the pool
 * filter UI as a checkbox nobody could usefully tick and a warning triangle
 * for a fault nobody had. The reasoning it carried is worth more than the
 * stub was, so it is kept here:
 *
 * There is no public Wellfound jobs API. AngelList's `api.angel.co` endpoints
 * were switched off during the rebrand and nothing replaced them; the current
 * API surface is recruiter-side and gated behind a partnership. DO NOT WRITE A
 * SCRAPER: it breaches their terms — in a product that asks users for their
 * employment history — and their listings are client-rendered behind bot
 * detection, so it would mean shipping a headless browser into a function
 * measured in seconds. If Wellfound ever ships a real feed, add an adapter
 * then; until then its absence is the decision, and this paragraph is the
 * record of it.
 *
 * @type {JobAdapter[]}
 */
export const ADAPTERS = [
  adzunaAdapter,
  remotiveAdapter,
  atsAdapter,
  // Keyless aggregators, added 2026-09-19. Each was verified to return a
  // non-empty feed before it was written; each stamps 'full' because all four
  // return the complete posting rather than Adzuna's ~200-character snippet.
  arbeitnowAdapter,
  remoteokAdapter,
  jobicyAdapter,
  himalayasAdapter,
  cacheAdapter,
];

/**
 * Look up one adapter by its id.
 *
 * @param {string} id An adapter id, e.g. from the route's ?sources= parameter.
 * @returns {JobAdapter|null} null for an unknown id — the caller filters those
 *   out rather than failing the run, so a typo in ?sources= narrows the run
 *   instead of breaking it.
 */
export function getAdapter(id) {
  return ADAPTERS.find((a) => a.id === id) || null;
}

export { adzunaAdapter, remotiveAdapter, atsAdapter, cacheAdapter };
