/**
 * Adzuna — the widest-coverage source, and the only paged one.
 *
 * Free tier, key-based (app_id + app_key), country-scoped by URL path. Docs:
 * https://developer.adzuna.com/overview
 *
 * CAVEAT THAT SHAPES EVERYTHING DOWNSTREAM: Adzuna's search endpoint truncates
 * `description` to roughly 200 characters. There is no "full description" call
 * on the free tier. So every row from here is stamped
 * description_quality: 'snippet', the matcher down-weights its confidence
 * (SNIPPET_CONFIDENCE in src/matching/fallbackScore.js), and keyword
 * extraction gets a fifth of the signal it gets from Remotive.
 */
import { log } from '../../logger.js';
import { fetchJson, emptyResult, clampPageSize, PER_ADAPTER_TIMEOUT_MS } from './httpJson.js';

const adzunaLog = log.child('jobs').child('adzuna');

/** Adzuna's free-tier maximum for results_per_page; also what we always ask for. */
const RESULTS_PER_PAGE = 50;

/**
 * Only listings posted in the last week. The pool is a rolling refresh, not an
 * archive, and an older posting is disproportionately likely to be filled by
 * the time a user clicks Apply.
 */
const MAX_DAYS_OLD = 7;

/** Adzuna has no remote flag, so remoteness is inferred from title + location. */
const REMOTE_RE = /\bremote\b|work from home/i;

/**
 * Adzuna returns salary figures with no currency field — it is implied by the
 * country in the URL path. Carried through on the raw item as `_country` by
 * fetch() below, because a salary range with no currency is not usable.
 */
const COUNTRY_CURRENCY = {
  us: 'USD', gb: 'GBP', ca: 'CAD', au: 'AUD', de: 'EUR', fr: 'EUR',
  nl: 'EUR', at: 'EUR', es: 'EUR', it: 'EUR', be: 'EUR', pl: 'PLN',
  in: 'INR', sg: 'SGD', za: 'ZAR', nz: 'NZD', br: 'BRL', mx: 'MXN', ch: 'CHF',
};

/**
 * Adzuna's country goes into the URL PATH, so it is validated, not escaped —
 * there is no encoding that makes an arbitrary string safe in a path segment.
 * Anything that is not exactly two letters falls back to 'us'.
 *
 * @param {unknown} country Explicit country, else ADZUNA_COUNTRIES, else 'us'.
 * @returns {string} A lowercase two-letter country code.
 */
