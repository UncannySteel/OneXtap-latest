/**
 * rankBatch's one promise: every job that goes in comes out, exactly once.
 *
 * The model is injected, so every failure mode a provider can produce is a
 * one-line stub here: garbage, half a batch, a renumbered id, a score of
 * "very high", a thrown 404. None of them may remove a job from the list, and
 * none of them may make rankBatch reject.
 *
 * That is not a theoretical concern on this account today — the configured
 * Groq models return 404, so the "callModel throws" path below is the path
 * production is currently on. These tests are what says the feature degrades
 * to a keyword-scored list rather than to an error.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'error';

const { rankBatch, keywordResult, renderPromptParts, BATCH_SIZE, RANK_CONCURRENCY } = await import(
  '../../server/jobs/rank.js'
);
const { buildResumeProfile } = await import('../../src/matching/index.js');

const PROFILE = buildResumeProfile({
  skills: ['javascript', 'node.js', 'postgresql', 'react', 'typescript'],
  titles: ['Backend Engineer'],
  yearsExperience: 6,
});

/** n client-shaped jobs with distinct ids. */
function makeJobs(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `u${i}`,
    jobId: `adzuna:${i}`,
    source: 'adzuna',
    title: `Backend Engineer ${i}`,
    company: 'Acme',
    location: 'Remote',
    isRemote: true,
    keywordTerms: ['javascript', 'node.js', 'postgresql'],
    requirements: ['5+ years backend'],
    descriptionQuality: 'full',
    postedAt: '2024-05-01T00:00:00.000Z',
  }));
}

/** A well-formed model answer for every job in the batch. */
function goodAnswer(batchJobs, score = 80) {
  return JSON.stringify(
    batchJobs.map((j) => ({
      jobId: j.jobId,
      score,
      gapSummary: 'Strong match.',
      matchedSignals: ['Node.js'],
      missingSignals: [],
    }))
  );
}

/** Pull the ids the model was asked about out of the user turn. */
function jobIdsInPrompt(user) {
  return [...String(user).matchAll(/"jobId":\s*"([^"]+)"/g)].map((m) => m[1]);
}

// ------------------------------------------------------------------
// The core promise
// ------------------------------------------------------------------
test('every input job appears exactly once, in input order, on the happy path', async () => {
  const jobs = makeJobs(12);
  const callModel = async ({ user }) => {
    const ids = jobIdsInPrompt(user);
    return goodAnswer(ids.map((jobId) => ({ jobId })));
  };

  const { results, scoredBy, degraded } = await rankBatch({ jobs, resumeProfile: PROFILE, callModel });

  assert.equal(results.length, 12);
  assert.deepEqual(results.map((r) => r.jobId), jobs.map((j) => j.jobId));
  assert.equal(scoredBy, 'llm');
  assert.equal(degraded, false);
});

test('every input job survives when the model returns garbage for half the batches', async () => {
  // Sized FROM BATCH_SIZE: the test is about alternating good and unusable
  // answers ACROSS batches, so it needs at least two of them to exist at
  // whatever BATCH_SIZE currently is. A literal here silently became a
  // single-batch test the moment BATCH_SIZE passed it.
  const jobs = makeJobs(BATCH_SIZE * 2);
  let call = 0;
  const callModel = async ({ user }) => {
    call += 1;
    // Alternate: a usable answer, then something a parser cannot use at all.
    if (call % 2 === 0) return 'Sure! Here are the rankings you asked for. Sorry — I cannot do that.';
    const ids = jobIdsInPrompt(user);
    return goodAnswer(ids.map((jobId) => ({ jobId })));
  };

  const { results, degraded, scoredBy } = await rankBatch({ jobs, resumeProfile: PROFILE, callModel });

  const ids = results.map((r) => r.jobId);
  assert.equal(results.length, jobs.length, 'no job may be lost');
  assert.equal(new Set(ids).size, jobs.length, 'no job may be duplicated');
  assert.deepEqual([...ids].sort(), jobs.map((j) => j.jobId).sort());
  assert.equal(degraded, true);
  assert.equal(scoredBy, 'mixed');
  assert.ok(results.some((r) => r.scoredBy === 'llm'));
  assert.ok(results.some((r) => r.scoredBy === 'keyword'));
});

test('a batch with entries for only some of its jobs keeps the rest, keyword scored', async () => {
  const jobs = makeJobs(5);
  const callModel = async ({ user }) => {
    const ids = jobIdsInPrompt(user).slice(0, 2); // drops three
    return goodAnswer(ids.map((jobId) => ({ jobId })));
  };

  const { results } = await rankBatch({ jobs, resumeProfile: PROFILE, callModel });

  assert.equal(results.length, 5);
  assert.equal(results.filter((r) => r.scoredBy === 'llm').length, 2);
  assert.equal(results.filter((r) => r.scoredBy === 'keyword').length, 3);
});

