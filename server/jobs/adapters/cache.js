/**
 * Cached fixtures — A DEV/TEST SOURCE, NOT PRODUCTION SEED CONTENT.
 *
 * ═══ WHY THIS IS OFF IN PRODUCTION ═══
 *
 * server/data/cached_jobs.json holds ~40 SYNTHETIC listings: invented company
 * names, invented descriptions, and `https://example.com/jobs/<id>` URLs that
 * go nowhere. Serving them to a real user would put fake job cards in a real
 * job search, spend the user's attention on them, and land them on a dead link
 * when they click Apply. An honest empty state ("no listings yet, ingest has
 * not run") is strictly better than plausible fiction — the empty state gets
 * reported and fixed, the fiction gets believed.
 *
 * So enabled() returns false when NODE_ENV === 'production'. The
 * ALLOW_CACHE_SOURCE=true escape hatch exists for a staging deploy that has no
 * provider keys and still needs a populated UI; it has to be set deliberately,
 * by name, and it is the kind of thing to grep for before a launch.
 *
 * What it IS for:
 *   - `npm test` — deterministic input, no network, no flake.
 *   - local dev with no ADZUNA_APP_ID, so the pipeline can be exercised end to
 *     end on a laptop on a plane.
 *
 * The fixtures include a few description_quality: 'snippet' rows and real
 * `Requirements:` / `Nice to have:` headers on purpose, so the extractor's
 * header state machine is exercised by the offline path too.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { log } from '../../logger.js';
import { emptyResult } from './httpJson.js';

const cacheLog = log.child('jobs').child('cache');

const FIXTURE_PATH = fileURLToPath(new URL('../../data/cached_jobs.json', import.meta.url));

/**
 * Memoized after the first read — including the failure, so a missing file
 * does not mean 40 stat() calls per run. `null` means "not loaded yet".
 *
 * @type {{jobs: object[], error: string|null}|null}
 */
let fixturesMemo = null;

/**
 * Read and parse the fixture file once per process.
 *
 * Accepts either `{ jobs: [...] }` or a bare array at the top level, so the
 * file can carry the `_comment` marker that declares it synthetic without that
 * marker changing how it is loaded.
 *
 * @returns {Promise<{jobs: object[], error: string|null}>} `error` is 'parse'
 *   when the file is missing or unusable; never throws.
 */
async function loadFixtures() {
  if (fixturesMemo) return fixturesMemo;
  try {
    const text = await readFile(FIXTURE_PATH, 'utf8');
    const parsed = JSON.parse(text);
    const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : (Array.isArray(parsed) ? parsed : null);
    fixturesMemo = jobs ? { jobs, error: null } : { jobs: [], error: 'parse' };
  } catch (err) {
    // Missing file and malformed JSON are the same thing from here: the
    // fixture source has nothing to offer. Never throws — same contract as a
    // network adapter.
    // `errName`, not `name`: logger.js redacts a bare `name` key as PII.
    cacheLog.warn('fixture load failed', { reason: 'parse', errName: err?.name });
    fixturesMemo = { jobs: [], error: 'parse' };
  }
  return fixturesMemo;
}

/** @type {import('./index.js').JobAdapter} */
export const cacheAdapter = {
  id: 'cache',

  /**
   * @returns {boolean} False in production unless ALLOW_CACHE_SOURCE is the
   *   exact string 'true'. A truthy-looking value is not consent; see header.
   */
  enabled() {
    if (process.env.ALLOW_CACHE_SOURCE === 'true') return true;
    return process.env.NODE_ENV !== 'production';
  },

  supportsPaging: false,

  /**
   * Serve the fixture file. Never throws, never touches the network.
   *
   * @param {object} [opts]
   * @param {string} [opts.query] Case-insensitive substring match against
   *   title + category, standing in for a provider's search parameter.
   * @param {number} [opts.limit] Cap on returned items.
   * @returns {Promise<{items: object[], hasMore: boolean, error: string|null}>}
   */
  async fetch(options) {
    // See adzuna.js: a defaulted parameter does not survive an explicit null.
    const { query, limit } = options || {};
    if (!this.enabled()) return emptyResult('disabled');

    const { jobs, error } = await loadFixtures();
    if (error) return emptyResult(error);

    let items = jobs;
    if (query) {
      const needle = String(query).toLowerCase();
      items = items.filter((job) => `${job?.title || ''} ${job?.category || ''}`.toLowerCase().includes(needle));
    }
    const cap = Number(limit);
    if (Number.isFinite(cap) && cap > 0) items = items.slice(0, cap);

    cacheLog.debug('fixtures served', { count: items.length });

    return { items, hasMore: false, error: null };
  },

  /**
   * Fixture shape → the shared listing shape. The fixture file is already
   * written in roughly this shape, so this is mostly null-coercion.
   *
   * @param {unknown} raw One element of the fixture `jobs` array.
   * @returns {object|null} A listing for normalizeListing(), or null to skip.
   */
  toListing(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const title = typeof raw.title === 'string' ? raw.title : '';
    const url = typeof raw.url === 'string' ? raw.url : '';
    if (!title || !url) return null;

    return {
      source: 'cache',
      source_id: raw.id,
      title,
      url,
      company: raw.company || null,
      location: raw.location || null,
      category: raw.category || null,
      job_type: raw.job_type || null,
      remote: !!raw.remote,
      description: raw.description || '',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      salary_min: raw.salary_min ?? null,
      salary_max: raw.salary_max ?? null,
      salary_currency: raw.salary_currency || null,
      description_quality: raw.description_quality === 'snippet' ? 'snippet' : 'full',
      posted_at: raw.posted_at || null,
    };
  },
};

export default cacheAdapter;
