/**
 * The ranking graph: the gate, the loop bound, and totality.
 *
 * Everything the graph touches is injected — the pool reader, the model
 * caller, the trace — so all of this runs with no database and no provider.
 * That is the point of the design and it is what makes these assertions
 * meaningful while both are unreachable.
 *
 * The three things worth failing a build over:
 *
 *   1. THE GATE. Enough good matches stops the loop; not enough continues it.
 *      A gate that never fires is an unbounded spend; one that always fires
 *      makes reformulation dead code.
 *   2. THE LOOP BOUND. MAX_LOOPS = 2, hard, even when the gate never passes.
 *      Some searches have no good matches in the pool and the graph must say
 *      so rather than keep paying to rediscover it.
 *   3. TOTALITY. runRankGraph never throws. A job seeker gets a list and an
 *      explanation, never an error page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'error';

const {
  runRankGraph,
  keywordOnlyResult,
  MAX_LOOPS,
  GOOD_SCORE,
  ENOUGH_GOOD_MATCHES,
  PREFILTER_LIMIT,
  MIN_MATCH_SCORE,
  applyScoreFloor,
  summarizeSources,
} = await import('../../server/jobs/graph.js');
const { buildResumeProfile } = await import('../../src/matching/index.js');

const PROFILE = buildResumeProfile({
  skills: ['javascript', 'node.js', 'postgresql', 'react', 'typescript', 'docker'],
  titles: ['Backend Engineer'],
  yearsExperience: 6,
});

function makeJobs(n, overrides = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `u${i}`,
    jobId: `adzuna:${i}`,
    source: i % 2 === 0 ? 'adzuna' : 'remotive',
    title: `Backend Engineer ${i}`,
    company: 'Acme',
    location: 'Berlin',
    isRemote: true,
    keywordTerms: ['javascript', 'node.js', 'postgresql'],
    keywords: [{ t: 'javascript', w: 1 }, { t: 'node.js', w: 1 }],
    requirements: [],
    descriptionQuality: 'full',
    postedAt: '2024-05-01T00:00:00.000Z',
    ...overrides,
  }));
}

/** A model that scores every job it is asked about at `score`. */
function scorer(score) {
  return async ({ user }) => {
    const ids = [...String(user).matchAll(/"jobId":\s*"([^"]+)"/g)].map((m) => m[1]);
    return JSON.stringify(
      ids.map((jobId) => ({
        jobId,
        score,
        gapSummary: 'A sentence.',
        matchedSignals: [],
        missingSignals: [],
      }))
    );
  };
}

/** A pool reader that records the filters it was called with. */
function poolOf(jobs) {
  const seen = [];
  return {
    seen,
    fetchJobs: async (filters) => {
      seen.push({ ...filters });
      return { jobs, nextCursor: null };
    },
  };
}

// ------------------------------------------------------------------
// The gate
// ------------------------------------------------------------------
test('the gate passes on the first pass at ENOUGH_GOOD_MATCHES jobs scoring GOOD_SCORE', async () => {
  const pool = poolOf(makeJobs(10));
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin', remote: 'true' },
    deps: { fetchJobs: pool.fetchJobs, callModel: scorer(GOOD_SCORE) },
  });

  assert.equal(result.loops, 0, 'enough good matches means no reformulation');
  assert.deepEqual(result.reformulations, []);
  assert.equal(result.degraded, false);
  assert.equal(result.scoredBy, 'llm');
  assert.equal(pool.seen.length, 1, 'the pool is read once when the gate passes');
  assert.ok(result.jobs.length >= ENOUGH_GOOD_MATCHES);
});

test('a score one point below GOOD_SCORE does not satisfy the gate', async () => {
  const pool = poolOf(makeJobs(10));
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin', remote: 'true' },
    deps: { fetchJobs: pool.fetchJobs, callModel: scorer(GOOD_SCORE - 1) },
    options: { broaden: true },
  });
  assert.ok(result.loops > 0, 'below the threshold the graph must broaden');
});

test('enough jobs but not enough GOOD ones still reformulates', async () => {
  const pool = poolOf(makeJobs(40));
  let call = 0;
  // Exactly four good jobs in the first pass — one short of the gate.
  const callModel = async ({ user }) => {
    const ids = [...String(user).matchAll(/"jobId":\s*"([^"]+)"/g)].map((m) => m[1]);
    return JSON.stringify(
      ids.map((jobId) => {
        call += 1;
        return {
          jobId,
          score: call <= ENOUGH_GOOD_MATCHES - 1 ? GOOD_SCORE + 10 : 20,
          gapSummary: 'x',
          matchedSignals: [],
          missingSignals: [],
        };
      })
    );
  };

  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin', remote: 'true' },
    deps: { fetchJobs: pool.fetchJobs, callModel },
    options: { broaden: true },
  });
  assert.ok(result.loops >= 1);
});

