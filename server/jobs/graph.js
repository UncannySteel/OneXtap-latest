/**
 * The ranking graph.
 *
 * ═══ WHY THERE IS NO GRAPH RUNTIME ═══
 *
 * The baseline for this feature is a LangGraph state machine: five nodes, one
 * conditional edge, a loop back. This file is that machine written as five
 * async functions and an `if`, because on this shape of problem the runtime
 * buys nothing and costs a dependency, a serialisation format, and a stack
 * trace that no longer points at the code that failed. Five steps with one
 * branch is a `while` loop. The names are kept — routeEntry, prefilter,
 * rankJobs, reformulateQuery — so the correspondence stays readable to anyone
 * holding the baseline next to it.
 *
 *   routeEntry → prefilter → rankJobs → gate ─┬─ enough? → done
 *                    ↑                        │
 *                    └── reformulateQuery ←───┘  (at most MAX_LOOPS times)
 *
 * ═══ EVERY EDGE OF THIS IS INJECTED ═══
 *
 * `deps = { fetchJobs, callModel, trace }`. The graph never touches Supabase,
 * never constructs a Groq client, never opens its own trace. It is therefore
 * fully testable with three stubs, today, with the database unreachable and
 * the account's models retired — and, more to the point, it stays that way
 * afterwards, which is the only reason a test written today is still worth
 * anything next quarter.
 *
 * ═══ IT NEVER THROWS ═══
 *
 * A user searching for work does not benefit from an error page. Every failure
 * mode here — a database that will not answer, a model that 404s, a resume
 * that parsed badly — resolves to a list of jobs with `degraded: true` and a
 * `reformulations[]`/`scoredBy` record of what happened.
 */
import { prefilterJobs, SKILL_LEXICON, MATCHER_VERSION } from '../../src/matching/index.js';
import { startTrace, flushTracing, SpanType } from '../observability/opik.js';
import { rankBatch, keywordResult, summarizeScoredBy } from './rank.js';
import { toMatcherJob } from './query.js';
import { log } from '../logger.js';

const graphLog = log.child('rank');

/**
 * Jobs handed to the LLM after the cheap local pass.
 *
 * This is our analogue of the baseline's bounded live fetch. The baseline caps
 * how much it pulls from the provider on each loop; we hold a pool of our own,
 * so the bound moves to the expensive step instead: 30 jobs is six batches,
 * which is the most LLM work one request may cost. Raising it raises latency
 * and spend linearly and improves recall barely at all, because the prefilter
 * has already sorted by keyword overlap and the tail is noise.
 */
export const PREFILTER_LIMIT = 30;

/** A job at or above this score counts as a good match for the gate. */
export const GOOD_SCORE = 60;

/** This many good matches and the graph stops looking. */
export const ENOUGH_GOOD_MATCHES = 5;

/**
 * Hard cap on reformulation loops.
 *
 * Two, and not "until it finds enough": some searches have no good matches in
 * the pool, and the honest answer to that is a short list with an explanation,
 * not an unbounded spend of LLM calls discovering the same thing. Each loop
 * costs a full re-rank, so the ceiling on one request is
 * (1 + MAX_LOOPS) × PREFILTER_LIMIT / BATCH_SIZE model calls.
 *
 * ═══ WHY TWO SURVIVED THE FREE-TIER RETUNE ═══
 *
 * Lowering this was considered when the Gemini leg turned out to be rationed at
 * 20 requests per day per model, and rejected on the numbers. With the model
 * rotation in createRankModelCaller the worst case is ~33 runs/day at two loops
 * against ~50 at one — both far above the ~3/day that prompted the work, and
 * the gap is smaller than it looks because a loop only runs when the gate is
 * missed, which working model scoring makes uncommon.
 *
 * Two is also load-bearing rather than arbitrary: the reformulation ladder has
 * three rungs (drop_location → relax_remote → widen_terms) and one loop can
 * only ever reach the first. Cutting the cap would not tune the feature, it
 * would silently delete most of it.
 *
 * RANK_MAX_LOOPS lowers it without a deploy for a deployment on a tighter
 * budget than this one. It is clamped to the hard ceiling either way.
 */
const _loops = Number.parseInt(process.env.RANK_MAX_LOOPS || '', 10);
export const MAX_LOOPS = Number.isFinite(_loops) && _loops >= 0 ? Math.min(_loops, 2) : 2;

