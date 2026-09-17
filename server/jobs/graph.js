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
import { rankBatch, keywordResult } from './rank.js';
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
 */
export const MAX_LOOPS = 2;

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
    source: f.source,
    q: typeof f.q === 'string' ? f.q.trim() : '',
    since: f.since,
  };
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
  if (state.filters.location) {
    const from = state.filters.location;
    state.filters = { ...state.filters, location: '' };
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
 * @returns {Promise<{jobs: object[], loops: number, reformulations: object[],
 *   degraded: boolean, scoredBy: string, sources: object[], timings: object}>}
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

  const requestedLoops = Number.parseInt(options.maxLoops, 10);
  const maxLoops = Number.isFinite(requestedLoops)
    ? Math.max(0, Math.min(requestedLoops, MAX_LOOPS))
    : MAX_LOOPS;

  const { fetchJobs, callModel } = deps;
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
  let degraded = false;
  let ranked = [];
  let scoredBy = 'keyword';
  let poolSize = 0;
  let lastError = null;

  try {
    for (;;) {
      // ── STEP 2: prefilter ────────────────────────────────────────────
      const prefilterStarted = Date.now();
      const prefilterSpan = trace?.span?.({
        name: 'prefilter',
        type: SpanType.Tool,
        input: { loop: loops, filters: state.filters },
      });

      let pool = [];
      try {
        if (typeof fetchJobs !== 'function') throw new Error('No job source configured');
        const page = await fetchJobs({ ...state.filters });
        pool = Array.isArray(page?.jobs) ? page.jobs : [];
      } catch (err) {
        // The pool is unreachable. Nothing downstream can help, but the caller
        // still gets a shaped answer rather than a rejected promise.
        lastError = err;
        degraded = true;
        graphLog.warn('job pool fetch failed', { loop: loops, errName: err?.name });
        prefilterSpan?.update?.({
          output: { error: String(err?.message || err).slice(0, ERROR_TEXT_CHARS) },
        })?.end?.();
        timings.prefilterMs += Date.now() - prefilterStarted;
        break;
      }

      poolSize = pool.length;
      const candidates = prefilterJobs(state.profile, pool, { limit: PREFILTER_LIMIT })
        .map((entry) => entry.job);

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

      ranked = batch.results;
      scoredBy = batch.scoredBy;
      if (batch.degraded) degraded = true;

      // ── GATE ─────────────────────────────────────────────────────────
      const good = ranked.filter((r) => r.score >= GOOD_SCORE).length;
      if (good >= ENOUGH_GOOD_MATCHES || loops >= maxLoops) break;

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
      loops += 1;
    }
  } catch (err) {
    // Belt to the braces above: rankBatch and prefilterJobs are both total, so
    // reaching here means something structural broke. Still not an exception
    // at the route.
    lastError = err;
    degraded = true;
    graphLog.error('rank graph failed', { errName: err?.name });
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
    degraded,
    scoredBy,
    sources: summarizeSources(ranked),
    timings,
    poolSize,
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
  const candidates = prefilterJobs(resumeProfile, list, { limit: PREFILTER_LIMIT })
    .map((entry) => entry.job);
  const ranked = candidates
    .map((job) => keywordResult(resumeProfile, job, reason))
    .sort((a, b) => b.score - a.score);

  return {
    jobs: ranked,
    loops: 0,
    reformulations: [],
    degraded: true,
    scoredBy: 'keyword',
    sources: summarizeSources(ranked),
    timings: { totalMs: 0, prefilterMs: 0, rankMs: 0, reformulateMs: 0 },
    poolSize: list.length,
    matcherVersion: MATCHER_VERSION,
  };
}
