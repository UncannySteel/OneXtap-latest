/**
 * Job search without a model: GET /api/jobs, /api/jobs/locations and
 * /api/jobs/meta.
 */
import express from 'express';
import { supabaseAdmin, requireAuth, formatSupabaseError } from '../supabase.js';
import { ADAPTERS } from '../jobs/adapters/index.js';
import { fetchJobPool, DEFAULT_SINCE_DAYS } from '../jobs/query.js';
import { clientErrorMessage } from '../lib/errors.js';
import { jobsLog, readJobFilters } from '../lib/jobRoutes.js';

const router = express.Router();

/**
 * Rows read per PostgREST page while tallying location facets.
 *
 * A thousand is Supabase's own default ceiling on an unranged request, so
 * asking for more in one call silently returns a thousand anyway. The route
 * pages instead — see LOCATION_MAX_ROWS.
 */
const LOCATION_PAGE_ROWS = 1000;

/**
 * The ceiling on how much of the pool one facet build will walk.
 *
 * ═══ WHY THIS IS NOT 1000 ANY MORE ═══
 *
 * It was, as a single recency-ordered page, and that made the picker a
 * description of the last ingest run rather than of the pool. Measured on the
 * live table 2026-09-20: the newest 1,000 rows were 556 arbeitnow + 241
 * himalayas + 178 adzuna + 25 jobicy, so the two highest-throughput feeds —
 * one German-skewed, one remote-only — decided the entire list of places a
 * user was allowed to pick. California held 53 listings in the pool and
 * appeared twice in the sample, which put it below the top-20 cut and out of
 * the picker completely; New York held 49 and appeared zero times. Meanwhile
 * "United States" was offered with a count of 216 against a real 1,215.
 *
 * A facet whose ranking is decided by ingest throughput is not a facet. So the
 * window is now the whole retained pool, which is also what makes the counts
 * true rather than indicative.
 *
 * Twenty thousand is a bound, not a target: the pool is ~5k rows against a
 * 30-day retention, so this is several times headroom, and the projection is
 * three short text columns. It exists so that a pool that grows by an order of
 * magnitude degrades into "counted the newest 20,000" instead of walking the
 * table on every page load.
 */
const LOCATION_MAX_ROWS = 20_000;

/**
 * Values offered per bucket.
 *
 * Generous, because the control is a dropdown the user scrolls, not a
 * typeahead they out-type. The old limit of 20 was chosen for a datalist and
 * was the second half of the bug above: 182 distinct cities were tallied and
 * 162 of them were unreachable.
 */
const LOCATION_FACET_LIMIT = { countries: 60, regions: 80, cities: 120 };

/**
 * How long a built facet set is reused within one process.
 *
 * The tally is six or so PostgREST pages, which is cheap but not free, and the
 * answer only moves when the ingest cron runs. Fifteen minutes.
 *
 * On Vercel this is per-instance and the hit rate is modest — the same caveat
 * that applies to the memory rank store. That is fine: the cache is here to
 * stop one user's page reloads from re-walking the pool, not to be a shared
 * cache. See jobs/rankCache.js.
 */
const LOCATION_CACHE_TTL_MS = 15 * 60 * 1000;

/** `{ at: epochMs, payload: object }` or null. Process-local, by design. */
let locationFacetCache = null;

// ------------------------------------------------------------------
// GET /api/jobs — unranked pool browse
// ------------------------------------------------------------------
// No LLM, no credits, no resume. This is the "just show me what's there" path:
// the empty state, the source filter, the thing that still works when every
// AI provider in the stack is down.
router.get('/api/jobs', requireAuth, async (req, res) => {
  try {
    const { jobs, nextCursor } = await fetchJobPool(supabaseAdmin, readJobFilters(req.query));
    res.json({ jobs, nextCursor, total: jobs.length });
  } catch (error) {
    jobsLog.error('GET /api/jobs failed', { errName: error?.name });
    res.status(502).json({ error: clientErrorMessage(error), jobs: [], nextCursor: null });
  }
});

