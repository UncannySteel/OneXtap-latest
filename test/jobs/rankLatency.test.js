/**
 * Rank latency (HANDOVER §7 item 32: one rank took 27s where the page said
 * "usually 5-20 seconds").
 *
 * Two things are pinned here:
 *
 *   1. THE STAGE TIMINGS. Every rank reports how long its pool read, its model
 *      calls and its trace flush took, so the next slow one names its cause.
 *   2. A JOB IS SCORED ONCE PER RUN. A broadening loop used to send the model
 *      every candidate again, including the ones an earlier loop had scored,
 *      and then throw those second scores away. Now they are not sent. The
 *      returned list must be exactly what it was; only the calls go down.
 *
 * Everything is injected, as in graph.test.js: no database, no provider.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'error';

const { runRankGraph, keywordOnlyResult, MIN_MATCH_SCORE } = await import('../../server/jobs/graph.js');
const { rankBatch, BATCH_SIZE } = await import('../../server/jobs/rank.js');
const { buildResumeProfile } = await import('../../src/matching/index.js');

const PROFILE = buildResumeProfile({
  skills: ['javascript', 'node.js', 'postgresql', 'react', 'typescript'],
  titles: ['Backend Engineer'],
  yearsExperience: 6,
});

function makeJobs(n, prefix, overrides = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-u${i}`,
    jobId: `${prefix}:${i}`,
    source: 'adzuna',
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

const idsIn = (user) => [...String(user).matchAll(/"jobId":\s*"([^"]+)"/g)].map((m) => m[1]);

/**
 * A model whose score depends only on the job, so a job scored twice would
 * score the same — which is what lets "the list is unchanged" be asserted
 * exactly. Records every id it is asked about.
 */
function recordingScorer(scoreOf) {
  const asked = [];
  const calls = [];
  const callModel = async ({ user }) => {
    const ids = idsIn(user);
    calls.push(ids);
    asked.push(...ids);
    return JSON.stringify(ids.map((jobId) => ({
      jobId, score: scoreOf(jobId), gapSummary: 'A sentence.', matchedSignals: [], missingSignals: [],
    })));
  };
  return { asked, calls, callModel };
}

/** Honours the location filter, so dropping it widens the pool. */
function locationAwarePool(inFilter, outOfFilter) {
  return async (filters) => {
    const place = filters.location || filters.locationCity || filters.locationRegion || filters.locationCountry;
    return { jobs: place ? inFilter : [...inFilter, ...outOfFilter], nextCursor: null };
  };
}

// ------------------------------------------------------------------
// A job is scored once per run
// ------------------------------------------------------------------
test('a broadening loop does not ask the model about jobs an earlier loop scored', async () => {
  const berlin = makeJobs(3, 'berlin');
  const dallas = makeJobs(6, 'dallas', { location: 'Dallas', isRemote: false });
  // 55: above the floor, below GOOD_SCORE, so every loop the ladder allows runs.
  const model = recordingScorer(() => 55);

  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin', remote: 'true' },
    deps: { fetchJobs: locationAwarePool(berlin, dallas), callModel: model.callModel },
    options: { broaden: true },
  });

  assert.ok(result.loops >= 1, 'the ladder ran');
  assert.equal(new Set(model.asked).size, model.asked.length, 'no job was sent to the model twice');
  assert.deepEqual(model.calls[0].sort(), berlin.map((j) => j.jobId).sort(), 'loop 0 scores the in-filter jobs');
  assert.ok(model.calls[1].every((id) => id.startsWith('dallas:')), 'loop 1 sends only jobs it has not seen');
  assert.equal(result.timings.reusedJobs >= berlin.length, true, 'the reused scores are counted');
});