// ------------------------------------------------------------------
// The loop bound
// ------------------------------------------------------------------
test('reformulation stops at exactly MAX_LOOPS when the gate never passes', async () => {
  const pool = poolOf(makeJobs(20));
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin', remote: 'true' },
    deps: { fetchJobs: pool.fetchJobs, callModel: scorer(5) },
    options: { broaden: true },
  });

  assert.equal(MAX_LOOPS, 2, 'this test encodes the documented bound');
  assert.equal(result.loops, 2, 'exactly two loops, never three');
  assert.equal(result.reformulations.length, 2);
  // One read per pass: the initial one plus one per loop.
  assert.equal(pool.seen.length, MAX_LOOPS + 1);
  // It found 20 jobs and every one of them scored 5, so the floor returns
  // NONE of them. This assertion used to read `jobs.length > 0` — "a failed
  // search still returns what it found" — and that is the behaviour
  // MIN_MATCH_SCORE exists to end: what it found was twenty 5% matches, and
  // showing them is how the page filled up with work nobody can use. The
  // count has to survive, though; it is what the empty state says instead.
  assert.equal(result.jobs.length, 0, 'nothing scoring 5 may be returned');
  assert.equal(result.belowFloorCount, 20, 'and the run still reports what it cut');
});

test('options.maxLoops can lower the bound but never raise it', async () => {
  const low = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin', remote: 'true' },
    deps: { fetchJobs: poolOf(makeJobs(20)).fetchJobs, callModel: scorer(5) },
    options: { broaden: true },
    options: { broaden: true, maxLoops: 1 },
  });
  assert.equal(low.loops, 1);

  const high = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin', remote: 'true' },
    deps: { fetchJobs: poolOf(makeJobs(20)).fetchJobs, callModel: scorer(5) },
    options: { broaden: true },
    options: { broaden: true, maxLoops: 99 },
  });
  assert.equal(high.loops, MAX_LOOPS, 'the hard cap wins over the option');

  const none = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin', remote: 'true' },
    deps: { fetchJobs: poolOf(makeJobs(20)).fetchJobs, callModel: scorer(5) },
    options: { broaden: true },
    options: { broaden: true, maxLoops: 0 },
  });
  assert.equal(none.loops, 0);
  assert.deepEqual(none.reformulations, []);
});

// ------------------------------------------------------------------
// What the reformulations record
// ------------------------------------------------------------------
test('reformulations record what was broadened, from what, to what, and why', async () => {
  const pool = poolOf(makeJobs(20));
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin', remote: 'true' },
    deps: { fetchJobs: pool.fetchJobs, callModel: scorer(5) },
    options: { broaden: true },
  });

  const [first, second] = result.reformulations;

  assert.equal(first.step, 'drop_location');
  assert.equal(first.broadened, 'location');
  assert.equal(first.from, 'Berlin');
  assert.ok(first.reason.includes('Berlin'), 'the reason must name the thing that changed');
  assert.ok(first.reason.includes(String(GOOD_SCORE)));
  assert.equal(first.loop, 1);
  assert.equal(typeof first.goodBefore, 'number');

  assert.equal(second.step, 'relax_remote');
  assert.equal(second.broadened, 'remote');
  assert.equal(second.to, 'any');
  assert.equal(second.loop, 2);
});

test('the broadened filters are actually applied to the next pool read', async () => {
  const pool = poolOf(makeJobs(20));
  await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin', remote: 'true' },
    deps: { fetchJobs: pool.fetchJobs, callModel: scorer(5) },
    options: { broaden: true },
  });

  assert.equal(pool.seen[0].location, 'Berlin');
  assert.equal(pool.seen[0].remote, 'true');
  assert.equal(pool.seen[1].location, '', 'the second read must have dropped the location');
  assert.equal(pool.seen[2].remote, 'any', 'the third read must have relaxed remote');
});

test('with no location and no remote filter, broadening widens the skill terms instead', async () => {
  const pool = poolOf(makeJobs(20));
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: {},
    deps: { fetchJobs: pool.fetchJobs, callModel: scorer(5) },
    options: { broaden: true },
  });

  assert.equal(result.loops, 2);
  assert.equal(result.reformulations[0].step, 'widen_terms');
  assert.ok(result.reformulations[0].addedTerms.length > 0);
  assert.ok(result.reformulations[0].to.length > 0, 'the adjacent categories are named');
});