// ------------------------------------------------------------------
// GET /api/jobs/meta — what is in the pool, and what is broken
// ------------------------------------------------------------------
// This route is why the empty state can be honest. "No jobs found" is four
// completely different situations — a quiet market, a filter that excludes
// everything, a dead Adzuna key, a cron that has not run since Tuesday — and
// a UI that cannot tell them apart can only shrug. The per-source lastError
// and lastRunAt here are what turn that shrug into a named cause.
/**
 * GET /api/jobs/locations — the values the location typeahead may offer.
 *
 * ═══ WHY A DEDICATED ENDPOINT ═══
 *
 * The location box used to be free text matched with `ilike '%typed%'` against
 * the provider's display string, and the provider prints "Tampa Palms,
 * Hillsborough County". Typing "Florida" matched nothing, typing "New York"
 * matched only rows spelled exactly that way, and an empty result looked
 * identical to "no jobs here". A user can only pick a place we actually hold
 * if we tell them which places we hold — that is this route.
 *
 * Counts come from the structured columns added in migration 004. Until that
 * migration is applied those columns are null, every bucket is empty, and the
 * client falls back to the free-text box: degraded, not broken.
 *
 * No credits, no model, and the same auth as the rest of /api/jobs.
 */
router.get('/api/jobs/locations', requireAuth, async (_req, res) => {
  const empty = { countries: [], regions: [], cities: [], degraded: true, sampled: 0, complete: false };

  const fresh = locationFacetCache && (Date.now() - locationFacetCache.at) < LOCATION_CACHE_TTL_MS;
  if (fresh) return res.json(locationFacetCache.payload);

  try {
    // ═══ THE SAME WINDOW THE POOL READ USES ═══
    //
    // fetchJobPool filters `posted_at >= since`, so a value tallied outside
    // that window is a place the user can pick and never get a result for.
    // Offering an unreachable option is worse than offering none: it reads as
    // "we have nothing here" when what actually happened is that the filter
    // and the picker disagreed about which rows exist.
    const since = new Date(Date.now() - DEFAULT_SINCE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Page rather than sample. PostgREST cannot express "distinct with counts"
    // without a view or an RPC — both of which are hand-applied migrations in
    // this project — so the tally is still done in JS, but now over the whole
    // retained pool instead of over whichever rows the last ingest happened to
    // write. Three short text columns, so ~20k rows is a small read.
    const rows = [];
    let complete = false;
    for (let offset = 0; offset < LOCATION_MAX_ROWS; offset += LOCATION_PAGE_ROWS) {
      const { data, error } = await supabaseAdmin
        .from('job_listings')
        .select('location_city,location_region,location_country')
        .gte('posted_at', since)
        .order('posted_at', { ascending: false })
        .range(offset, offset + LOCATION_PAGE_ROWS - 1);

      if (error) {
        jobsLog.warn('location facets query failed', {
          reason: String(error.message || '').slice(0, 200),
          offset,
        });
        // Partial is still useful — it is exactly the old behaviour — so a
        // failure on page four keeps pages one to three rather than throwing
        // away a working picker. Only a failure on the FIRST page is empty.
        break;
      }

      const page = Array.isArray(data) ? data : [];
      rows.push(...page);
      if (page.length < LOCATION_PAGE_ROWS) {
        complete = true;
        break;
      }
    }

    if (!rows.length) return res.json(empty);

    const tally = (key, limit) => {
      const counts = new Map();
      for (const row of rows) {
        const value = row?.[key];
        if (typeof value !== 'string' || !value.trim()) continue;
        counts.set(value, (counts.get(value) || 0) + 1);
      }
      return [...counts.entries()]
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([value, count]) => ({ value, count }));
    };

    const countries = tally('location_country', LOCATION_FACET_LIMIT.countries);
    const regions = tally('location_region', LOCATION_FACET_LIMIT.regions);
    const cities = tally('location_city', LOCATION_FACET_LIMIT.cities);

    const payload = {
      countries,
      regions,
      cities,
      // True when migration 004 has not been applied (or nothing is parsed
      // yet), so the client can keep the free-text box instead of showing an
      // empty dropdown that looks like "we have no jobs anywhere".
      degraded: countries.length === 0 && regions.length === 0 && cities.length === 0,
      // How many rows the counts are over, and whether that was all of them.
      // The client says so out loud: a count the user can see is a promise,
      // and a truncated walk makes it a slightly low one.
      sampled: rows.length,
      complete,
    };

    locationFacetCache = { at: Date.now(), payload };
    jobsLog.debug('location facets built', {
      rows: rows.length, complete, countries: countries.length, regions: regions.length, cities: cities.length,
    });
    res.json(payload);
  } catch (error) {
    jobsLog.warn('location facets failed', { errName: error?.name });
    res.json(empty);
  }
});