test('entries are matched by jobId, so a dropped entry does not shift scores onto other jobs', async () => {
  const jobs = makeJobs(3);
  // Answer only for the LAST job. Positional matching would give job 0 this
  // score; id matching gives it to job 2 and keyword-scores the other two.
  const callModel = async () =>
    JSON.stringify([
      { jobId: 'adzuna:2', score: 91, gapSummary: 'Great.', matchedSignals: [], missingSignals: [] },
    ]);

  const { results } = await rankBatch({ jobs, resumeProfile: PROFILE, callModel });
  const byId = new Map(results.map((r) => [r.jobId, r]));

  assert.equal(byId.get('adzuna:2').score, 91);
  assert.equal(byId.get('adzuna:2').scoredBy, 'llm');
  assert.equal(byId.get('adzuna:0').scoredBy, 'keyword');
  assert.equal(byId.get('adzuna:1').scoredBy, 'keyword');
});

test('an invented jobId is ignored and does not add a job to the list', async () => {
  const jobs = makeJobs(2);
  const callModel = async () =>
    JSON.stringify([
      { jobId: 'adzuna:0', score: 70, gapSummary: 'ok', matchedSignals: [], missingSignals: [] },
      { jobId: 'hallucinated:999', score: 99, gapSummary: 'ok', matchedSignals: [], missingSignals: [] },
    ]);

  const { results } = await rankBatch({ jobs, resumeProfile: PROFILE, callModel });
  assert.equal(results.length, 2);
  assert.ok(!results.some((r) => r.jobId === 'hallucinated:999'));
});

// ------------------------------------------------------------------
// Clamping and coercion
// ------------------------------------------------------------------
test('scores are clamped to integers in [0,100]', async () => {
  const jobs = makeJobs(5);
  const scores = [-40, 0.4, 72.6, 100.2, 5000];
  const callModel = async () =>
    JSON.stringify(
      jobs.map((j, i) => ({
        jobId: j.jobId,
        score: scores[i],
        gapSummary: 'x',
        matchedSignals: [],
        missingSignals: [],
      }))
    );

  const { results } = await rankBatch({ jobs, resumeProfile: PROFILE, callModel });
  assert.deepEqual(results.map((r) => r.score), [0, 0, 73, 100, 100]);
  for (const r of results) {
    assert.ok(Number.isInteger(r.score), `${r.score} is not an integer`);
    assert.ok(r.score >= 0 && r.score <= 100);
  }
});

test('a numeric string score is accepted; a non-numeric one falls back rather than becoming 0', async () => {
  const jobs = makeJobs(2);
  const callModel = async () =>
    JSON.stringify([
      { jobId: 'adzuna:0', score: '84', gapSummary: 'x', matchedSignals: [], missingSignals: [] },
      { jobId: 'adzuna:1', score: 'very high', gapSummary: 'x', matchedSignals: [], missingSignals: [] },
    ]);

  const { results } = await rankBatch({ jobs, resumeProfile: PROFILE, callModel });
  const byId = new Map(results.map((r) => [r.jobId, r]));

  assert.equal(byId.get('adzuna:0').score, 84);
  assert.equal(byId.get('adzuna:0').scoredBy, 'llm');
  // A fabricated 0 would sort it to the bottom and look deliberate.
  assert.equal(byId.get('adzuna:1').scoredBy, 'keyword');
  assert.equal(byId.get('adzuna:1').fallbackReason, 'unparseable_score');
});

test('gapSummary is coerced to a string and signal arrays default to []', async () => {
  const jobs = makeJobs(1);
  const callModel = async () =>
    JSON.stringify([{ jobId: 'adzuna:0', score: 50, gapSummary: 17, matchedSignals: 'nope' }]);

  const { results } = await rankBatch({ jobs, resumeProfile: PROFILE, callModel });
  assert.equal(typeof results[0].gapSummary, 'string');
  assert.equal(results[0].gapSummary, '17');
  assert.deepEqual(results[0].matchedSignals, []);
  assert.deepEqual(results[0].missingSignals, []);
});

test('signal arrays are capped at six entries', async () => {
  const jobs = makeJobs(1);
  const many = Array.from({ length: 20 }, (_, i) => `signal ${i}`);
  const callModel = async () =>
    JSON.stringify([
      { jobId: 'adzuna:0', score: 50, gapSummary: 'x', matchedSignals: many, missingSignals: many },
    ]);

  const { results } = await rankBatch({ jobs, resumeProfile: PROFILE, callModel });
  assert.equal(results[0].matchedSignals.length, 6);
  assert.equal(results[0].missingSignals.length, 6);
});