/**
 * Whether a thin result may be widened past the filters the user set.
 *
 * ═══ OFF, AND THAT IS THE PRODUCT DECISION ═══
 *
 * The ladder below (drop_location → relax_remote → widen_terms) was built on
 * the premise that a short list is a failure to be recovered from. It is not.
 * A user who filters to India and is handed United States listings badged
 * "ignores location" has not been helped — they have been given a list they
 * must now re-filter by hand, and the badge is read as a bug rather than as an
 * offer. The same is true one rung down: `widen_terms` lends the profile terms
 * from adjacent categories at BORROWED_TERM_WEIGHT, which is precisely what
 * lifts a zero-overlap job over the prefilter's floor and back onto the page.
 *
 * So the honest answer to "we hold 8 listings for India and one of them suits
 * you" is one job and a sentence saying so. `relaxedFilters` then stays empty,
 * every job on the list honours every filter, and the empty state means what
 * it says.
 *
 * ═══ WHY THE LADDER IS STILL HERE ═══
 *
 * Because the decision is a policy, not a discovery. RANK_BROADEN=1 restores
 * the old behaviour without a deploy, and the ladder, its records and its
 * tests stay exercisable. Deleting it would make the choice unreviewable and
 * the reversal a rewrite.
 *
 * Costs nothing to leave off: with no loops a rank is one pool read and one
 * scoring pass, which is also the cheapest it has ever been against the
 * per-model daily quotas the rotation exists to stretch.
 */
export const BROADEN_WHEN_THIN = /^(1|true|yes)$/i.test(String(process.env.RANK_BROADEN || ''));

/**
 * Wall-clock budget for one whole rank, in milliseconds.
 *
 * ═══ WHY A GRAPH THAT CANNOT THROW STILL NEEDS A CLOCK ═══
 *
 * Every failure in this graph degrades: a dead provider, a malformed response
 * and an unreadable pool all produce a complete, keyword-scored list. None of
 * them produces an error. That covers every way the work can go WRONG and none
 * of the ways it can simply go LONG — and a rank that is still going when the
 * browser stops listening is, from the user's side, indistinguishable from a
 * crash. It is worse than a crash, in fact: the invocation keeps burning, the
 * hourly rate limit is still consumed, and nothing is cached, so the retry the
 * user reaches for is a full cold re-run of the thing that just failed them.
 *
 * MAX_LOOPS bounds the WORK (18 completions) but not the TIME, and the two
 * stopped tracking each other the moment a provider started rate-limiting:
 * 18 completions is ~20s against a healthy account and ~200s against a 429ing
 * one. This is the bound that holds either way.
 *
 * Sized against the smallest ceiling above it — a Vercel Hobby function is
 * capped at 60s — with room left for the pool read, the cache write and two
 * 2s trace flushes. The budget gates whether ANOTHER loop starts; it never
 * interrupts one in flight, because a half-scored batch is not a thing this
 * graph can return. So the real ceiling is this value plus one loop's
 * overshoot, which is what the headroom is for.
 */
const _budget = Number.parseInt(process.env.RANK_BUDGET_MS || '', 10);
export const RANK_BUDGET_MS =
  Number.isFinite(_budget) && _budget >= 1_000 ? _budget : 40_000;

/**
 * Which skill categories to reach into when broadening.
 *
 * Adjacency, not a flat union: a backend profile broadened into `cloud` and
 * `data` still gets backend-shaped jobs, while one broadened into `design`
 * gets noise wearing the same score. Categories are the ones in
 * src/matching/lexicon.js.
 */
const ADJACENT_CATEGORIES = Object.freeze({
  language: ['backend', 'frontend', 'data'],
  frontend: ['language', 'mobile', 'design'],
  backend: ['language', 'cloud', 'data'],
  data: ['ml', 'backend', 'cloud'],
  ml: ['data', 'language', 'cloud'],
  cloud: ['backend', 'practice', 'data'],
  mobile: ['frontend', 'language'],
  design: ['frontend', 'pm'],
  pm: ['practice', 'design', 'soft'],
  practice: ['cloud', 'backend', 'pm'],
  soft: ['pm', 'practice'],
});

/** Weight given to a term borrowed from an adjacent category. */
const BORROWED_TERM_WEIGHT = 0.35;

/** Cap on borrowed terms, so broadening does not become "match everything". */
const MAX_BORROWED_TERMS = 60;

/**
 * Borrowed terms quoted back in a reformulation record.
 *
 * The record is rendered in the run footer as an explanation, not as data —
 * MAX_BORROWED_TERMS of them would be a wall of text nobody reads, and a
 * dozen is enough for a user to recognise the direction the search moved in.
 */
const RECORDED_TERMS = 12;

/** Error text carried on a result or a span. Enough to diagnose, not a stack. */
const ERROR_TEXT_CHARS = 300;

/**
 * Distinct sources present in a result list, with counts, largest first.
 * @param {object[]} jobs Ranked-job envelopes, or bare jobs.
 * @returns {{id: string, count: number}[]} Ties break on id, so the order is
 *   stable across runs and two identical searches render identically.
 */