// ------------------------------------------------------------------
// Totality
// ------------------------------------------------------------------
test('a throwing fetchJobs returns a valid degraded result rather than throwing', async () => {
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin' },
    deps: {
      fetchJobs: async () => { throw new Error('getaddrinfo ENOTFOUND db.supabase.co'); },
      callModel: scorer(90),
    },
  });

  assert.deepEqual(result.jobs, []);
  assert.equal(result.degraded, true);
  assert.equal(result.scoredBy, 'keyword');
  assert.equal(result.loops, 0);
  assert.ok(Array.isArray(result.reformulations));
  assert.ok(Array.isArray(result.sources));
  assert.ok(result.error.includes('ENOTFOUND'), 'the cause is reported, not swallowed');
  assert.ok(Number.isFinite(result.timings.totalMs));
});

test('a missing fetchJobs is the same shaped degraded result', async () => {
  const result = await runRankGraph({ resumeProfile: PROFILE, deps: {} });
  assert.deepEqual(result.jobs, []);
  assert.equal(result.degraded, true);
  assert.equal(result.scoredBy, 'keyword');
});

test('a throwing callModel returns keyword-scored jobs, degraded, not an error', async () => {
  const pool = poolOf(makeJobs(8));
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: {},
    deps: {
      fetchJobs: pool.fetchJobs,
      callModel: async () => { throw Object.assign(new Error('model decommissioned'), { status: 404 }); },
    },
  });

  assert.equal(result.degraded, true);
  assert.equal(result.scoredBy, 'keyword');
  assert.equal(result.jobs.length, 8);
  assert.ok(result.jobs.every((j) => j.scoredBy === 'keyword'));
});

test('a partially failing model produces scoredBy "mixed" and degraded true', async () => {
  // ═══ WHY THIS SCORES HALF A BATCH RATHER THAN FAILING HALF THE BATCHES ═══
  //
  // It used to alternate whole-call failures, which relied on a pass being
  // several batches. It no longer is: BATCH_SIZE is now >= PREFILTER_LIMIT, so
  // the model is called ONCE per loop and a thrown call degrades the whole
  // list to 'keyword' rather than mixing it.
  //
  // Partial mixing still happens, and this is now the only shape it takes — a
  // model that answers for some of the jobs it was given and drops the rest.
  // rankBatch keyword-scores exactly the dropped ones (missing_entry), which is
  // the behaviour worth pinning: no job is lost, and the result admits it is
  // not wholly model-scored.
  const pool = poolOf(makeJobs(20));
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: {},
    deps: {
      fetchJobs: pool.fetchJobs,
      callModel: async ({ user }) => {
        const ids = [...String(user).matchAll(/"jobId":\s*"([^"]+)"/g)].map((m) => m[1]);
        const answered = ids.slice(0, Math.ceil(ids.length / 2));
        return JSON.stringify(
          answered.map((jobId) => ({
            jobId,
            score: 95,
            gapSummary: 'A sentence.',
            matchedSignals: [],
            missingSignals: [],
          }))
        );
      },
    },
  });

  assert.equal(result.scoredBy, 'mixed');
  assert.equal(result.degraded, true);
  assert.ok(
    result.jobs.some((j) => j.scoredBy === 'llm') && result.jobs.some((j) => j.scoredBy === 'keyword'),
    'both scorers must be represented for "mixed" to mean anything'
  );
});

test('an empty pool is an empty list, not a failure', async () => {
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: {},
    deps: { fetchJobs: async () => ({ jobs: [] }), callModel: scorer(90) },
  });

  assert.deepEqual(result.jobs, []);
  assert.equal(result.degraded, false);
  assert.deepEqual(result.sources, []);
  assert.equal(result.poolSize, 0);
});

test('junk inputs do not throw', async () => {
  for (const params of [
    {},
    { resumeProfile: null, filters: null, deps: null },
    { resumeProfile: 'nope', filters: 'nope', deps: { fetchJobs: 'nope' } },
  ]) {
    const result = await runRankGraph(params);
    assert.ok(Array.isArray(result.jobs), JSON.stringify(params));
    assert.equal(typeof result.degraded, 'boolean');
  }
});

