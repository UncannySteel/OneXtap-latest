/**
 * Arbeitnow — a keyless, paged board with the widest free feed available here.
 *
 * WHY IT IS WORTH AN ADAPTER: 250 listings in a single response, no key, and a
 * real `page` parameter, measured 2026-09-19. That is five Adzuna pages' worth
 * per call against a source that costs nothing and rations nothing, which is
 * the opposite trade to every other source in this directory.
 *
 * WHAT IT IS NOT: it is not a global board. The feed skews heavily German —
 * many titles carry "(m/w/d)" and many descriptions are in German. That is not
 * a defect to filter out here: the matcher scores on keyword overlap, so a
 * German posting simply scores low for an English resume and sorts itself to
 * the bottom. Dropping rows on a language guess would be a worse error, since
 * the same feed carries English-language listings from the same companies.
 *
 * NO SEARCH. The endpoint takes no `what`/`search`/`category` parameter of any
 * kind, so `supportsSearch` is absent and ingest asks for the plain feed and
 * pages through it. Relevance is handled downstream by the pool read's term
 * filter, which is where it belongs for a source that cannot filter itself.
 *
 * FULL DESCRIPTIONS, so rows are stamped 'full' — the same reason ats.js
 * exists. `description` is HTML and normalizeListing strips it.
 */
import { log } from '../../logger.js';
import { fetchJson, emptyResult, PER_ADAPTER_TIMEOUT_MS } from './httpJson.js';

const arbeitnowLog = log.child('jobs').child('arbeitnow');

/** Their page size; not configurable, and stated here so the maths is visible. */
const RESULTS_PER_PAGE = 250;

/** @type {import('./index.js').JobAdapter} */
export const arbeitnowAdapter = {
  id: 'arbeitnow',

  /** Keyless. Nothing to configure, so nothing can be misconfigured. */
  enabled() {
    return true;
  },

  supportsPaging: true,

  /**
   * Fetch one page. Never throws.
   *
   * @param {object} [opts]
   * @param {number} [opts.page=1] 1-based page number from the ingest cursor.
   * @param {AbortSignal} [opts.signal] The run's budget signal.
   * @returns {Promise<{items: object[], hasMore: boolean, error: string|null}>}
   */
  async fetch(options) {
    // See adzuna.js: a defaulted parameter does not survive an explicit null.
    const { page = 1, signal } = options || {};
    const pageNum = Math.max(Number(page) || 1, 1);

    const url = `https://www.arbeitnow.com/api/job-board-api?page=${pageNum}`;
    const res = await fetchJson(url, { signal, timeoutMs: PER_ADAPTER_TIMEOUT_MS });

    if (!res.ok) {
      arbeitnowLog.warn('fetch failed', { reason: res.error, status: res.status, page: pageNum });
      return emptyResult(res.error);
    }

    const jobs = Array.isArray(res.data?.data) ? res.data.data : null;
    if (!jobs) {
      arbeitnowLog.warn('unexpected payload shape', { reason: 'parse', page: pageNum });
      return emptyResult('parse');
    }

    arbeitnowLog.debug('page fetched', { page: pageNum, count: jobs.length });

    // A full page implies another exists. Their `links.next` is also present,
    // but a count test needs no assumption about their pagination envelope.
    return { items: jobs, hasMore: jobs.length >= RESULTS_PER_PAGE, error: null };
  },

  /**
   * Arbeitnow's item shape → the shared listing shape.
   *
   * @param {unknown} raw One element of the `data` array.
   * @returns {object|null} A listing for normalizeListing(), or null to skip.
   */
  toListing(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const title = typeof raw.title === 'string' ? raw.title : '';
    const url = typeof raw.url === 'string' ? raw.url : '';
    if (!title || !url) return null;

    // `created_at` is unix SECONDS. Passing it through as a number would reach
    // normalizeListing's isoOrNull as a millisecond timestamp and date every
    // listing to 1970.
    const createdAt = Number(raw.created_at);
    const postedAt = Number.isFinite(createdAt) && createdAt > 0
      ? new Date(createdAt * 1000).toISOString()
      : null;

    return {
      source: 'arbeitnow',
      source_id: raw.slug,
      title,
      url,
      company: raw.company_name || null,
      location: raw.location || null,
      category: null,
      // `job_types` is a list ("Full time", "Permanent"); the column holds one.
      job_type: Array.isArray(raw.job_types) ? (raw.job_types[0] ?? null) : null,
      remote: raw.remote === true,
      description: raw.description || '',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      description_quality: 'full',
      posted_at: postedAt,
    };
  },
};

export default arbeitnowAdapter;