test('the list a broadened run returns is what it was before the reuse', async () => {
  // Scores vary by job, so a mix-up between jobs would show. Every job is
  // scored exactly once either way, and the first copy was always the one
  // kept, so the expected list can be written down directly.
  const scoreOf = (jobId) => 50 + (Number(jobId.split(':')[1]) * 7) % 45;
  const berlin = makeJobs(3, 'berlin');
  const dallas = makeJobs(8, 'dallas', { location: 'Dallas', isRemote: false });
  const model = recordingScorer((id) => (id.startsWith('berlin') ? 52 : scoreOf(id)));

  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin' },
    deps: { fetchJobs: locationAwarePool(berlin, dallas), callModel: model.callModel },
    options: { broaden: true },
  });

  const expected = [
    ...berlin.map((j) => ({ jobId: j.jobId, score: 52, relaxed: null })),
    ...dallas
      .map((j) => ({ jobId: j.jobId, score: scoreOf(j.jobId), relaxed: ['location'] }))
      .filter((e) => e.score >= MIN_MATCH_SCORE)
      .sort((a, b) => b.score - a.score || a.jobId.localeCompare(b.jobId)),
  ];
  const got = result.jobs.map((e) => ({ jobId: e.jobId, score: e.score, relaxed: e.relaxedFilters ? [...e.relaxedFilters] : null }));

  assert.deepEqual(got.map((e) => e.jobId).sort(), expected.map((e) => e.jobId).sort());
  for (const want of expected) {
    const have = got.find((e) => e.jobId === want.jobId);
    assert.equal(have.score, want.score, `${want.jobId} kept its score`);
    assert.deepEqual(have.relaxed, want.relaxed, `${want.jobId} kept its badge`);
  }
  assert.equal(result.inFilterCount, berlin.length);
  assert.equal(result.scoredBy, 'llm');
});

test('a loop with nothing new to score makes no model call at all', async () => {
  // With no location and no remote filter the ladder can only widen terms,
  // and this pool is the same on every read: every candidate is already
  // scored after loop 0.
  const jobs = makeJobs(6, 'same');
  const model = recordingScorer(() => 55);

  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: {},
    deps: { fetchJobs: async () => ({ jobs, nextCursor: null }), callModel: model.callModel },
    options: { broaden: true },
  });

  assert.ok(result.loops >= 1);
  assert.equal(model.calls.length, 1, 'only the first pass needed the model');
  assert.equal(result.timings.llmCalls, 1);
  assert.equal(result.jobs.length, jobs.length);
  assert.equal(result.sentToScorer, jobs.length, 'the candidates are still reported as sent to the scorer');
  assert.equal(result.degraded, false);
});

test('without broadening a rank is one pool read and one model call', async () => {
  const model = recordingScorer(() => 80);
  let reads = 0;
  const result = await runRankGraph({
    resumeProfile: PROFILE,
    filters: { location: 'Berlin' },
    deps: {
      fetchJobs: async () => { reads += 1; return { jobs: makeJobs(BATCH_SIZE, 'one'), nextCursor: null }; },
      callModel: model.callModel,
    },
  });

  assert.equal(reads, 1);
  assert.equal(model.calls.length, 1);
  assert.equal(result.timings.llmCalls, 1);
  assert.equal(result.timings.reusedJobs, 0);
});

// ------------------------------------------------------------------
// Stage timings
// ------------------------------------------------------------------
test('a rank reports the time of each stage', async () => {
  const slowPool = async () => {
    await new Promise((r) => setTimeout(r, 30));
    return { jobs: makeJobs(4, 't'), nextCursor: null };
  };
  const slowModel = async (req) => {
    await new Promise((r) => setTimeout(r, 40));
    return recordingScorer(() => 80).callModel(req);
  };

  const { timings } = await runRankGraph({
    resumeProfile: PROFILE,
    deps: { fetchJobs: slowPool, callModel: slowModel },
  });

  for (const key of ['totalMs', 'prefilterMs', 'poolMs', 'rankMs', 'modelMs', 'reformulateMs', 'flushMs', 'llmCalls', 'reusedJobs']) {
    assert.ok(Number.isFinite(timings[key]) && timings[key] >= 0, `timings.${key} must be a finite number`);
  }
  // Timers can fire a millisecond early on some platforms, hence the slack.
  assert.ok(timings.poolMs >= 25, `the pool read took ~30ms, timings say ${timings.poolMs}`);
  assert.ok(timings.modelMs >= 35, `the model took ~40ms, timings say ${timings.modelMs}`);
  assert.ok(timings.prefilterMs >= timings.poolMs, 'the prefilter step includes the pool read');
  assert.ok(timings.rankMs >= timings.modelMs, 'the rank step includes the model call');
  assert.ok(timings.totalMs >= timings.prefilterMs + timings.modelMs - 2);
  assert.equal(timings.llmCalls, 1);
});