function summarizeSources(jobs) {
  const counts = new Map();
  for (const entry of jobs) {
    const source = entry?.job?.source || entry?.source || 'unknown';
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/**
 * Copy a resume profile, adding low-weight terms from categories adjacent to
 * the ones the profile already covers.
 *
 * Returns null when there is nothing to add — an empty profile has no
 * categories to be adjacent to, and a profile already spanning every category
 * has nowhere left to go. A null here is how `reformulateQuery` knows this
 * strategy is exhausted.
 *
 * @param {{keywordSet: Map<string, number>}} profile
 * @param {Set<string>} alreadyBorrowed Categories used by an earlier loop.
 * @returns {{profile: object, terms: string[], categories: string[]}|null}
 */
function widenProfileTerms(profile, alreadyBorrowed) {
  const keywordSet = profile?.keywordSet instanceof Map ? profile.keywordSet : new Map();

  const ownCategories = new Set();
  for (const term of keywordSet.keys()) {
    const entry = SKILL_LEXICON.get(term);
    if (entry?.category) ownCategories.add(entry.category);
  }
  // A profile whose terms the lexicon does not recognise still deserves a
  // broadening pass; fall back to the categories the pool is mostly made of.
  if (ownCategories.size === 0) {
    ownCategories.add('language');
    ownCategories.add('backend');
  }

  const wanted = new Set();
  for (const category of ownCategories) {
    for (const neighbour of ADJACENT_CATEGORIES[category] || []) {
      if (!ownCategories.has(neighbour) && !alreadyBorrowed.has(neighbour)) wanted.add(neighbour);
    }
  }

  // Second tier. A search with no location and no remote filter reaches the
  // widening step on both of its loops, and direct adjacency is exhausted
  // after the first — so the second loop reaches into everything left rather
  // than stopping short of the loop budget with nothing to show for it.
  // Distance one first, distance everything second, in that order, because a
  // backend profile broadened into `design` is noise and should only ever be
  // the last thing tried.
  if (wanted.size === 0) {
    for (const category of Object.keys(ADJACENT_CATEGORIES)) {
      if (!ownCategories.has(category) && !alreadyBorrowed.has(category)) wanted.add(category);
    }
  }
  if (wanted.size === 0) return null;

  const widened = new Map(keywordSet);
  const added = [];
  for (const [term, entry] of SKILL_LEXICON) {
    if (added.length >= MAX_BORROWED_TERMS) break;
    if (!wanted.has(entry.category)) continue;
    if (widened.has(term)) continue;
    widened.set(term, BORROWED_TERM_WEIGHT);
    added.push(term);
  }
  if (added.length === 0) return null;

  for (const category of wanted) alreadyBorrowed.add(category);

  return {
    profile: { ...profile, keywordSet: widened },
    terms: added,
    categories: [...wanted].sort(),
  };
}

/**
 * STEP 1 — routeEntry.
 *
 * Normalise the incoming filters into the working set the loop mutates, and
 * record the starting point so `reformulations[]` can say what changed from
 * what. No I/O.
 *
 * `remote` is normalised to the string 'any' rather than left absent, because
 * reformulateQuery tests it against 'any' to decide whether relaxing it is
 * still available — an undefined there would make step 2 fire on a search that
 * never restricted remote in the first place, burning a loop on nothing.
 *
 * @param {unknown} filters
 * @returns {object} The mutable working filters.
 */
function routeEntry(filters) {
  const f = filters && typeof filters === 'object' ? filters : {};
  return {
    limit: f.limit,
    cursor: f.cursor,
    remote: f.remote === undefined || f.remote === null || f.remote === '' ? 'any' : f.remote,
    location: typeof f.location === 'string' ? f.location.trim() : '',
    locationCity: typeof f.locationCity === 'string' ? f.locationCity.trim() : '',
    locationRegion: typeof f.locationRegion === 'string' ? f.locationRegion.trim() : '',
    locationCountry: typeof f.locationCountry === 'string' ? f.locationCountry.trim() : '',
    source: f.source,
    q: typeof f.q === 'string' ? f.q.trim() : '',
    since: f.since,
  };
}

/**
 * Order the merged list: jobs that honour the user's filters first.
 *
 * ═══ WHY TIER BEFORE SCORE ═══
 *
 * Once results from several passes share one list, a purely score-ordered sort
 * lets an out-of-location job scoring 72 sit above an in-location job scoring
 * 68 — so the top of a list the user reads as "my best matches in Berlin" is
 * neither in Berlin nor labelled. A filter the user set is a constraint, not a
 * weak preference, and a broadened result is an offer made after the
 * constraint could not be satisfied. Tiering says exactly that, and it keeps
 * the badge and the ordering telling the same story.
 *
 * Within a tier it is the ordering this list always had: score, then title so
 * a tie is stable rather than arbitrary.
 *
 * @param {object[]} results Merged envelopes, each carrying `relaxedFilters`.
 * @returns {object[]} The same array, sorted in place.
 */
function sortRanked(results) {
  return results.sort((a, b) => {
    const aRelaxed = a?.relaxedFilters ? 1 : 0;
    const bRelaxed = b?.relaxedFilters ? 1 : 0;
    if (aRelaxed !== bRelaxed) return aRelaxed - bRelaxed;
    const diff = (b?.score || 0) - (a?.score || 0);
    if (diff !== 0) return diff;
    return String(a?.job?.title || '').localeCompare(String(b?.job?.title || ''));
  });
}

/**
 * STEP 4 — reformulateQuery.
 *
 * Deterministic, in a fixed order, cheapest-signal-first. It is NOT an LLM
 * call: a model asked to broaden a search returns a different phrasing every
 * time, which makes the same search irreproducible and the cache useless, and
 * there is nothing here a model knows that the order below does not encode.
 *
 *   1. Drop `location` — the single most restrictive filter, and the one a
 *      user is most often willing to trade first.
 *   2. Relax `remote` to `any` — halves the pool exclusion at no relevance
 *      cost for a candidate who did not truly mean "remote only".
 *   3. Widen the prefilter's term set into adjacent skill categories — last,
 *      because it changes what "a match" means rather than how much of the
 *      pool is visible.
 *
 * Each applied step is recorded with what changed and why. That record is what
 * the run footer renders, and it is the whole answer to "why did I get these
 * jobs?" — a question a ranked list cannot otherwise answer.
 *
 * Mutates `state` in place; the caller reads the changed filters and profile
 * on its next pass.
 *
 * @param {{filters: object, profile: object, borrowedCategories: Set<string>}} state
 * @param {number} loopIndex 1-based, for the record.
 * @returns {{applied: boolean, record: object}} `applied: false` means every
 *   strategy is exhausted and the loop should stop short of MAX_LOOPS.
 */
function reformulateQuery(state, loopIndex) {
  // Every spelling of "where", cleared together. The structured fields are
  // the typeahead's; `location` is the free-text box's. Dropping only one of
  // them would leave the pool just as narrow while the footer reported the
  // location had been widened — a reformulation that claims work it did not do
  // is worse than one that does not run.
  const placeFrom = state.filters.locationCity
    || state.filters.locationRegion
    || state.filters.locationCountry
    || state.filters.location;
  if (placeFrom) {
    const from = placeFrom;
    state.filters = {
      ...state.filters,
      location: '',
      locationCity: '',
      locationRegion: '',
      locationCountry: '',
    };
    return {
      applied: true,
      record: {
        loop: loopIndex,
        step: 'drop_location',
        broadened: 'location',
        from,
        to: 'anywhere',
        reason: `Fewer than ${ENOUGH_GOOD_MATCHES} jobs scored ${GOOD_SCORE} or better with the location limited to "${from}", so the location filter was dropped.`,
      },
    };
  }

  if (state.filters.remote !== 'any') {
    const from = String(state.filters.remote);
    state.filters = { ...state.filters, remote: 'any' };
    return {
      applied: true,
      record: {
        loop: loopIndex,
        step: 'relax_remote',
        broadened: 'remote',
        from,
        to: 'any',
        reason: `Fewer than ${ENOUGH_GOOD_MATCHES} jobs scored ${GOOD_SCORE} or better with remote set to "${from}", so both remote and on-site roles were included.`,
      },
    };
  }

  const widened = widenProfileTerms(state.profile, state.borrowedCategories);
  if (widened) {
    state.profile = widened.profile;
    return {
      applied: true,
      record: {
        loop: loopIndex,
        step: 'widen_terms',
        broadened: 'skills',
        from: 'resume skills only',
        to: widened.categories.join(', '),
        addedTerms: widened.terms.slice(0, RECORDED_TERMS),
        reason: `Fewer than ${ENOUGH_GOOD_MATCHES} jobs scored ${GOOD_SCORE} or better, so adjacent skill areas (${widened.categories.join(', ')}) were treated as partial matches.`,
      },
    };
  }

  return {
    applied: false,
    record: {
      loop: loopIndex,
      step: 'exhausted',
      broadened: 'nothing',
      reason: 'Every broadening step had already been applied; this is the whole pool.',
    },
  };
}

/**
 * Run the graph.
 *
 * @param {object} params
 * @param {object} params.resumeProfile From buildResumeProfile(); its
 *   `keywordSet` is a Map, so it is built server-side, never sent over the wire.
 * @param {object} [params.filters] Pool filters; see query.js.
 * @param {object} [params.deps]
 * @param {(filters: object) => Promise<{jobs: object[], nextCursor?: string|null}>}
 *   params.deps.fetchJobs Injected pool reader.
 * @param {Function} [params.deps.callModel] Injected model caller; absent means
 *   keyword scoring throughout, which is a degraded result, not an error.
 * @param {object} [params.deps.trace] Injected root trace; one is opened if not.
 * @param {object} [params.options]
 * @param {number} [params.options.maxLoops] Lowered only; never above MAX_LOOPS.
 * @param {boolean} [params.options.broaden] Allow the reformulation ladder to
 *   relax the caller's filters. Defaults to BROADEN_WHEN_THIN, which is off —
 *   see that constant for why.
 * @returns {Promise<{jobs: object[], loops: number, reformulations: object[],
 *   relaxedFilters: string[], inFilterCount: number, degraded: boolean,
 *   scoredBy: string, sources: object[], timings: object}>}
 *   `jobs` is every job scored across every loop, deduplicated and ordered
 *   with the ones honouring the caller's filters first. Each carries
 *   `relaxedFilters`: null when it honours them all, otherwise the filters
 *   that had been dropped when it was found.
 */
export async function runRankGraph(params = {}) {
  // Destructured defensively rather than in the signature: a default only
  // fires on `undefined`, and `deps: null` from a caller that built its
  // arguments dynamically would throw on destructuring — inside the one
  // function in this feature that promises never to throw.
  const { resumeProfile, filters } = params && typeof params === 'object' ? params : {};
  const deps = params?.deps && typeof params.deps === 'object' ? params.deps : {};
  const options = params?.options && typeof params.options === 'object' ? params.options : {};

  const startedAt = Date.now();
  const timings = { totalMs: 0, prefilterMs: 0, rankMs: 0, reformulateMs: 0 };
  const reformulations = [];

  // The ceiling is zero unless broadening is switched on, so `maxLoops` below
  // clamps to 0 and the loop runs exactly one pass under the user's own
  // filters. A caller may still ask for FEWER loops, never more.
  //
  // `options.broaden` is the per-call override and BROADEN_WHEN_THIN the
  // deployment default. The option exists so the ladder stays reachable from a
  // test without a module reload — the env is read once at import, and a
  // policy that can only be flipped by re-importing the module under test is a
  // policy whose OTHER branch quietly stops being exercised.
  const broaden = typeof options.broaden === 'boolean' ? options.broaden : BROADEN_WHEN_THIN;
  const loopCeiling = broaden ? MAX_LOOPS : 0;
  const requestedLoops = Number.parseInt(options.maxLoops, 10);
  const maxLoops = Number.isFinite(requestedLoops)
    ? Math.max(0, Math.min(requestedLoops, loopCeiling))
    : loopCeiling;

  // Lowered only, never raised: a caller may ask for a tighter budget than the
  // deploy's, but not a looser one, so no request can opt itself past the
  // platform ceiling RANK_BUDGET_MS is sized against.
  const requestedBudget = Number.parseInt(options.budgetMs, 10);
  const budgetMs = Number.isFinite(requestedBudget)
    ? Math.max(0, Math.min(requestedBudget, RANK_BUDGET_MS))
    : RANK_BUDGET_MS;

  const { fetchJobs, callModel } = deps;

  // Derived once, outside the loop: reformulation changes the FILTERS (drops
  // the location, relaxes remote, widens categories), never the resume. Terms
  // are what the pool is about; filters are where it is allowed to come from.
  const terms = resumeTerms(resumeProfile);
  const trace =
    deps.trace ||
    startTrace({
      name: 'rank_request',
      input: { filters: filters || {}, maxLoops },
      metadata: { matcherVersion: MATCHER_VERSION, prefilterLimit: PREFILTER_LIMIT },
      tags: ['rank'],
    });

  const state = {
    filters: routeEntry(filters),
    profile: resumeProfile || {},
    borrowedCategories: new Set(),
  };

  let loops = 0;
  let budgetExhausted = false;
  let degraded = false;
  let ranked = [];
  let scoredBy = 'keyword';
  /**
   * Every job scored so far, keyed by jobId, FIRST occurrence kept.
   *
   * ═══ WHY THIS IS NOT `ranked = batch.results` ANY MORE ═══
   *
   * Each loop re-reads a WIDER pool, so an overwrite meant the list a user
   * finally saw was scored entirely from the widest pool the graph reached —
   * the results found under their own filters were computed, then discarded.
   * Asking for Berlin + remote and being handed a list that was 80% on-site
   * Dallas is indistinguishable from a broken filter, and that is exactly what
   * it was reported as.
   *
   * First-occurrence-wins is the load-bearing half. A job inside the user's
   * filters is found again in every later, wider pool, and keeping the first
   * copy is what keeps it labelled as honouring the filters rather than being
   * relabelled by the pass that broadened them. It also rescues in-filter jobs
   * that a wider pool's PREFILTER_LIMIT would have pushed out — the narrow
   * pass is the only one that can see them.
   */
  const scoredById = new Map();
  /**
   * Which of the user's filters had been dropped when the current loop ran.
   *
   * Only 'location' and 'remote' are recorded. `widen_terms` broadens what
   * counts as a match, not where a job may come from, so a job found under it
   * still honours every filter the user set and must not be badged as if it
   * did not.
   */
  const relaxedFilters = [];
  let degradeReason = null;
  let poolSize = 0;
  // How many candidates the LAST loop actually handed the scorer. Reported
  // instead of PREFILTER_LIMIT, which is a ceiling: a 15-job pool sent 15,
  // and a footer reading "15 in the pool - 30 sent to the scorer" was
  // arithmetic nobody could follow.
  let sentToScorer = 0;
  let lastError = null;

  try {
    for (;;) {
      const loopStarted = Date.now();

      // ── STEP 2: prefilter ────────────────────────────────────────────
      const prefilterStarted = loopStarted;
      const prefilterSpan = trace?.span?.({
        name: 'prefilter',
        type: SpanType.Tool,
        input: { loop: loops, filters: state.filters },
      });

      let pool = [];
      try {
        if (typeof fetchJobs !== 'function') throw new Error('No job source configured');
        const page = await fetchJobs({ ...state.filters, terms });
        pool = Array.isArray(page?.jobs) ? page.jobs : [];
      } catch (err) {
        // The pool is unreachable. Nothing downstream can help, but the caller
        // still gets a shaped answer rather than a rejected promise.
        lastError = err;
        degraded = true;
        // `reason`, not just `errName`. A Supabase failure's name is always
        // 'Error'; the diagnosis is entirely in the message, and without it
        // this line says a pool read failed and nothing about why — which is
        // how a missing table reached production looking like a bare 502.
        // `reason` is deliberate: server/logger.js redacts a bare `name` and
        // `message` is not a field it knows, so this is the spelling that
        // survives redaction (same as server/observability/opik.js).
        graphLog.warn('job pool fetch failed', {
          loop: loops,
          errName: err?.name,
          reason: String(err?.message || err).slice(0, ERROR_TEXT_CHARS),
        });
        prefilterSpan?.update?.({
          output: { error: String(err?.message || err).slice(0, ERROR_TEXT_CHARS) },
        })?.end?.();
        timings.prefilterMs += Date.now() - prefilterStarted;
        break;
      }

      poolSize = pool.length;
      const candidates = prefilterClientJobs(state.profile, pool, PREFILTER_LIMIT);
      sentToScorer = candidates.length;

      prefilterSpan?.update?.({
        output: { pool: pool.length, candidates: candidates.length },
      })?.end?.();
      timings.prefilterMs += Date.now() - prefilterStarted;

      // ── STEP 3: rankJobs ─────────────────────────────────────────────
      const rankStarted = Date.now();
      const batch = await rankBatch({
        jobs: candidates,
        resumeProfile: state.profile,
        callModel,
        trace,
      });
      timings.rankMs += Date.now() - rankStarted;

      // Merge, never replace. `relaxed` is a frozen snapshot rather than the
      // live array, because the array keeps growing and every envelope holding
      // a reference to it would end up claiming the LAST loop's relaxations.
      const relaxed = relaxedFilters.length ? Object.freeze([...relaxedFilters]) : null;
      for (const entry of batch.results) {
        const key = entry?.jobId;
        if (!key || scoredById.has(key)) continue;
        scoredById.set(key, { ...entry, relaxedFilters: relaxed });
      }
      ranked = sortRanked([...scoredById.values()]);

      scoredBy = summarizeScoredBy(ranked);
      // Keep the FIRST provider reason seen across loops: loop 1 failing on a
      // quota is the diagnosis, and loop 2 failing the same way afterwards is
      // the same fact restated.
      if (!degradeReason && batch.degradeReason) degradeReason = batch.degradeReason;
      if (batch.degraded) degraded = true;

      // ── GATE ─────────────────────────────────────────────────────────
      //
      // Counted over everything accumulated, not just this loop's batch. The
      // question the gate asks is "do I have enough good matches to show?",
      // and results from an earlier, narrower pass are still on the list that
      // will be shown — so a run that found three good in-filter jobs and then
      // two good ones after broadening stops here instead of burning its last
      // loop relaxing a filter it no longer needs to relax.
      const good = ranked.filter((r) => r.score >= GOOD_SCORE).length;
      if (good >= ENOUGH_GOOD_MATCHES || loops >= maxLoops) break;

      // Checked HERE, after a full pass has produced a rankable list and
      // before another one is started. Earlier would risk returning nothing;
      // later would spend a whole loop deciding it had no time for it.
      //
      // The test is PREDICTIVE, and it has to be. "Am I over budget yet" lets a
      // loop start at 39s of a 40s budget and run for another 40, which is how
      // a bound that looks correct still overruns the platform ceiling it was
      // sized against. The estimate is the duration of the loop just finished:
      // self-calibrating, needs no constant to drift out of date, and is the
      // best evidence available for what the next one costs — the loops do the
      // same work against the same provider in the same conditions.
      //
      // `degraded` is set too: a result that stopped short of its own strategy
      // is not the answer the graph would have given with time to finish, and
      // every consumer of `degraded` already means exactly that.
      const elapsedMs = Date.now() - startedAt;
      const lastLoopMs = Date.now() - loopStarted;
      if (elapsedMs + lastLoopMs >= budgetMs) {
        budgetExhausted = true;
        degraded = true;
        graphLog.warn('rank budget exhausted, returning what is ranked so far', {
          loop: loops,
          budgetMs,
          elapsedMs,
          lastLoopMs,
          good,
          jobs: ranked.length,
        });
        break;
      }

      // ── STEP 5: reformulateQuery ─────────────────────────────────────
      const reformulateStarted = Date.now();
      const reformulateSpan = trace?.span?.({
        name: 'reformulate',
        type: SpanType.General,
        input: { loop: loops, good, needed: ENOUGH_GOOD_MATCHES },
      });

      const outcome = reformulateQuery(state, loops + 1);
      const record = { ...outcome.record, goodBefore: good, jobsBefore: ranked.length };
      reformulations.push(record);

      reformulateSpan?.update?.({ output: record })?.end?.();
      timings.reformulateMs += Date.now() - reformulateStarted;

      if (!outcome.applied) break;

      // Record WHICH of the user's filters this rung gave up, so the jobs the
      // next loop finds can say what they cost. 'skills' is deliberately not
      // recorded — see relaxedFilters' declaration.
      if (outcome.record.broadened === 'location' || outcome.record.broadened === 'remote') {
        relaxedFilters.push(outcome.record.broadened);
      }

      loops += 1;
    }
  } catch (err) {
    // Belt to the braces above: rankBatch and prefilterJobs are both total, so
    // reaching here means something structural broke. Still not an exception
    // at the route.
    lastError = err;
    degraded = true;
    graphLog.error('rank graph failed', {
      errName: err?.name,
      reason: String(err?.message || err).slice(0, ERROR_TEXT_CHARS),
    });
  }

  // A pool we could not read leaves `ranked` empty; a pool we read but could
  // not score is already keyword-scored by rankBatch. Either way the shape is
  // the same and the caller does not branch.
  //
  // rankBatch already guarantees `results: [] ⟹ scoredBy: 'keyword'`, so this
  // restores an invariant rather than covering a live path. It is kept because
  // nothing pins that guarantee on rankBatch's side, and the cost of it
  // silently loosening is a result that claims an LLM scored an empty list.
  if (!ranked.length && lastError) {
    scoredBy = 'keyword';
  }

  timings.totalMs = Date.now() - startedAt;

  const result = {
    jobs: ranked,
    loops,
    reformulations,
    // The banner's inputs, computed here rather than re-derived on the client.
    // `reformulations` already describes what happened, but it describes it as
    // a list of steps for the diagnostics footer; these two say the one thing
    // the list itself has to admit at the top: which filters stopped applying,
    // and how much of the list still honours them.
    relaxedFilters: [...relaxedFilters],
    inFilterCount: ranked.filter((r) => !r.relaxedFilters).length,
    degraded,
    scoredBy,
    degradeReason,
    sources: summarizeSources(ranked),
    timings,
    poolSize,
    sentToScorer,
    budgetExhausted,
    matcherVersion: MATCHER_VERSION,
  };
  if (lastError) result.error = String(lastError?.message || lastError).slice(0, ERROR_TEXT_CHARS);

  // Fully optional-chained, unlike an ordinary span call: this one runs after
  // the try/catch above, so an injected trace whose update() returns nothing
  // would throw out of the one function that promises it never does.
  trace?.update?.({
    output: { jobs: ranked.length, loops, degraded, scoredBy },
    metadata: { poolSize, reformulations: reformulations.length },
  })?.end?.();

  // Before returning, not after: on Vercel the function can be frozen the
  // instant the response is written, and anything still batched is lost.
  await flushTracing();

  return result;
}

/**
 * The resume terms the pool read filters on — "reverse ATS" in one line.
 *
 * An ATS scores candidates against a job. This scores jobs against a
 * candidate, and that has to start at the QUERY, not at the scoring: reading
 * the newest N rows and ranking them is only resume-driven if the resume had
 * some say in which N. It did not, and the result was a pool of long-haul
 * trucking scored against a Python resume.
 *
 * Titles lead. A title is the single most reliable statement of what a job is,
 * and it is the one field Adzuna never truncates — unlike the ~200-character
 * description its keywords are extracted from, which is why the pool's own
 * "skills" include `pay`, `earn` and `annually`. Skills follow, heaviest
 * first, because query.js keeps only the first MAX_RELEVANCE_TERMS.
 *
 * @param {object} resumeProfile From buildResumeProfile().
 * @returns {string[]} Terms, most-signal first; empty for a junk profile.
 */
export function resumeTerms(resumeProfile) {
  const profile = resumeProfile && typeof resumeProfile === 'object' ? resumeProfile : {};
  const titles = Array.isArray(profile.titles) ? profile.titles : [];

  const keywordSet = profile.keywordSet instanceof Map ? profile.keywordSet : new Map();
  const skills = [...keywordSet.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([term]) => term);

  const out = [];
  for (const value of [...titles, ...skills]) {
    const term = String(value || '').trim();
    if (term && !out.includes(term)) out.push(term);
  }
  return out;
}

/**
 * Run the prefilter over client-shaped jobs and get the ORIGINAL jobs back.
 *
 * src/matching/ reads database column names (`keyword_terms`, `posted_at`),
 * but everything downstream of the prefilter — rankBatch, keywordResult, the
 * wire envelope — needs the full camelCase job. Feeding the matcher view
 * straight in would fix the scoring and break the ranking; feeding the client
 * job in scores it blind. So score the view, return the original, and key the
 * two together by object identity.
 *
 * Both prefilter call sites in this file go through here on purpose. They
 * drifted apart once already: `toMatcherJob` was written for exactly this
 * mismatch (see its docstring in query.js) and then neither site used it, so
 * the `keyword_terms` fallback never fired and the sort's `posted_at` tiebreak
 * was dead for every job the graph ever ranked.
 *
 * @param {object} resumeProfile From buildResumeProfile().
 * @param {object[]} jobs Client-shaped jobs from toClientJob().
 * @param {number} limit Candidates to keep.
 * @returns {object[]} The surviving ORIGINAL jobs, best first.
 */
function prefilterClientJobs(resumeProfile, jobs, limit) {
  const origins = new Map();
  const views = (Array.isArray(jobs) ? jobs : []).map((job) => {
    const view = toMatcherJob(job);
    origins.set(view, job);
    return view;
  });
  // minScore 0: drop the ZERO-overlap tail only. The pool read tops itself up
  // with recency when relevance underfills, so without this the filler rides
  // through to the scorer and onto the page.
  //
  // This CAN now return an empty list, and that is deliberate — see THE FLOOR
  // in src/matching/prefilter.js. An empty candidate set means nothing in the
  // pool shares a term with the résumé, which for a thin location is the true
  // answer and is rendered as "no matches" rather than broadened away.
  return prefilterJobs(resumeProfile, views, { limit, minScore: 0 })
    .map((entry) => origins.get(entry.job));
}

/**
 * Score a job list with no model at all.
 *
 * The answer to "you are over the rate limit" and to "the provider is down":
 * a complete, honestly-labelled list produced from the local matcher, in the
 * same shape the graph returns, so a caller swaps one for the other without
 * knowing which it holds.
 *
 * @param {object} resumeProfile From buildResumeProfile(); junk is tolerated.
 * @param {object[]} jobs Client-shaped jobs; a non-array reads as empty.
 * @param {string} [reason] Recorded on every row as `fallbackReason`.
 * @returns {object} The same shape {@link runRankGraph} returns, always with
 *   `degraded: true` and `loops: 0` — no model ran, so nothing was broadened.
 */
export function keywordOnlyResult(resumeProfile, jobs, reason = 'rate_limited') {
  const list = Array.isArray(jobs) ? jobs : [];
  const candidates = prefilterClientJobs(resumeProfile, list, PREFILTER_LIMIT);
  const ranked = candidates
    .map((job) => keywordResult(resumeProfile, job, reason))
    .sort((a, b) => b.score - a.score);

  return {
    jobs: ranked,
    loops: 0,
    reformulations: [],
    // Nothing was broadened — this path reads the pool once, under the user's
    // own filters — so every job on it honours them.
    relaxedFilters: [],
    inFilterCount: ranked.length,
    degraded: true,
    scoredBy: 'keyword',
    sources: summarizeSources(ranked),
    timings: { totalMs: 0, prefilterMs: 0, rankMs: 0, reformulateMs: 0 },
    poolSize: list.length,
    sentToScorer: candidates.length,
    matcherVersion: MATCHER_VERSION,
  };
}
