/**
 * Himalayas — a keyless remote-jobs feed, and by far the deepest one here.
 *
 * WHY IT IS WORTH AN ADAPTER: it reported `totalCount: 103153` on 2026-09-19,
 * two orders of magnitude more than any other keyless source in this
 * directory, and it pages with a plain `offset`. Depth is the thing it brings;
 * the free sources next to it are all a single shallow page.
 *
 * OFFSET, NOT CURSOR. The response also carries a `nextCursor`, which would be
 * the better tool — except the ingest cursor is one integer in
 * job_ingest_state and there is nowhere to keep an opaque token between runs.
 * Offset is what fits the existing contract, and offset paging drifts when
 * rows are inserted between requests: a listing can be seen twice or skipped.
 * Seeing one twice is free (the upsert is keyed on job_id) and skipping one is
 * survivable (the cursor wraps and re-walks daily), so the drift is the
 * cheaper side of that trade — but do not mistake it for exactness.
 *
 * NO SEARCH parameter, so ingest asks for the plain feed and pages it;
 * relevance is the pool read's job downstream.
 *
 * Rows are stamped 'full' — `description` is the complete posting as HTML.
 */
import { log } from '../../logger.js';
import { fetchJson, emptyResult, clampPageSize, PER_ADAPTER_TIMEOUT_MS } from './httpJson.js';

const himalayasLog = log.child('jobs').child('himalayas');

/**
 * Rows per request — THE PROVIDER'S OWN CAP, measured, not chosen.
 *
 * `limit=10` returns 10, but `limit=50` and `limit=100` both return 20 and
 * echo back `limit: 20` (checked 2026-09-19). Getting this wrong is not a
 * small inefficiency: `hasMore` is `jobs.length >= perPage`, so asking for 50
 * and receiving 20 reads as "short page, end of the feed", ingest.js wraps the
 * cursor to 1 after every single run, and the adapter re-reads the newest 20
 * listings forever while reporting success. 103,153 rows would sit behind a
 * page that never advances.
 */
const RESULTS_PER_PAGE = 20;

/** @type {import('./index.js').JobAdapter} */
export const himalayasAdapter = {
  id: 'himalayas',

  enabled() {
    return true;
  },

  supportsPaging: true,

  /**
   * Fetch one page. Never throws.
   *
   * @param {object} [opts]
   * @param {number} [opts.page=1] 1-based page number from the ingest cursor.
   * @param {number} [opts.limit] Rows, clamped to RESULTS_PER_PAGE.
   * @param {AbortSignal} [opts.signal] The run's budget signal.
   * @returns {Promise<{items: object[], hasMore: boolean, error: string|null}>}
   */
  async fetch(options) {
    const { page = 1, limit, signal } = options || {};
    const pageNum = Math.max(Number(page) || 1, 1);
    const perPage = clampPageSize(limit, RESULTS_PER_PAGE);
    const offset = (pageNum - 1) * perPage;

    const url = `https://himalayas.app/jobs/api?limit=${perPage}&offset=${offset}`;
    const res = await fetchJson(url, { signal, timeoutMs: PER_ADAPTER_TIMEOUT_MS });

    if (!res.ok) {
      himalayasLog.warn('fetch failed', { reason: res.error, status: res.status, page: pageNum });
      return emptyResult(res.error);
    }

    const jobs = Array.isArray(res.data?.jobs) ? res.data.jobs : null;
    if (!jobs) {
      himalayasLog.warn('unexpected payload shape', { reason: 'parse', page: pageNum });
      return emptyResult('parse');
    }

    himalayasLog.debug('page fetched', { page: pageNum, offset, count: jobs.length });

    return { items: jobs, hasMore: jobs.length >= perPage, error: null };
  },

  /**
   * Himalayas' item shape → the shared listing shape.
   *
   * @param {unknown} raw One element of the `jobs` array.
   * @returns {object|null} A listing for normalizeListing(), or null to skip.
   */
  toListing(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const title = typeof raw.title === 'string' ? raw.title : '';
    // `guid` and `applicationLink` are the same himalayas.app posting URL;
    // guid is the stabler of the two to key on.
    const url = typeof raw.guid === 'string' ? raw.guid
      : typeof raw.applicationLink === 'string' ? raw.applicationLink : '';
    if (!title || !url) return null;

    // Unix SECONDS, like arbeitnow. Passed through as-is it would read as
    // milliseconds and date every listing to 1970.
    const pub = Number(raw.pubDate);
    const postedAt = Number.isFinite(pub) && pub > 0 ? new Date(pub * 1000).toISOString() : null;

    return {
      source: 'himalayas',
      // No numeric id; the posting URL is the stable identity.
      source_id: url,
      title,
      url,
      company: raw.companyName || null,
      // A list of allowed countries ("['United States']"), not an address.
      // Taking the first is honest: a job open to five countries is not
      // located in any one of them, and the `remote` flag already says so.
      location: Array.isArray(raw.locationRestrictions) ? (raw.locationRestrictions[0] ?? null) : null,
      // `locationRestrictions` holds COUNTRIES ("Philippines", "United
      // States"), not addresses. Saying so structurally is what stops
      // splitLocation guessing from the display string and filing a country
      // as a city — its free-text branch cannot know which it is, and a
      // country in the city column would offer "Philippines" as a city in the
      // location typeahead.
      location_area: Array.isArray(raw.locationRestrictions) && raw.locationRestrictions[0]
        ? [String(raw.locationRestrictions[0])]
        : undefined,
      category: Array.isArray(raw.categories) ? (raw.categories[0] ?? null) : null,
      job_type: raw.employmentType || null,
      // Every listing on Himalayas is remote. That is the whole site.
      remote: true,
      description: raw.description || raw.excerpt || '',
      tags: Array.isArray(raw.categories) ? raw.categories : [],
      salary_min: Number.isFinite(raw.minSalary) ? raw.minSalary : null,
      salary_max: Number.isFinite(raw.maxSalary) ? raw.maxSalary : null,
      salary_currency: raw.currency || null,
      description_quality: 'full',
      posted_at: postedAt,
    };
  },
};

export default himalayasAdapter;
