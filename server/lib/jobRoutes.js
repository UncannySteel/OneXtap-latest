/**
 * What the job-search routers share: their loggers and the filter reader
 * (server/routes/{jobs,jobRank,jobExplain}.js).
 */
import { log } from '../logger.js';

// One child logger per area, built once at module load rather than per request
// — log.child() only tags a scope string, so a fresh one on every call is pure
// waste. Both names end in `Log` on purpose: test/server/logger.test.js scans
// for `*Log.warn({ name: ... })` call sites, and a variable named anything else
// would drop these lines out of that scan.
export const jobsLog = log.child('jobs');
export const rankLog = log.child('rank');

/**
 * Body-or-query filters, normalised once for both the browse and rank paths.
 *
 * Deliberately shallow — it picks the seven keys the pool understands and
 * coerces the two free-text ones, and leaves the rest to fetchJobPool, which
 * is where limit clamping, date parsing and LIKE escaping already live and
 * where a test can see them. Two normalisation layers would be one too many.
 *
 * @param {unknown} source req.query or req.body.filters.
 * @returns {object} Filters in the shape query.js expects.
 */
export function readJobFilters(source = {}) {
  const s = source && typeof source === 'object' ? source : {};
  return {
    limit: s.limit,
    cursor: typeof s.cursor === 'string' ? s.cursor : undefined,
    remote: s.remote,
    location: typeof s.location === 'string' ? s.location : '',
    // Structured location, from the typeahead. When any of these is set the
    // pool read matches the migration-004 columns exactly and ignores the
    // free-text `location` above — see applyLocation in jobs/query.js.
    locationCity: typeof s.locationCity === 'string' ? s.locationCity : '',
    locationRegion: typeof s.locationRegion === 'string' ? s.locationRegion : '',
    locationCountry: typeof s.locationCountry === 'string' ? s.locationCountry : '',
    source: typeof s.source === 'string' ? s.source : undefined,
    q: typeof s.q === 'string' ? s.q : '',
    since: s.since,
  };
}
