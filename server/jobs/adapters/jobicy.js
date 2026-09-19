/**
 * Jobicy — a keyless remote-jobs feed with a real search parameter.
 *
 * WHY IT IS WORTH AN ADAPTER: unlike Remotive, whose free API returns the same
 * 16 rows whatever it is asked (measured 2026-09-19), Jobicy's `tag` filter
 * actually changes the result set. That makes it the second source after
 * Adzuna that can be pointed at an occupation, so it takes part in the
 * taxonomy rotation — see `supportsSearch` and jobs/searchTerms.js.
 *
 * CAP. `count` is capped at 50 by the provider and there is no offset or page
 * parameter, so `supportsPaging` is false: one call is the whole answer for a
 * given tag. Breadth therefore comes from rotating the tag, not from paging,
 * which is exactly what the cursor already does.
 *
 * Rows are stamped 'full' — `jobDescription` is the complete posting as HTML,
 * and normalizeListing strips it.
 */
import { log } from '../../logger.js';
import { fetchJson, emptyResult, clampPageSize, PER_ADAPTER_TIMEOUT_MS } from './httpJson.js';

const jobicyLog = log.child('jobs').child('jobicy');

/** The provider's own ceiling for `count`. */
const RESULTS_PER_PAGE = 50;

/** @type {import('./index.js').JobAdapter} */
export const jobicyAdapter = {
  id: 'jobicy',

  enabled() {
    return true;
  },

  supportsPaging: false,

  /** Its `tag` filter genuinely narrows, so the taxonomy is worth rotating. */
  supportsSearch: true,

  /**
   * Fetch one tag's worth of listings. Never throws.
   *
   * @param {object} [opts]
   * @param {string} [opts.query] Occupation term, sent as Jobicy's `tag`.
   * @param {number} [opts.limit] Result cap, clamped to RESULTS_PER_PAGE.
   * @param {AbortSignal} [opts.signal] The run's budget signal.
   * @returns {Promise<{items: object[], hasMore: boolean, error: string|null}>}
   */
  async fetch(options) {
    const { query, limit, signal } = options || {};
    const params = new URLSearchParams({
      count: String(clampPageSize(limit, RESULTS_PER_PAGE)),
    });
    if (query) params.set('tag', String(query));

    const url = `https://jobicy.com/api/v2/remote-jobs?${params.toString()}`;
    const res = await fetchJson(url, { signal, timeoutMs: PER_ADAPTER_TIMEOUT_MS });

    if (!res.ok) {
      jobicyLog.warn('fetch failed', { reason: res.error, status: res.status });
      return emptyResult(res.error);
    }

    const jobs = Array.isArray(res.data?.jobs) ? res.data.jobs : null;
    if (!jobs) {
      jobicyLog.warn('unexpected payload shape', { reason: 'parse' });
      return emptyResult('parse');
    }

    jobicyLog.debug('fetched', { count: jobs.length });

    // No offset parameter exists, so there is no second page to ask for —
    // even when this one came back full. Same shape as remotive.js.
    return { items: jobs, hasMore: false, error: null };
  },

  /**
   * Jobicy's item shape → the shared listing shape.
   *
   * @param {unknown} raw One element of the `jobs` array.
   * @returns {object|null} A listing for normalizeListing(), or null to skip.
   */
  toListing(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const title = typeof raw.jobTitle === 'string' ? raw.jobTitle : '';
    const url = typeof raw.url === 'string' ? raw.url : '';
    if (!title || !url) return null;

    return {
      source: 'jobicy',
      source_id: raw.id ?? raw.jobSlug,
      title,
      url,
      company: raw.companyName || null,
      // "USA", "Anywhere", "Europe" — splitLocation reads all three shapes.
      location: raw.jobGeo || null,
      // A list upstream; the column holds one.
      category: Array.isArray(raw.jobIndustry) ? (raw.jobIndustry[0] ?? null) : (raw.jobIndustry || null),
      job_type: Array.isArray(raw.jobType) ? (raw.jobType[0] ?? null) : (raw.jobType || null),
      // Every listing on Jobicy is remote. That is the whole site.
      remote: true,
      description: raw.jobDescription || raw.jobExcerpt || '',
      tags: [],
      salary_min: Number.isFinite(raw.salaryMin) ? raw.salaryMin : null,
      salary_max: Number.isFinite(raw.salaryMax) ? raw.salaryMax : null,
      salary_currency: raw.salaryCurrency || null,
      description_quality: 'full',
      posted_at: raw.pubDate || null,
    };
  },
};

export default jobicyAdapter;