// ------------------------------------------------------------------
// Degradation
// ------------------------------------------------------------------
test('a throwing callModel degrades the whole batch to keyword scoring without throwing', async () => {
  const jobs = makeJobs(7);
  const callModel = async () => {
    const err = new Error('model_not_found: llama-3.3-70b-versatile has been decommissioned');
    err.status = 404;
    throw err;
  };

  const { results, degraded, scoredBy } = await rankBatch({ jobs, resumeProfile: PROFILE, callModel });

  assert.equal(results.length, 7);
  assert.equal(degraded, true);
  assert.equal(scoredBy, 'keyword');
  for (const r of results) {
    assert.equal(r.scoredBy, 'keyword');
    assert.equal(r.fallbackReason, 'batch_error');
    assert.ok(Number.isInteger(r.score));
    assert.ok(typeof r.gapSummary === 'string' && r.gapSummary.length > 0);
  }
});

test('a missing callModel is a degraded result, not a crash', async () => {
  const jobs = makeJobs(4);
  const { results, degraded, scoredBy, llmCalls } = await rankBatch({ jobs, resumeProfile: PROFILE });

  assert.equal(results.length, 4);
  assert.equal(degraded, true);
  assert.equal(scoredBy, 'keyword');
  assert.equal(llmCalls, 0);
});

test('a callModel returning an empty string degrades that batch rather than losing it', async () => {
  const jobs = makeJobs(3);
  const { results, degraded } = await rankBatch({
    jobs,
    resumeProfile: PROFILE,
    callModel: async () => '',
  });
  assert.equal(results.length, 3);
  assert.equal(degraded, true);
});

test('a malformed resume profile still produces one result per job', async () => {
  const jobs = makeJobs(3);
  for (const profile of [null, undefined, {}, 'nonsense']) {
    const { results } = await rankBatch({
      jobs,
      resumeProfile: profile,
      callModel: async () => 'not json',
    });
    assert.equal(results.length, 3, `profile=${String(profile)}`);
  }
});

test('an empty job list is an empty result, not an LLM call', async () => {
  let called = 0;
  const { results, batches, degraded } = await rankBatch({
    jobs: [],
    resumeProfile: PROFILE,
    callModel: async () => { called += 1; return '[]'; },
  });
  assert.deepEqual(results, []);
  assert.equal(batches, 0);
  assert.equal(called, 0);
  assert.equal(degraded, false);
});

// ------------------------------------------------------------------
// Batching
// ------------------------------------------------------------------
test('jobs are split into batches of BATCH_SIZE and each is one model call', async () => {
  // Sized FROM BATCH_SIZE rather than to a literal: two full batches and a
  // short one, whatever BATCH_SIZE currently is. The previous spelling asserted
  // [5, 5, 3] and so stopped testing the split the moment BATCH_SIZE was tuned
  // — it failed for the one reason a test named after a constant should not.
  const REMAINDER = 3;
  const total = BATCH_SIZE * 2 + REMAINDER;
  const jobs = makeJobs(total);
  const sizes = [];
  const callModel = async ({ user }) => {
    const ids = jobIdsInPrompt(user);
    sizes.push(ids.length);
    return goodAnswer(ids.map((jobId) => ({ jobId })));
  };

  const { batches, llmCalls } = await rankBatch({ jobs, resumeProfile: PROFILE, callModel });

  assert.equal(batches, Math.ceil(total / BATCH_SIZE));
  assert.equal(llmCalls, batches);
  assert.deepEqual(sizes.sort((a, b) => b - a), [BATCH_SIZE, BATCH_SIZE, REMAINDER]);
});

test('no more than RANK_CONCURRENCY batches are in flight at once', async () => {
  // Four batches at any BATCH_SIZE, so the pool always has more work queued
  // than it is allowed to run at once — otherwise the cap is untested rather
  // than satisfied.
  const jobs = makeJobs(BATCH_SIZE * 4);
  let inFlight = 0;
  let peak = 0;
  const callModel = async ({ user }) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return goodAnswer(jobIdsInPrompt(user).map((jobId) => ({ jobId })));
  };

  await rankBatch({ jobs, resumeProfile: PROFILE, callModel });
  assert.ok(
    peak <= RANK_CONCURRENCY,
    `expected at most RANK_CONCURRENCY (${RANK_CONCURRENCY}) concurrent batches, saw ${peak}`
  );
  // The pool must actually saturate: with more batches queued than the cap
  // allows, the peak has to REACH the cap. Asserting a bare `peak > 1` instead
  // encoded the old default of two and failed the moment the cap became one —
  // which is the bound holding, not breaking.
  assert.equal(peak, RANK_CONCURRENCY, 'the worker pool should saturate its cap');
});