test('keywordOnlyResult carries the same timing fields, all zero', () => {
  const { timings } = keywordOnlyResult(PROFILE, makeJobs(3, 'k'));
  for (const key of ['totalMs', 'prefilterMs', 'poolMs', 'rankMs', 'modelMs', 'reformulateMs', 'flushMs', 'llmCalls', 'reusedJobs']) {
    assert.equal(timings[key], 0, key);
  }
});

test('a call that times out or is rate limited is counted in the model time', async () => {
  // The calls that matter most for a slow rank are the ones that fail: a 25s
  // per-model timeout, or a 429 after a wait. They must reach modelMs and
  // slowestCallMs, through rankBatch and through the graph's timings.
  for (const failure of [
    Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    Object.assign(new Error('rate limit reached'), { status: 429 }),
  ]) {
    const callModel = async () => {
      await new Promise((r) => setTimeout(r, 40));
      throw failure;
    };

    const out = await rankBatch({ jobs: makeJobs(3, 'f'), resumeProfile: PROFILE, callModel });
    assert.equal(out.scoredBy, 'keyword', 'the batch degraded, as before');
    assert.ok(out.modelMs >= 35, `${failure.name}: the failed call took ~40ms, modelMs says ${out.modelMs}`);
    assert.ok(out.slowestCallMs >= 35, `${failure.name}: slowestCallMs says ${out.slowestCallMs}`);

    const { timings } = await runRankGraph({
      resumeProfile: PROFILE,
      deps: { fetchJobs: async () => ({ jobs: makeJobs(3, 'g'), nextCursor: null }), callModel },
    });
    assert.ok(timings.modelMs >= 35, `${failure.name}: the graph's modelMs says ${timings.modelMs}`);
    assert.equal(timings.llmCalls, 1);
  }
});

test('rankBatch reports the time spent in the model, failed calls included', async () => {
  const delays = [20, 45];
  let call = 0;
  const callModel = async ({ user }) => {
    const delay = delays[call];
    call += 1;
    await new Promise((r) => setTimeout(r, delay));
    if (call === 2) throw Object.assign(new Error('upstream timeout'), { name: 'TimeoutError' });
    return JSON.stringify(idsIn(user).map((jobId) => ({ jobId, score: 70, gapSummary: 'x', matchedSignals: [], missingSignals: [] })));
  };

  const out = await rankBatch({ jobs: makeJobs(BATCH_SIZE + 1, 'b'), resumeProfile: PROFILE, callModel });
  assert.equal(out.llmCalls, 2);
  assert.ok(out.modelMs >= 60, `two calls of ~20ms and ~45ms, modelMs says ${out.modelMs}`);
  assert.ok(out.slowestCallMs >= 40 && out.slowestCallMs <= out.modelMs, `slowest ~45ms, got ${out.slowestCallMs}`);
  assert.equal(out.results.length, BATCH_SIZE + 1, 'and timing changed nothing about the one rule');

  const empty = await rankBatch({ jobs: [], resumeProfile: PROFILE, callModel });
  assert.equal(empty.modelMs, 0);
  assert.equal(empty.slowestCallMs, 0);
});