// ------------------------------------------------------------------
// Bounds and shape
// ------------------------------------------------------------------
test('at most PREFILTER_LIMIT jobs reach the model, however large the pool', async () => {
  const pool = poolOf(makeJobs(400));
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: {},
    deps: { fetchJobs: pool.fetchJobs, callModel: scorer(95) },
  });

  assert.equal(result.jobs.length, PREFILTER_LIMIT);
  assert.equal(result.poolSize, 400);
});

test('sources are summarised with counts, largest first', async () => {
  const pool = poolOf(makeJobs(10));
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: {},
    deps: { fetchJobs: pool.fetchJobs, callModel: scorer(95) },
  });

  const total = result.sources.reduce((sum, s) => sum + s.count, 0);
  assert.equal(total, result.jobs.length);
  assert.ok(result.sources.length >= 2);
  assert.ok(result.sources[0].count >= result.sources[1].count);
});

test('the injected trace is used and no span call is required to exist', async () => {
  const opened = [];
  const handle = {
    span(options) { opened.push(options.name); return handle; },
    update() { return handle; },
    end() { return handle; },
  };

  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin' },
    deps: { fetchJobs: poolOf(makeJobs(20)).fetchJobs, callModel: scorer(5), trace: handle },
    options: { broaden: true },
  });

  assert.ok(opened.includes('prefilter'));
  assert.ok(opened.includes('rank_batch'));
  assert.ok(opened.includes('reformulate'));
  assert.equal(opened.filter((n) => n === 'reformulate').length, MAX_LOOPS);
  assert.equal(result.loops, MAX_LOOPS);

  // A trace with nothing on it must not break the graph either.
  const bare = await runRankGraph({
    resumeProfile: PROFILE,
    deps: { fetchJobs: poolOf(makeJobs(6)).fetchJobs, callModel: scorer(95), trace: {} },
    options: { broaden: true },
  });
  assert.equal(bare.jobs.length, 6);
});

// ------------------------------------------------------------------
// keywordOnlyResult
// ------------------------------------------------------------------
test('keywordOnlyResult is shaped like a graph result and is always degraded', async () => {
  const result = keywordOnlyResult(PROFILE, makeJobs(12), 'rate_limited');

  for (const key of ['jobs', 'loops', 'reformulations', 'degraded', 'scoredBy', 'sources', 'timings']) {
    assert.ok(key in result, `missing ${key}`);
  }
  assert.equal(result.degraded, true);
  assert.equal(result.scoredBy, 'keyword');
  assert.equal(result.jobs.length, 12);
  assert.ok(result.jobs.every((j) => j.scoredBy === 'keyword'));

  const scores = result.jobs.map((j) => j.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'must come back ordered');
});

test('keywordOnlyResult on an empty or junk pool is an empty list', () => {
  assert.deepEqual(keywordOnlyResult(PROFILE, []).jobs, []);
  assert.deepEqual(keywordOnlyResult(PROFILE, null).jobs, []);
  assert.deepEqual(keywordOnlyResult(null, null).jobs, []);
});

// ------------------------------------------------------------------
// The prefilter sees client-shaped jobs through toMatcherJob
// ------------------------------------------------------------------

test('a job whose skills live only in keywordTerms survives the prefilter cut', () => {
  // The graph hands prefilterJobs `toClientJob` output (camelCase) while
  // src/matching reads database column names. `keywords` is spelled the same
  // in both shapes, so this never looked broken — but `keywordTerms` never
  // reached `row.keyword_terms`, and a row carrying only the flat mirror
  // prefiltered as zero-signal.
  //
  // The pool must exceed PREFILTER_LIMIT for this to prove anything: below the
  // limit the prefilter drops nothing and any ordering bug is invisible. And
  // the matching job's id sorts LAST on purpose — before the fix every score
  // was 0, ties fell through to ascending id, and a favourably-named job would
  // have survived for the wrong reason.
  const matching = {
    id: 'zzz-match', jobId: 'adzuna:match', title: 'Nothing In The Title', source: 'adzuna',
    keywords: [], keywordTerms: ['javascript', 'node.js', 'postgresql', 'react', 'typescript'],
    requirements: [], descriptionQuality: 'full', postedAt: '2024-05-01T00:00:00.000Z',
  };
  const unrelated = Array.from({ length: PREFILTER_LIMIT + 5 }, (_, i) => ({
    id: `aaa${String(i).padStart(3, '0')}`, jobId: `adzuna:no${i}`,
    title: 'Nothing In The Title', source: 'adzuna',
    keywords: [], keywordTerms: ['forklift', 'cdl-a', 'otr'],
    requirements: [], descriptionQuality: 'full', postedAt: '2024-05-01T00:00:00.000Z',
  }));

  const ranked = keywordOnlyResult(PROFILE, [...unrelated, matching]).jobs;
  // The cut is now the FLOOR, not the limit: the 35 forklift rows share no
  // term with the resume, so they are dropped rather than padding the list out
  // to PREFILTER_LIMIT. See THE FLOOR in src/matching/prefilter.js.
  assert.ok(ranked.length <= PREFILTER_LIMIT, 'the prefilter must respect its limit');
  assert.equal(ranked.length, 1, 'only the overlapping job should survive the floor');
  assert.ok(
    ranked.some((entry) => entry.job.id === 'zzz-match'),
    'the only job overlapping the resume was cut from the candidate set'
  );
});