function safeCountry(country) {
  const code = String(country ?? '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : 'us';
}

/**
 * Every country configured in ADZUNA_COUNTRIES, validated.
 *
 * The variable is plural and always was, but this used to read `.split(',')[0]`
 * — so `ADZUNA_COUNTRIES=in,us,gb` silently fetched India and nothing else, and
 * the currency table then stamped INR on everything. Invalid entries are
 * dropped rather than coerced to 'us', which would otherwise turn one typo into
 * a duplicate of a country already in the list.
 *
 * @returns {string[]} At least one code; ['us'] when nothing valid is set.
 */
export function configuredCountries() {
  const seen = [];
  for (const part of String(process.env.ADZUNA_COUNTRIES || 'us').split(',')) {
    const code = part.trim().toLowerCase();
    if (/^[a-z]{2}$/.test(code) && !seen.includes(code)) seen.push(code);
  }
  return seen.length ? seen : ['us'];
}

/**
 * Map the ingest cursor's flat page number onto (country, page-within-country).
 *
 * `job_ingest_state` stores ONE integer per source, and reshaping that for a
 * list of countries would mean changing the cursor for every adapter. Instead
 * the countries are round-robined across consecutive cursor values:
 *
 *   countries = [in, us, gb]
 *   cursor 1 → in p1    cursor 4 → in p2
 *   cursor 2 → us p1    cursor 5 → us p2
 *   cursor 3 → gb p1    cursor 6 → gb p2
 *
 * Round-robin rather than "finish India, then start the US" on purpose: a run
 * that exhausts its time budget after two pages should have covered two
 * countries, not the first two pages of one.
 *
 * @param {number} cursor 1-based page from job_ingest_state.
 * @param {string[]} countries From configuredCountries().
 * @returns {{country: string, page: number}}
 */
export function cursorToTarget(cursor, countries) {
  const list = Array.isArray(countries) && countries.length ? countries : ['us'];
  const zeroBased = Math.max(Number(cursor) || 1, 1) - 1;
  return {
    country: list[zeroBased % list.length],
    page: Math.floor(zeroBased / list.length) + 1,
  };
}

/** @type {import('./index.js').JobAdapter} */
export const adzunaAdapter = {
  id: 'adzuna',

  /**
   * @returns {boolean} True only when both credentials are present; Adzuna
   *   rejects a half-configured pair with a 401 that costs a round trip.
   */
  enabled() {
    return !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
  },

  supportsPaging: true,


  /** Adzuna has both `what` and `category`; ingest rotates the taxonomy here. */

  supportsSearch: true,

  /**
   * Fetch one page of search results. Never throws.
   *
   * @param {object} [opts]
   * @param {string} [opts.query] Free-text search, Adzuna's `what`.
   * @param {string} [opts.category] Adzuna category `tag`, e.g. 'it-jobs'.
   * @param {string} [opts.location] Free-text location, Adzuna's `where`.
   * @param {string} [opts.country] Two-letter country; scopes the URL path.
   * @param {boolean} [opts.remote] Best-effort remote filter; see below.
   * @param {number} [opts.limit] Page size, clamped to RESULTS_PER_PAGE.
   * @param {number} [opts.page=1] 1-based page number.
   * @param {AbortSignal} [opts.signal] The run's budget signal.
   * @returns {Promise<{items: object[], hasMore: boolean, error: string|null}>}
   */
  async fetch(options) {
    // Destructure from a coerced object, not a defaulted parameter: a default
    // only fires on `undefined`, so `fetch(null)` would throw here and break the
    // never-throws contract every caller in the cascade relies on.
    const { query, category, location, country, remote, limit, page = 1, signal } = options || {};
    if (!this.enabled()) return emptyResult('disabled');

    const perPage = clampPageSize(limit, RESULTS_PER_PAGE);

    // An explicit `country` pins the request to it (the ranking path and the
    // tests do this). Otherwise the cursor decides, rotating through every
    // configured country — see cursorToTarget.
    const countries = configuredCountries();
    const target = cursorToTarget(page, countries);
    const countryCode = country ? safeCountry(country) : target.country;
    const pageNum = country ? Math.max(Number(page) || 1, 1) : target.page;

    const params = new URLSearchParams({
      app_id: process.env.ADZUNA_APP_ID,
      app_key: process.env.ADZUNA_APP_KEY,
      results_per_page: String(perPage),
      max_days_old: String(MAX_DAYS_OLD),
      'content-type': 'application/json',
    });
    if (query) params.set('what', String(query));
    // Adzuna's own category `tag`. Paired with `what` rather than replacing it:
    // the term alone drags in adjacent categories ("designer" returns retail
    // display roles), and the category alone returns the category's firehose,
    // which is the unfiltered feed this rotation exists to escape. An unknown
    // tag is not an error here — it is an empty result set — so the values in
    // jobs/searchTerms.js are read from the live categories endpoint.
    if (category) params.set('category', String(category));
    if (location) params.set('where', String(location));
    // Adzuna has no remote flag; the closest lever is a keyword on `what`.
    if (remote && !query) params.set('what', 'remote');

    const url = `https://api.adzuna.com/v1/api/jobs/${countryCode}/search/${pageNum}?${params.toString()}`;

    const res = await fetchJson(url, { signal, timeoutMs: PER_ADAPTER_TIMEOUT_MS });

    if (!res.ok) {
      // Log the reason and the status, never the URL — it carries app_key.
      adzunaLog.warn('fetch failed', {
        reason: res.error,
        status: res.status,
        page: pageNum,
        countryCode,
        snippet: res.snippet,
      });
      return emptyResult(res.error);
    }

    const results = Array.isArray(res.data?.results) ? res.data.results : null;
    if (!results) {
      adzunaLog.warn('unexpected payload shape', { reason: 'parse', page: pageNum });
      return emptyResult('parse');
    }

    // Stamp the country onto each item so toListing() can resolve a currency
    // without being handed the request context.
    for (const item of results) {
      if (item && typeof item === 'object') item._country = countryCode;
    }

    const total = Number(res.data?.count);
    const countryHasMore = results.length >= perPage
      && (Number.isFinite(total) ? pageNum * perPage < total : true);

    // `hasMore: false` makes ingest wrap the cursor back to 1. With several
    // countries in rotation that must NOT happen just because one of them ran
    // dry — India exhausting at page 20 would otherwise restart the US from
    // page 1 while it still had millions of listings. So keep going while any
    // country in this cycle is still unvisited, and only wrap once the last
    // slot of a cycle comes back empty.
    const cyclePosition = (Math.max(Number(page) || 1, 1) - 1) % countries.length;
    const midCycle = !country && cyclePosition < countries.length - 1;
    const hasMore = countryHasMore || midCycle;

    adzunaLog.debug('page fetched', {
      cursor: page, page: pageNum, countryCode,
      count: results.length, countryHasMore, hasMore,
    });

    return { items: results, hasMore, error: null };
  },

  /**
   * Adzuna's item shape → the shared listing shape.
   *
   * @param {unknown} raw One element of the `results` array.
   * @returns {object|null} A listing for normalizeListing(), or null to skip.
   */
  toListing(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const title = typeof raw.title === 'string' ? raw.title : '';
    const url = typeof raw.redirect_url === 'string' ? raw.redirect_url : '';
    if (!title || !url) return null;

    const locationName = raw.location?.display_name || '';
    const countryCode = typeof raw._country === 'string' ? raw._country : 'us';

    // Adzuna ships a STRUCTURED location that this adapter used to throw away:
    // `area` is ordered broadest-first, ['US','Florida','Hillsborough County',
    // 'Tampa Palms']. Only `display_name` was kept — and display_name is
    // "Tampa Palms, Hillsborough County", which names a city and a COUNTY and
    // never the state or the country. Filtering on it is why searching
    // "Florida" or "United States" returned nothing from 83% of the pool.
    const area = Array.isArray(raw.location?.area) ? raw.location.area.filter(Boolean).map(String) : [];

    return {
      source: 'adzuna',
      source_id: raw.id,
      title,
      url,
      company: raw.company?.display_name || null,
      location: locationName || null,
      // Broadest-first, exactly as the provider ordered it. normalizeListing
      // decides what becomes city/region/country, so that rule lives in ONE
      // place for all three sources rather than once per adapter.
      location_area: area,
      category: raw.category?.label || null,
      job_type: raw.contract_type || null,
      remote: REMOTE_RE.test(`${title} ${locationName}`),
      description: raw.description || '',
      tags: [],
      salary_min: raw.salary_min ?? null,
      salary_max: raw.salary_max ?? null,
      salary_currency: COUNTRY_CURRENCY[countryCode] || null,
      // Not a judgement call — Adzuna's search endpoint truncates, always.
      description_quality: 'snippet',
      posted_at: raw.created || null,
    };
  },
};

export default adzunaAdapter;
