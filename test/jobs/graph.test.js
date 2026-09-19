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
  });

  assert.equal(MAX_LOOPS, 2, 'this test encodes the documented bound');
  assert.equal(result.loops, 2, 'exactly two loops, never three');
  assert.equal(result.reformulations.length, 2);
  // One read per pass: the initial one plus one per loop.
  assert.equal(pool.seen.length, MAX_LOOPS + 1);
  assert.ok(result.jobs.length > 0, 'a failed search still returns what it found');
});

test('options.maxLoops can lower the bound but never raise it', async () => {
  const low = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin', remote: 'true' },
    deps: { fetchJobs: poolOf(makeJobs(20)).fetchJobs, callModel: scorer(5) },
    options: { maxLoops: 1 },
  });
  assert.equal(low.loops, 1);

  const high = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin', remote: 'true' },
    deps: { fetchJobs: poolOf(makeJobs(20)).fetchJobs, callModel: scorer(5) },
    options: { maxLoops: 99 },
  });
  assert.equal(high.loops, MAX_LOOPS, 'the hard cap wins over the option');

  const none = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin', remote: 'true' },
    deps: { fetchJobs: poolOf(makeJobs(20)).fetchJobs, callModel: scorer(5) },
    options: { maxLoops: 0 },
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