test('keywordOnlyResult returns the ORIGINAL jobs, not the matcher view', () => {
  // prefilterClientJobs scores a projection and must hand back the full job;
  // returning the view would strip company/url/location from the wire.
  const result = keywordOnlyResult(PROFILE, makeJobs(3));
  for (const entry of result.jobs) {
    assert.ok(entry.job, 'each row carries its job');
    assert.equal(entry.job.company, 'Acme');
    assert.equal(entry.job.location, 'Berlin');
  }
});

// ------------------------------------------------------------------
// Preserving the results found under the caller's own filters
// ------------------------------------------------------------------
//
// The graph broadens by DROPPING filters the user set, so every loop after the
// first reads a pool the user did not ask for. It used to do `ranked =
// batch.results` — an overwrite — which meant the list finally returned was
// scored entirely from the widest pool reached, and the in-filter results were
// computed and then thrown away. On screen that is a Location box reading
// "Berlin" above a list of Dallas jobs, with nothing saying why, and it was
// reported as the location filter being broken.

/** A pool reader that honestly applies the location filter it is handed. */
function locationAwarePool(inFilter, outOfFilter) {
  const seen = [];
  return {
    seen,
    fetchJobs: async (filters) => {
      seen.push({ ...filters });
      const place = filters.location || filters.locationCity
        || filters.locationRegion || filters.locationCountry;
      return { jobs: place ? inFilter : [...inFilter, ...outOfFilter], nextCursor: null };
    },
  };
}

test('jobs found under the caller\'s filters survive every later broadening', async () => {
  // Two in Berlin — short of ENOUGH_GOOD_MATCHES, so the graph is forced to
  // drop the location and read a wider pool.
  const berlin = makeJobs(2).map((j, i) => ({ ...j, jobId: `berlin:${i}`, id: `b${i}` }));
  const elsewhere = makeJobs(10).map((j, i) => ({
    ...j, jobId: `dallas:${i}`, id: `d${i}`, location: 'Dallas', isRemote: false,
  }));
  const pool = locationAwarePool(berlin, elsewhere);

  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin' },
    deps: { fetchJobs: pool.fetchJobs, callModel: scorer(GOOD_SCORE - 1) },
    options: { broaden: true },
  });

  assert.ok(result.reformulations.some((r) => r.step === 'drop_location'), 'the location was dropped');

  const ids = result.jobs.map((entry) => entry.jobId);
  for (const job of berlin) {
    assert.ok(ids.includes(job.jobId), `${job.jobId} was dropped by a later loop`);
  }
  assert.ok(ids.some((id) => id.startsWith('dallas:')), 'broadening still contributes jobs');
  assert.equal(new Set(ids).size, ids.length, 'a job found twice must appear once');
});

test('in-filter jobs lead the list and are the ones counted by inFilterCount', async () => {
  const berlin = makeJobs(2).map((j, i) => ({ ...j, jobId: `berlin:${i}`, id: `b${i}` }));
  const elsewhere = makeJobs(10).map((j, i) => ({
    ...j, jobId: `dallas:${i}`, id: `d${i}`, location: 'Dallas', isRemote: false,
  }));
  const pool = locationAwarePool(berlin, elsewhere);

  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin' },
    deps: { fetchJobs: pool.fetchJobs, callModel: scorer(GOOD_SCORE - 1) },
    options: { broaden: true },
  });

  assert.equal(result.inFilterCount, berlin.length);
  assert.deepEqual(result.relaxedFilters, ['location']);

  // Tier before score: every job honouring the filters precedes every job that
  // does not, whatever the scores happen to be.
  const tiers = result.jobs.map((entry) => (entry.relaxedFilters ? 1 : 0));
  assert.deepEqual(tiers, tiers.slice().sort(), 'a relaxed job sits above an in-filter one');

  // And the label says which filter each one cost.
  const lead = result.jobs.slice(0, berlin.length);
  assert.ok(lead.every((entry) => entry.relaxedFilters === null), 'in-filter jobs are badged as such');
  assert.ok(
    result.jobs.slice(berlin.length).every((entry) => entry.relaxedFilters.includes('location')),
    'broadened jobs name the filter that was dropped'
  );
});

