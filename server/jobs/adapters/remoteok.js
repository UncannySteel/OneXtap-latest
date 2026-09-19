/**
 * Remote OK — a keyless single-shot feed of remote roles.
 *
 * ═══ THEIR TERMS ARE A CODE CONSTRAINT, NOT A README LINE ═══
 *
 * Element [0] of the response is not a job. It is a legal notice, and it asks
 * for a followed backlink to the listing's URL on Remote OK plus a mention of
 * Remote OK. Two things in this file exist because of it:
 *
 *   1. The first element is SKIPPED. It has no `position`, so toListing would
 *      drop it anyway — but relying on that would make a terms notice look
 *      like a parse bug the day they add a title to it.
 *   2. `url` is stored, NOT `apply_url`. `url` points at the posting on Remote
 *      OK, which is the link the product then renders as "Open posting" — so
 *      the backlink their terms ask for is the one users actually follow.
 *      Storing apply_url would send traffic straight past them and take the
 *      feed while declining the condition it is offered under.
 *
 * Do not "optimise" either of those away.
 *
 * NO PAGING and no search: one endpoint, one response, everything in it. So
 * `supportsPaging` is false and ingest.js resets the cursor after every run,
 * the same arrangement as remotive.js.
 */
import { log } from '../../logger.js';
import { fetchJson, emptyResult, PER_ADAPTER_TIMEOUT_MS } from './httpJson.js';

const remoteokLog = log.child('jobs').child('remoteok');

/** @type {import('./index.js').JobAdapter} */
export const remoteokAdapter = {
  id: 'remoteok',

  enabled() {
    return true;
  },

  supportsPaging: false,

  /**
   * Fetch the whole feed. Never throws.
   *
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal] The run's budget signal.
   * @returns {Promise<{items: object[], hasMore: boolean, error: string|null}>}
   */
  async fetch(options) {
    const { signal } = options || {};
    const res = await fetchJson('https://remoteok.com/api', { signal, timeoutMs: PER_ADAPTER_TIMEOUT_MS });

    if (!res.ok) {
      remoteokLog.warn('fetch failed', { reason: res.error, status: res.status });
      return emptyResult(res.error);
    }

    if (!Array.isArray(res.data)) {
      remoteokLog.warn('unexpected payload shape', { reason: 'parse' });
      return emptyResult('parse');
    }

    // See the header: [0] is the terms notice, not a listing.
    const items = res.data.filter((item) => item && typeof item === 'object' && item.legal === undefined);

    remoteokLog.debug('fetched', { count: items.length });
    return { items, hasMore: false, error: null };
  },

  /**
   * Remote OK's item shape → the shared listing shape.
   *
   * @param {unknown} raw One element of the response array.
   * @returns {object|null} A listing for normalizeListing(), or null to skip.
   */
  toListing(raw) {
    if (!raw || typeof raw !== 'object') return null;

    // Their field is `position`, not `title`.
    const title = typeof raw.position === 'string' ? raw.position : '';
    // See the header: their URL, deliberately, not apply_url.
    const url = typeof raw.url === 'string' ? raw.url : '';
    if (!title || !url) return null;

    return {
      source: 'remoteok',
      source_id: raw.id ?? raw.slug,
      title,
      url,
      company: raw.company || null,
      // Often empty or a region ("Worldwide"); splitLocation handles both.
      location: raw.location || null,
      category: null,
      job_type: null,
      // Every listing on Remote OK is remote. That is the whole site.
      remote: true,
      description: raw.description || '',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      salary_min: Number.isFinite(raw.salary_min) ? raw.salary_min : null,
      salary_max: Number.isFinite(raw.salary_max) ? raw.salary_max : null,
      // They quote salaries in USD and do not label the currency.
      salary_currency: Number.isFinite(raw.salary_min) || Number.isFinite(raw.salary_max) ? 'USD' : null,
      description_quality: 'full',
      posted_at: raw.date || null,
    };
  },
};

export default remoteokAdapter;
