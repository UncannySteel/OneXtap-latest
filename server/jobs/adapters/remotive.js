/**
 * Remotive — keyless, remote-only, full descriptions.
 *
 * https://remotive.com/api/remote-jobs — no auth, no signup, no quota header.
 * That makes it the source that still works on the day Adzuna's key lapses,
 * which is the main reason it sits second in the cascade rather than last.
 *
 * NO PAGING. The endpoint takes `limit` and `search`/`category` filters but has
 * no offset or page parameter of any kind, so `supportsPaging` is false and
 * fetch() always reports `hasMore: false`. The orchestrator reads that and
 * resets the cursor to 1 rather than looping forever on a page 2 that does not
 * exist.
 *
 * Descriptions come back as HTML and are full length — stripped and truncated
 * downstream in normalizeListing.js, and stamped quality 'full'.
 *
 * Salary is a free-text string here ("$70k - $90k", "competitive", ""), not a
 * min/max pair. Parsing it would be guesswork stored as a number, so
 * toListing() drops it and leaves the salary columns null.
 */
import { log } from '../../logger.js';
import { fetchJson, emptyResult, clampPageSize, PER_ADAPTER_TIMEOUT_MS } from './httpJson.js';

const remotiveLog = log.child('jobs').child('remotive');

/** The endpoint's own ceiling for `limit`; also what we always ask for. */
const RESULTS_PER_PAGE = 100;

/** @type {import('./index.js').JobAdapter} */
export const remotiveAdapter = {
  id: 'remotive',

  /**
   * @returns {boolean} Always true. Keyless — there is nothing to configure and
   *   nothing to forget.
   */
  enabled() {
    return true;
  },

  supportsPaging: false,

  /**
   * Fetch the whole (single) result set. Never throws.
   *
   * @param {object} [opts]
   * @param {string} [opts.query] Free-text search, Remotive's `search`.
   * @param {number} [opts.limit] Result cap, clamped to RESULTS_PER_PAGE.
   * @param {AbortSignal} [opts.signal] The run's budget signal.
   * @returns {Promise<{items: object[], hasMore: boolean, error: string|null}>}
   */
  async fetch(options) {
    // See adzuna.js: a defaulted parameter does not survive an explicit null.
    const { query, limit, signal } = options || {};
    const params = new URLSearchParams({
      limit: String(clampPageSize(limit, RESULTS_PER_PAGE)),
    });
    if (query) params.set('search', String(query));

    const url = `https://remotive.com/api/remote-jobs?${params.toString()}`;

    const res = await fetchJson(url, { signal, timeoutMs: PER_ADAPTER_TIMEOUT_MS });

    if (!res.ok) {
      remotiveLog.warn('fetch failed', {
        reason: res.error,
        status: res.status,
        snippet: res.snippet,
      });
      return emptyResult(res.error);
    }

    const jobs = Array.isArray(res.data?.jobs) ? res.data.jobs : null;
    if (!jobs) {
      remotiveLog.warn('unexpected payload shape', { reason: 'parse' });
      return emptyResult('parse');
    }

    remotiveLog.debug('fetched', { count: jobs.length });

    // hasMore is hardcoded false: there is no second page to ask for.
    return { items: jobs, hasMore: false, error: null };
  },

  /**
   * Remotive's item shape → the shared listing shape.
   *
   * @param {unknown} raw One element of the `jobs` array.
   * @returns {object|null} A listing for normalizeListing(), or null to skip.
   */
  toListing(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const title = typeof raw.title === 'string' ? raw.title : '';
    const url = typeof raw.url === 'string' ? raw.url : '';
    if (!title || !url) return null;

    return {
      source: 'remotive',
      source_id: raw.id,
      title,
      url,
      company: raw.company_name || null,
      location: raw.candidate_required_location || null,
      category: raw.category || null,
      job_type: raw.job_type || null,
      // Every listing on Remotive is remote. That is the whole site.
      remote: true,
      description: raw.description || '',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      // Free text upstream; see the header. Deliberately dropped.
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      description_quality: 'full',
      posted_at: raw.publication_date || null,
    };
  },
};

export default remotiveAdapter;