test('a run that never broadens marks every job as honouring the filters', async () => {
  const pool = poolOf(makeJobs(10));
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin', remote: 'true' },
    deps: { fetchJobs: pool.fetchJobs, callModel: scorer(GOOD_SCORE) },
  });

  assert.deepEqual(result.relaxedFilters, []);
  assert.equal(result.inFilterCount, result.jobs.length);
  assert.ok(result.jobs.every((entry) => entry.relaxedFilters === null));
});

test('widening terms is not reported as relaxing a filter', async () => {
  // widen_terms changes what counts as a match, not where a job may come from,
  // so a job found under it still honours every filter the caller set and must
  // not be badged as if it did not.
  const pool = poolOf(makeJobs(10));
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    // No location and no remote: the first two rungs have nothing to give up,
    // so the only reformulation available is widen_terms.
    filters: {},
    deps: { fetchJobs: pool.fetchJobs, callModel: scorer(GOOD_SCORE - 1) },
  });

  assert.ok(
    result.reformulations.every((r) => r.step !== 'drop_location' && r.step !== 'relax_remote'),
    'nothing was there to drop'
  );
  assert.deepEqual(result.relaxedFilters, []);
  assert.ok(result.jobs.every((entry) => entry.relaxedFilters === null));
});

// ------------------------------------------------------------------
// The no-broadening default
// ------------------------------------------------------------------
//
// Every test above that reaches the ladder passes `options: { broaden: true }`.
// These are the ones that pin the DEFAULT, which is the shipped behaviour: a
// thin location returns a short list under the user's own filters rather than
// a long list from somewhere else.

test('by default a thin location is never widened past the filters the user set', async () => {
  // Two in Berlin, ten elsewhere, and a scorer that never reaches the gate —
  // the exact shape that used to force drop_location on loop 1.
  const berlin = makeJobs(2).map((j, i) => ({ ...j, jobId: `berlin:${i}`, id: `b${i}` }));
  const elsewhere = makeJobs(10).map((j, i) => ({
    ...j, jobId: `dallas:${i}`, id: `d${i}`, location: 'Dallas', isRemote: false,
  }));
  const pool = locationAwarePool(berlin, elsewhere);

  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin' },
    deps: { fetchJobs: pool.fetchJobs, callModel: scorer(GOOD_SCORE - 1) },
  });

  assert.equal(result.loops, 0, 'the gate must not trigger a reformulation');
  assert.deepEqual(result.reformulations, [], 'nothing was broadened');
  assert.deepEqual(result.relaxedFilters, [], 'no filter was given up');
  assert.equal(pool.seen.length, 1, 'the pool is read exactly once');
  assert.ok(
    pool.seen.every((f) => f.location === 'Berlin'),
    'every pool read must carry the location the user set'
  );

  const ids = result.jobs.map((entry) => entry.jobId);
  assert.ok(ids.length > 0, 'a thin location still returns what it has');
  assert.ok(
    ids.every((id) => id.startsWith('berlin:')),
    `out-of-filter jobs leaked into the list: ${ids.join(', ')}`
  );
  assert.equal(result.inFilterCount, ids.length, 'every job honours the filters');
  assert.ok(result.jobs.every((entry) => !entry.relaxedFilters));
});

test('a location holding nothing relevant returns an empty list, not a wider one', async () => {
  // The India case: a handful of listings, none sharing a term with the
  // resume. The floor drops them all and the graph says so instead of
  // reaching for another country's jobs.
  const unrelated = makeJobs(8).map((j, i) => ({
    ...j,
    jobId: `india:${i}`,
    id: `i${i}`,
    title: 'Music Producer - Hindi Expert',
    location: 'India',
    keywordTerms: ['music-production', 'mixing', 'hindi'],
    keywords: [],
  }));
  const elsewhere = makeJobs(20).map((j, i) => ({ ...j, jobId: `us:${i}`, id: `u${i}` }));
  const pool = locationAwarePool(unrelated, elsewhere);

  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { locationCountry: 'India' },
    deps: { fetchJobs: pool.fetchJobs, callModel: scorer(GOOD_SCORE) },
  });

  assert.deepEqual(result.jobs, [], 'unrelated jobs must not stand in for matches');
  assert.equal(result.poolSize, 8, 'the pool was read and it really did hold 8');
  assert.equal(result.sentToScorer, 0, 'nothing unrelated should cost a model call');
  assert.deepEqual(result.relaxedFilters, []);
  assert.equal(pool.seen.length, 1);
});