router.get('/api/jobs/meta', requireAuth, async (_req, res) => {
  // Adapter identity and enablement come from the registry, not the database:
  // a source that has never run has no state row, and the answer for it is
  // "configured but never run", not "does not exist".
  const registry = ADAPTERS.map((adapter) => {
    let enabled = false;
    try {
      enabled = adapter.enabled() === true;
    } catch {
      enabled = false;
    }
    return { id: adapter.id, enabled, count: 0, lastRunAt: null, lastError: null };
  });

  const byId = new Map(registry.map((s) => [s.id, s]));
  let total = 0;
  let oldestPostedAt = null;
  let degraded = false;

  try {
    const { data: states, error: stateError } = await supabaseAdmin
      .from('job_ingest_state')
      .select('source,last_run_at,last_status,last_error,inserted_count');
    if (stateError) throw new Error(formatSupabaseError(stateError));

    for (const row of states || []) {
      const entry = byId.get(row.source) || { id: row.source, enabled: false, count: 0 };
      entry.lastRunAt = row.last_run_at || null;
      // last_error is read through last_status, never raw: "ok with an old
      // error string" and "failing right now" look identical otherwise. A
      // successful ingest already nulls last_error (see ingest.js), so this is
      // belt to that braces — it guarantees an 'ok' source can never render as
      // broken, whatever a partial write or an older ingest left behind.
      // last_status itself is not forwarded: the client renders a cause, not a
      // state machine, and `lastError === null` already means healthy.
      // 'disabled' is NOT an error, and rendering it as one was a live bug: the
      // dashboard drew a warning triangle beside wellfound and cache — two
      // sources that are off on purpose and documented as such — which reads
      // as "this integration is broken" for something nobody broke. `enabled`
      // already carries "off"; `lastError` is reserved for a run that TRIED
      // and failed, which is the only thing worth drawing attention to.
      entry.lastError =
        row.last_status === 'ok' || row.last_status === 'disabled'
          ? null
          : row.last_error || null;
      if (!byId.has(row.source)) {
        byId.set(row.source, entry);
        registry.push(entry);
      }
    }
  } catch (error) {
    degraded = true;
    jobsLog.warn('ingest state unavailable for /api/jobs/meta', { errName: error?.name });
  }

  try {
    for (const entry of registry) {
      const { count, error } = await supabaseAdmin
        .from('job_listings')
        .select('id', { count: 'exact', head: true })
        .eq('source', entry.id);
      if (error) throw new Error(formatSupabaseError(error));
      entry.count = count || 0;
      total += entry.count;
    }

    const { data: oldest, error: oldestError } = await supabaseAdmin
      .from('job_listings')
      .select('posted_at')
      .order('posted_at', { ascending: true })
      .limit(1);
    if (oldestError) throw new Error(formatSupabaseError(oldestError));
    oldestPostedAt = oldest?.[0]?.posted_at || null;
  } catch (error) {
    degraded = true;
    jobsLog.warn('pool counts unavailable for /api/jobs/meta', { errName: error?.name });
  }

  // 200 even when degraded. The caller asked "what is in the pool"; "we could
  // not reach the pool" is an answer to that question, and the shape it needs
  // to render is the same shape.
  res.json({
    sources: registry.map((s) => ({
      id: s.id,
      enabled: s.enabled,
      count: s.count,
      lastRunAt: s.lastRunAt ?? null,
      lastError: s.lastError ?? null,
    })),
    total,
    oldestPostedAt,
    degraded,
  });
});

export default router;