// ------------------------------------------------------------------
// Parsing tolerance
// ------------------------------------------------------------------
test('a fenced, prefaced or comma-trailing array still parses', async () => {
  for (const wrap of [
    (body) => '```json\n' + body + '\n```',
    (body) => 'Here you go:\n' + body,
    (body) => body.replace(/\]$/, ',]'),
  ]) {
    const jobs = makeJobs(2);
    const body = goodAnswer(jobs, 65);
    const { results, scoredBy } = await rankBatch({
      jobs,
      resumeProfile: PROFILE,
      callModel: async () => wrap(body),
    });
    assert.equal(scoredBy, 'llm');
    assert.ok(results.every((r) => r.score === 65));
  }
});

test('an array wrapped in an object is recovered rather than lost', async () => {
  const jobs = makeJobs(2);
  const callModel = async () => JSON.stringify({ results: JSON.parse(goodAnswer(jobs, 55)) });
  const { results, scoredBy } = await rankBatch({ jobs, resumeProfile: PROFILE, callModel });
  assert.equal(scoredBy, 'llm');
  assert.ok(results.every((r) => r.score === 55));
});

// ------------------------------------------------------------------
// Prompt plumbing
// ------------------------------------------------------------------
test('the prompt is split into a system turn of instructions and a user turn of data', async () => {
  const jobs = makeJobs(1);
  let seen = null;
  await rankBatch({
    jobs,
    resumeProfile: PROFILE,
    callModel: async (req) => { seen = req; return goodAnswer(jobs); },
  });

  assert.ok(seen.system.length > 100, 'instructions belong in the system turn');
  assert.ok(!seen.system.includes('adzuna:0'), 'job data must not be in the system turn');
  assert.ok(seen.user.includes('adzuna:0'), 'job data belongs in the user turn');
  assert.ok(seen.user.includes('Backend Engineer'), 'the profile belongs in the user turn');
  assert.ok(Number.isFinite(seen.maxTokens) && Number.isFinite(seen.temperature));
});

test('the batch never sends a job description to the model', async () => {
  const jobs = makeJobs(2).map((j) => ({ ...j, description: 'SECRET-DESCRIPTION-TEXT' }));
  let seen = null;
  await rankBatch({
    jobs,
    resumeProfile: PROFILE,
    callModel: async (req) => { seen = req; return goodAnswer(jobs); },
  });
  assert.ok(!seen.user.includes('SECRET-DESCRIPTION-TEXT'));
});

test('renderPromptParts substitutes placeholders and leaves unknown ones alone', () => {
  const { system, user } = renderPromptParts(
    'Instructions here.\n\n## Input\n\n{{PROFILE}} and {{JOBS}} and {{UNKNOWN}}',
    { PROFILE: 'P', JOBS: 'J' }
  );
  assert.equal(system, 'Instructions here.');
  assert.ok(user.includes('P and J and {{UNKNOWN}}'));
});

test('renderPromptParts falls back sanely when there is no ## Input heading', () => {
  const { system, user } = renderPromptParts('Just instructions with {{X}}.', { X: 'x' });
  assert.ok(system.length > 0);
  assert.equal(user, 'Just instructions with x.');
});

// ------------------------------------------------------------------
// The keyword result itself
// ------------------------------------------------------------------
test('keywordResult is shaped exactly like an LLM result', async () => {
  const [job] = makeJobs(1);
  const r = keywordResult(PROFILE, job, 'batch_error');

  for (const key of ['job', 'jobId', 'score', 'gapSummary', 'matchedSignals', 'missingSignals', 'scoredBy']) {
    assert.ok(key in r, `missing ${key}`);
  }
  assert.equal(r.scoredBy, 'keyword');
  assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100);
  assert.ok(Array.isArray(r.matchedSignals) && Array.isArray(r.missingSignals));
  assert.ok(r.gapSummary.length > 0, 'a degraded row must still explain itself');
});

test('spans are opened per batch when a trace is given, and no span call throws', async () => {
  // Three batches by construction, at any BATCH_SIZE — see the note on the
  // batching test above.
  const jobs = makeJobs(BATCH_SIZE * 2 + 1);
  const opened = [];
  const trace = {
    span(options) {
      opened.push(options.name);
      const handle = { update: () => handle, end: () => handle, span: () => handle };
      return handle;
    },
  };

  await rankBatch({
    jobs,
    resumeProfile: PROFILE,
    callModel: async ({ user }) => goodAnswer(jobIdsInPrompt(user).map((jobId) => ({ jobId }))),
    trace,
  });

  assert.equal(opened.length, Math.ceil((BATCH_SIZE * 2 + 1) / BATCH_SIZE));
  assert.ok(opened.every((n) => n === 'rank_batch'));
});