test('options.broaden restores the ladder without a redeploy', async () => {
  const berlin = makeJobs(2).map((j, i) => ({ ...j, jobId: `berlin:${i}`, id: `b${i}` }));
  const elsewhere = makeJobs(10).map((j, i) => ({
    ...j, jobId: `dallas:${i}`, id: `d${i}`, location: 'Dallas', isRemote: false,
  }));

  const off = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin' },
    deps: {
      fetchJobs: locationAwarePool(berlin, elsewhere).fetchJobs,
      callModel: scorer(GOOD_SCORE - 1),
    },
    options: { broaden: false },
  });
  const on = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin' },
    deps: {
      fetchJobs: locationAwarePool(berlin, elsewhere).fetchJobs,
      callModel: scorer(GOOD_SCORE - 1),
    },
    options: { broaden: true },
  });

  assert.equal(off.loops, 0);
  assert.equal(on.loops, MAX_LOOPS, 'the ladder still runs when it is asked for');
  assert.ok(on.reformulations.some((r) => r.step === 'drop_location'));
  assert.ok(on.jobs.length > off.jobs.length, 'broadening is what adds the extra jobs');
});

// ------------------------------------------------------------------
// The match floor
//
// The product rule these encode: a listing below MIN_MATCH_SCORE is never
// shown, in any country, from any source, however short the list becomes. The
// answer to "nothing cleared the bar" is an empty list and a sentence — never
// a wider search. See MIN_MATCH_SCORE and BROADEN_WHEN_THIN in graph.js.
// ------------------------------------------------------------------
test('the floor is 50 and is what the result reports it used', async () => {
  assert.equal(MIN_MATCH_SCORE, 50, 'the documented product bar');
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    deps: { fetchJobs: poolOf(makeJobs(3)).fetchJobs, callModel: scorer(80) },
  });
  assert.equal(result.minScore, MIN_MATCH_SCORE);
});

test('a job one point below the floor is not returned; one point above is', async () => {
  const below = await runRankGraph({
    resumeProfile: PROFILE,
    deps: { fetchJobs: poolOf(makeJobs(4)).fetchJobs, callModel: scorer(MIN_MATCH_SCORE - 1) },
  });
  const at = await runRankGraph({
    resumeProfile: PROFILE,
    deps: { fetchJobs: poolOf(makeJobs(4)).fetchJobs, callModel: scorer(MIN_MATCH_SCORE) },
  });

  assert.equal(below.jobs.length, 0, 'one point under is out');
  assert.equal(below.belowFloorCount, 4);
  // At the floor, not above it: the bar is "50% or better", so an exactly-50
  // job is a match. Off-by-one here silently drops a whole score band.
  assert.equal(at.jobs.length, 4, 'exactly at the floor is in');
  assert.equal(at.belowFloorCount, 0);
});

test('a mixed list keeps only what cleared the floor, and counts the rest', async () => {
  const jobs = makeJobs(6);
  // Scores by index: 90, 70, 50 clear; 49, 20, 0 do not.
  const byIndex = [90, 70, 50, 49, 20, 0];
  const callModel = async ({ user }) => {
    const ids = [...String(user).matchAll(/"jobId":\s*"([^"]+)"/g)].map((m) => m[1]);
    return JSON.stringify(ids.map((jobId) => ({
      jobId,
      score: byIndex[Number(jobId.split(':')[1])] ?? 0,
      gapSummary: 'A sentence.',
      matchedSignals: [],
      missingSignals: [],
    })));
  };

  const result = await runRankGraph({
    resumeProfile: PROFILE,
    deps: { fetchJobs: poolOf(jobs).fetchJobs, callModel },
  });

  assert.deepEqual(result.jobs.map((j) => j.score), [90, 70, 50]);
  assert.equal(result.belowFloorCount, 3);
  // Every derived count describes the LIST, not the scoring run, or the footer
  // and the page disagree about how many jobs there are.
  assert.equal(result.inFilterCount, 3);
  assert.equal(result.sources.reduce((n, s) => n + s.count, 0), 3);
  // ...while the pool numbers still describe the SEARCH. This pair is what
  // lets the empty state say "we scored 6 and none reached 50%".
  assert.equal(result.poolSize, 6);
  assert.equal(result.sentToScorer, 6);
});

test('a thin country returns nothing rather than a low-scoring match', async () => {
  // The India case, in miniature: a handful of listings, one of which shares a
  // term with the resume and scores 10. The old behaviour rendered that 10 as
  // a match; the rule is that it is not one, and that nothing is substituted
  // from anywhere else to replace it.
  const pool = poolOf(makeJobs(3, { location: 'Bengaluru, India' }));
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { locationCountry: 'India' },
    deps: { fetchJobs: pool.fetchJobs, callModel: scorer(10) },
  });

  assert.equal(result.jobs.length, 0, 'not available, rather than unrelated');
  assert.equal(result.belowFloorCount, 3, 'and the count that explains it');
  assert.deepEqual(result.relaxedFilters, [], 'no filter was given up');
  assert.equal(result.loops, 0, 'and no broadening loop was even attempted');
  // One read, under the caller's own filters, every time.
  assert.equal(pool.seen.length, 1);
  assert.equal(pool.seen[0].locationCountry, 'India');
});

test('the floor applies to the degraded keyword path too', async () => {
  // A rate-limited run is the one most likely to be someone's first
  // impression; it must not be the one that shows 10% matches.
  const result = keywordOnlyResult(PROFILE, makeJobs(5, {
    title: 'Pastry Chef',
    keywordTerms: ['baking'],
    keywords: [{ t: 'baking', w: 1 }],
  }), 'rate_limited');

  assert.equal(result.jobs.length, 0);
  assert.equal(result.minScore, MIN_MATCH_SCORE);
  assert.ok(result.jobs.every((j) => j.score >= MIN_MATCH_SCORE));
  assert.equal(result.degraded, true);
});

test('broadening, when switched on, still may not return a sub-floor job', async () => {
  // The two policies compose in one direction only: broadening changes WHERE
  // jobs may come from, never how good they must be. A run with the ladder on
  // and every job scoring 5 returns an empty list exactly like a run with it
  // off — otherwise RANK_BROADEN=1 would quietly reopen the hole the floor
  // was added to close.
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin', remote: 'true' },
    deps: { fetchJobs: poolOf(makeJobs(20)).fetchJobs, callModel: scorer(5) },
    options: { broaden: true },
  });

  assert.ok(result.loops > 0, 'the ladder did run');
  assert.equal(result.jobs.length, 0, 'and still returned nothing below the floor');
});

test('applyScoreFloor is idempotent, which is what lets the route re-apply it', () => {
  // The route runs this a second time over whatever rankWithCache returned, to
  // catch a list cached before the floor existed. That is only safe if a
  // second pass over an already-filtered list cuts nothing.
  const list = [{ score: 90 }, { score: 50 }, { score: 49 }, { score: 0 }];
  const once = applyScoreFloor(list);
  assert.equal(once.cut, 2);
  assert.deepEqual(once.kept.map((j) => j.score), [90, 50]);

  const twice = applyScoreFloor(once.kept);
  assert.equal(twice.cut, 0, 'a second pass must be a no-op');
  assert.deepEqual(twice.kept, once.kept);
});

test('applyScoreFloor survives the shapes the wire can actually deliver', () => {
  // It runs on `outcome.jobs` straight off a cache row, so a missing or
  // non-numeric score must be CUT rather than throw or sneak through as NaN.
  assert.deepEqual(applyScoreFloor(null), { kept: [], cut: 0 });
  assert.deepEqual(applyScoreFloor(undefined), { kept: [], cut: 0 });
  const mixed = applyScoreFloor([{ score: 60 }, {}, { score: null }, { score: 'x' }, null]);
  assert.equal(mixed.kept.length, 1);
  assert.equal(mixed.cut, 4);
});

test('summarizeSources counts the list it is given, largest first', () => {
  // The route calls this to rebuild meta.sources after a cache cut, so the
  // footer's per-source totals add up to the list under it.
  const summary = summarizeSources([
    { job: { source: 'jobicy' } },
    { job: { source: 'adzuna' } },
    { job: { source: 'jobicy' } },
  ]);
  assert.deepEqual(summary, [{ id: 'jobicy', count: 2 }, { id: 'adzuna', count: 1 }]);
});
