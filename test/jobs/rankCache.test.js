/**
 * The cache key, the two stores, and the rule that the rate limit is never an
 * error.
 *
 * ═══ WHY THE KEY GETS THIS MUCH ATTENTION ═══
 *
 * A cache key that is sensitive to something it should not be (the order a
 * component spread its filter props) has a hit rate determined by chance, and
 * the feature it exists to make free is not free. A key that is INSENSITIVE to
 * something it should not be — a changed resume, a bumped matcher version — is
 * worse: it serves a stale answer confidently for six hours. Both directions
 * are asserted here.
 *
 * ═══ AND WHY THE LIMIT GETS THE REST ═══
 *
 * Over the limit must never be an error. A job seeker who trips a ceiling they
 * did not know existed should get a slightly worse list with an explanation,
 * not a failure. The eleventh call in an hour returns jobs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'error';

const {
  cacheKey,
  memoryStore,
  supabaseStore,
  createRankStore,
  rankWithCache,
  __resetRankStoreForTests,
  RANK_CACHE_TTL_MS,
  RANK_LIMIT_PER_HOUR,
  RATE_WINDOW_MS,
  rankCacheability,
  PARTIAL_CACHE_TTL_MS,
  PARTIAL_CACHE_MIN_LLM_RATIO,
} = await import('../../server/jobs/rankCache.js');

/** Save and restore the whole environment around a mutation. */
function withEnv(patch, fn) {
  const saved = { ...process.env };
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
}

const BASE = { userId: 'u1', resumeHash: 'r1', matcherVersion: 1 };

// ------------------------------------------------------------------
// cacheKey
// ------------------------------------------------------------------
test('filter key order does not change the key', () => {
  const a = cacheKey({ ...BASE, filters: { remote: 'any', q: 'react', location: 'Berlin' } });
  const b = cacheKey({ ...BASE, filters: { location: 'Berlin', q: 'react', remote: 'any' } });
  assert.equal(a, b);
});

test('nested filter key order does not change the key either', () => {
  const a = cacheKey({ ...BASE, filters: { nested: { z: 1, a: 2 }, q: 'x' } });
  const b = cacheKey({ ...BASE, filters: { q: 'x', nested: { a: 2, z: 1 } } });
  assert.equal(a, b);
});

test('absent, empty and null filters are the same question', () => {
  const none = cacheKey({ ...BASE, filters: {} });
  assert.equal(cacheKey({ ...BASE, filters: { location: '' } }), none);
  assert.equal(cacheKey({ ...BASE, filters: { location: null } }), none);
  assert.equal(cacheKey({ ...BASE, filters: { location: undefined } }), none);
  assert.equal(cacheKey({ ...BASE }), none);
});

test('a changed matcherVersion changes the key', () => {
  const v1 = cacheKey({ ...BASE, matcherVersion: 1, filters: { q: 'react' } });
  const v2 = cacheKey({ ...BASE, matcherVersion: 2, filters: { q: 'react' } });
  assert.notEqual(v1, v2, 'a new scorer must not serve results from the old one');
});

test('a changed resume, user or filter value changes the key', () => {
  const base = cacheKey({ ...BASE, filters: { q: 'react' } });
  assert.notEqual(cacheKey({ ...BASE, resumeHash: 'r2', filters: { q: 'react' } }), base);
  assert.notEqual(cacheKey({ ...BASE, userId: 'u2', filters: { q: 'react' } }), base);
  assert.notEqual(cacheKey({ ...BASE, filters: { q: 'vue' } }), base);
  assert.notEqual(cacheKey({ ...BASE, filters: { q: 'react', remote: 'true' } }), base);
});

test('array order IS significant, because it is data rather than key order', () => {
  const a = cacheKey({ ...BASE, filters: { source: ['adzuna', 'remotive'] } });
  const b = cacheKey({ ...BASE, filters: { source: ['remotive', 'adzuna'] } });
  assert.notEqual(a, b);
});

test('cacheKey is a hex digest and is total on junk input', () => {
  assert.match(cacheKey(BASE), /^[0-9a-f]{64}$/);
  assert.match(cacheKey(), /^[0-9a-f]{64}$/);
  assert.match(cacheKey({ filters: 'not an object' }), /^[0-9a-f]{64}$/);
  assert.match(cacheKey({ userId: null, resumeHash: undefined }), /^[0-9a-f]{64}$/);
});

// ------------------------------------------------------------------
// memoryStore
// ------------------------------------------------------------------
test('memoryStore round-trips a payload and scopes it to the user', async () => {
  const store = memoryStore();
  await store.set('u1', 'k', { jobs: [1, 2] });

  assert.deepEqual(await store.get('u1', 'k'), { jobs: [1, 2] });
  assert.equal(await store.get('u2', 'k'), null, 'entries are never shared between users');
  assert.equal(await store.get('u1', 'other'), null);
});

test('an expired entry reads as a miss', async () => {
  const store = memoryStore();
  await store.set('u1', 'k', { jobs: [] }, -1);
  assert.equal(await store.get('u1', 'k'), null);
});

test('the TTL is six hours', () => {
  assert.equal(RANK_CACHE_TTL_MS, 6 * 60 * 60 * 1000);
});

test('memoryStore.consume counts up to the limit and then refuses', async () => {
  const store = memoryStore();
  for (let i = 1; i <= RANK_LIMIT_PER_HOUR; i += 1) {
    const gate = await store.consume('u1', RANK_LIMIT_PER_HOUR, RATE_WINDOW_MS);
    assert.equal(gate.allowed, true, `call ${i} should be allowed`);
    assert.equal(gate.count, i);
  }
  const over = await store.consume('u1', RANK_LIMIT_PER_HOUR, RATE_WINDOW_MS);
  assert.equal(over.allowed, false);
  assert.equal(over.remaining, 0);
  assert.ok(over.resetAt);
});

test('a refused call does not advance the count, so retrying cannot push the reset away', async () => {
  const store = memoryStore();
  for (let i = 0; i < RANK_LIMIT_PER_HOUR + 3; i += 1) {
    await store.consume('u1', RANK_LIMIT_PER_HOUR, RATE_WINDOW_MS);
  }
  const gate = await store.consume('u1', RANK_LIMIT_PER_HOUR, RATE_WINDOW_MS);
  assert.equal(gate.count, RANK_LIMIT_PER_HOUR);
});

test('a fresh window resets the count', async () => {
  const store = memoryStore();
  for (let i = 0; i < RANK_LIMIT_PER_HOUR; i += 1) await store.consume('u1', RANK_LIMIT_PER_HOUR, 1);
  await new Promise((r) => setTimeout(r, 5));
  const gate = await store.consume('u1', RANK_LIMIT_PER_HOUR, 1);
  assert.equal(gate.allowed, true);
  assert.equal(gate.count, 1);
});

test('limits are per user', async () => {
  const store = memoryStore();
  for (let i = 0; i < RANK_LIMIT_PER_HOUR + 2; i += 1) {
    await store.consume('u1', RANK_LIMIT_PER_HOUR, RATE_WINDOW_MS);
  }
  const other = await store.consume('u2', RANK_LIMIT_PER_HOUR, RATE_WINDOW_MS);
  assert.equal(other.allowed, true);
});

// ------------------------------------------------------------------
// supabaseStore — same interface, stubbed client
// ------------------------------------------------------------------
test('memoryStore and supabaseStore expose the same interface', () => {
  const memory = memoryStore();
  const remote = supabaseStore({});
  for (const method of ['get', 'set', 'consume']) {
    assert.equal(typeof memory[method], 'function', `memory.${method}`);
    assert.equal(typeof remote[method], 'function', `supabase.${method}`);
  }
});

test('supabaseStore reads rank_cache and honours expires_at', async () => {
  const future = { payload: { jobs: [1] }, expires_at: new Date(Date.now() + 60000).toISOString() };
  const past = { payload: { jobs: [1] }, expires_at: new Date(Date.now() - 60000).toISOString() };

  const clientFor = (row) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: row, error: null }),
    };
    return { from: () => builder };
  };

  assert.deepEqual(await supabaseStore(clientFor(future)).get('u1', 'k'), { jobs: [1] });
  assert.equal(await supabaseStore(clientFor(past)).get('u1', 'k'), null);
  assert.equal(await supabaseStore(clientFor(null)).get('u1', 'k'), null);
});

test('supabaseStore.set upserts on the (user_id, cache_key) pair', async () => {
  let seen = null;
  const builder = {
    upsert: async (row, options) => { seen = { row, options }; return { error: null }; },
  };
  await supabaseStore({ from: () => builder }).set('u1', 'k', { jobs: [] });

  assert.equal(seen.row.user_id, 'u1');
  assert.equal(seen.row.cache_key, 'k');
  assert.equal(seen.options.onConflict, 'user_id,cache_key');
  assert.ok(new Date(seen.row.expires_at).getTime() > Date.now());
});

test('supabaseStore.consume counts within a window and refuses past the limit', async () => {
  const makeClient = (row) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: row, error: null }),
      upsert: async () => ({ error: null }),
    };
    return { from: () => builder };
  };

  const under = await supabaseStore(
    makeClient({ window_start: new Date().toISOString(), request_count: 3 })
  ).consume('u1', RANK_LIMIT_PER_HOUR, RATE_WINDOW_MS);
  assert.equal(under.allowed, true);
  assert.equal(under.count, 4);

  const over = await supabaseStore(
    makeClient({ window_start: new Date().toISOString(), request_count: RANK_LIMIT_PER_HOUR })
  ).consume('u1', RANK_LIMIT_PER_HOUR, RATE_WINDOW_MS);
  assert.equal(over.allowed, false);

  const stale = await supabaseStore(
    makeClient({
      window_start: new Date(Date.now() - RATE_WINDOW_MS - 1000).toISOString(),
      request_count: 99,
    })
  ).consume('u1', RANK_LIMIT_PER_HOUR, RATE_WINDOW_MS);
  assert.equal(stale.allowed, true, 'a window older than the period starts over');
  assert.equal(stale.count, 1);
});

test('a supabase error surfaces from the store so rankWithCache can fail open', async () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: null, error: { message: 'relation does not exist' } }),
  };
  await assert.rejects(
    () => supabaseStore({ from: () => builder }).get('u1', 'k'),
    /relation does not exist/
  );
});

// ------------------------------------------------------------------
// createRankStore
// ------------------------------------------------------------------
test('createRankStore falls back to memory when Supabase is unconfigured', () => {
  withEnv({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }, () => {
    __resetRankStoreForTests();
    assert.equal(createRankStore({ client: {}, fresh: true }).kind, 'memory');
  });
});

test('createRankStore uses supabase when configured and given a client', () => {
  withEnv({ SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'x' }, () => {
    __resetRankStoreForTests();
    assert.equal(createRankStore({ client: {}, fresh: true }).kind, 'supabase');
    // Configured but no client is still memory: there is nothing to call.
    assert.equal(createRankStore({ fresh: true }).kind, 'memory');
  });
  __resetRankStoreForTests();
});

test('createRankStore memoises so the choice is made and logged once', () => {
  withEnv({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }, () => {
    __resetRankStoreForTests();
    assert.equal(createRankStore({}), createRankStore({}));
  });
  __resetRankStoreForTests();
});

// ------------------------------------------------------------------
// rankWithCache
// ------------------------------------------------------------------
const RESULT = { jobs: [{ jobId: 'adzuna:1', score: 80 }], degraded: false, scoredBy: 'llm' };
const FALLBACK = { jobs: [{ jobId: 'adzuna:1', score: 40 }], degraded: true, scoredBy: 'keyword' };

/** rankWithCache wired to a fresh memory store, counting what ran. */
function harness(overrides = {}) {
  const store = memoryStore();
  const counts = { graph: 0, fallback: 0 };
  const call = (opts = {}) =>
    rankWithCache({
      store,
      userId: 'u1',
      key: 'k',
      runGraph: async () => { counts.graph += 1; return RESULT; },
      keywordFallback: async () => { counts.fallback += 1; return FALLBACK; },
      ...overrides,
      ...opts,
    });
  return { store, counts, call };
}

test('a miss runs the graph and caches; a hit runs neither', async () => {
  const { counts, call } = harness();

  const first = await call();
  assert.equal(first.cached, false);
  assert.equal(first.limited, false);
  assert.deepEqual(first.jobs, RESULT.jobs);
  assert.equal(counts.graph, 1);

  const second = await call();
  assert.equal(second.cached, true, 'a re-render must cost zero LLM calls');
  assert.equal(counts.graph, 1, 'the graph must not run again');
});

test('a cache hit does not consume rate-limit budget', async () => {
  const { store, call } = harness();
  await call();
  for (let i = 0; i < 50; i += 1) await call();
  const gate = await store.consume('u1', RANK_LIMIT_PER_HOUR, RATE_WINDOW_MS);
  assert.equal(gate.count, 2, 'only the first, uncached call consumed budget');
});

/** Run the same result twice through one store; report whether it was kept. */
async function cachesAcrossCalls(result) {
  const store = memoryStore();
  let runs = 0;
  const call = () =>
    rankWithCache({
      store,
      userId: 'u1',
      key: 'k',
      runGraph: async () => { runs += 1; return result; },
      keywordFallback: async () => FALLBACK,
    });
  await call();
  const second = await call();
  return { runs, cached: second.cached === true };
}

test('an outage is not cached, so it is not served for six hours', async () => {
  // A real outage: nothing was model-scored and the provider said why. NOTE
  // the fixture used to be `{...RESULT, degraded: true}` — a fully
  // model-scored list with the flag set — which is not an outage at all, and
  // treating it as one is the bug rankCacheability was written to fix.
  const outage = {
    jobs: [{ jobId: 'adzuna:1', score: 80, scoredBy: 'keyword' }],
    degraded: true,
    scoredBy: 'keyword',
    degradeReason: 'provider_down',
  };
  const { runs, cached } = await cachesAcrossCalls(outage);
  assert.equal(runs, 2, 'the graph must be retried, not served from the cache');
  assert.equal(cached, false);
});

test('a mostly model-scored run IS cached, even though it is degraded', async () => {
  // The measured case, 2026-09-20: a United States rank scored 28 of 30 jobs
  // with the model and keyword-scored 2. `degraded` is true because
  // rankBatch's rule is `some(r => r.scoredBy !== 'llm')`, and the old check
  // threw the whole thing away — so the most expensive runs were the ones that
  // never cached, against a provider rationed per day.
  const mixed = {
    jobs: Array.from({ length: 30 }, (_, i) => ({
      jobId: `adzuna:${i}`, score: 70, scoredBy: i < 28 ? 'llm' : 'keyword',
    })),
    degraded: true,
    scoredBy: 'mixed',
  };
  const { runs, cached } = await cachesAcrossCalls(mixed);
  assert.equal(runs, 1, 'the second call must be served from the cache');
  assert.equal(cached, true);
});

test('a half keyword-scored list is not worth pinning', async () => {
  // The other side of the threshold. Half keyword-scored is the provider
  // visibly failing, and storing it means a user who retries gets the same bad
  // list back without the retry having achieved anything.
  const half = {
    jobs: Array.from({ length: 10 }, (_, i) => ({
      jobId: `adzuna:${i}`, score: 70, scoredBy: i < 5 ? 'llm' : 'keyword',
    })),
    degraded: true,
    scoredBy: 'mixed',
  };
  const { runs, cached } = await cachesAcrossCalls(half);
  assert.equal(runs, 2);
  assert.equal(cached, false);
});

test('an empty list from a HEALTHY run is cached; from a failed one it is not', async () => {
  // With the 50% match floor an empty list is a normal outcome — India holds a
  // handful of listings and none of them suit a software resume. Re-running
  // six model calls to rediscover that on every visit is exactly the waste
  // this predicate exists to stop. But empty AFTER a provider failure is not
  // an answer: a working model might have cleared the floor.
  const healthy = await cachesAcrossCalls({
    jobs: [], degraded: false, scoredBy: 'keyword', belowFloorCount: 1, degradeReason: null,
  });
  assert.equal(healthy.runs, 1, 'a healthy empty answer is worth remembering');
  assert.equal(healthy.cached, true);

  const failed = await cachesAcrossCalls({
    jobs: [], degraded: true, scoredBy: 'keyword', degradeReason: 'rate_limited',
  });
  assert.equal(failed.runs, 2, 'empty because the model died must be retried');
  assert.equal(failed.cached, false);
});

test('the eleventh call in an hour is limited, still returns jobs, and is never an error', async () => {
  const store = memoryStore();
  const counts = { graph: 0, fallback: 0 };
  // Distinct keys so nothing is served from the cache — this is the limit
  // being exercised, not the cache.
  const call = (i) =>
    rankWithCache({
      store,
      userId: 'u1',
      key: `k${i}`,
      runGraph: async () => { counts.graph += 1; return RESULT; },
      keywordFallback: async () => { counts.fallback += 1; return FALLBACK; },
    });

  for (let i = 0; i < RANK_LIMIT_PER_HOUR; i += 1) {
    const ok = await call(i);
    assert.equal(ok.limited, false, `call ${i + 1} should be under the limit`);
  }

  const over = await call(RANK_LIMIT_PER_HOUR);

  assert.equal(over.limited, true);
  assert.equal(over.degraded, true);
  assert.ok(over.jobs.length > 0, 'over the limit still returns a list');
  assert.equal(over.scoredBy, 'keyword');
  assert.ok(over.limitResetAt, 'the user is told when they can rank again');
  assert.equal(counts.graph, RANK_LIMIT_PER_HOUR, 'no LLM work past the limit');
  assert.equal(counts.fallback, 1);
});

test('over the limit, a cached answer is still served rather than the fallback', async () => {
  const store = memoryStore();
  let fallbacks = 0;
  const call = (key) =>
    rankWithCache({
      store,
      userId: 'u1',
      key,
      runGraph: async () => RESULT,
      keywordFallback: async () => { fallbacks += 1; return FALLBACK; },
    });

  await call('cached-key');
  for (let i = 0; i < RANK_LIMIT_PER_HOUR + 2; i += 1) await call(`burn${i}`);

  const hit = await call('cached-key');
  assert.equal(hit.cached, true);
  assert.equal(hit.limited, false);
  assert.deepEqual(hit.jobs, RESULT.jobs);
  assert.equal(fallbacks, 3, 'the cached key never reached the fallback');
});

test('a store that throws on read degrades to a miss rather than failing the request', async () => {
  const store = {
    ...memoryStore(),
    get: async () => { throw new Error('rank_cache unreachable'); },
  };
  const result = await rankWithCache({
    store,
    userId: 'u1',
    key: 'k',
    runGraph: async () => RESULT,
    keywordFallback: async () => FALLBACK,
  });
  assert.deepEqual(result.jobs, RESULT.jobs);
  assert.equal(result.cached, false);
});

test('a store that throws on consume fails OPEN — a broken limiter is not an outage', async () => {
  const store = {
    ...memoryStore(),
    consume: async () => { throw new Error('rank_rate_limit unreachable'); },
  };
  const result = await rankWithCache({
    store,
    userId: 'u1',
    key: 'k',
    runGraph: async () => RESULT,
    keywordFallback: async () => FALLBACK,
  });
  assert.equal(result.limited, false);
  assert.deepEqual(result.jobs, RESULT.jobs);
});

test('a store that throws on write still returns the freshly computed result', async () => {
  const base = memoryStore();
  const store = { ...base, set: async () => { throw new Error('disk full'); } };
  const result = await rankWithCache({
    store,
    userId: 'u1',
    key: 'k',
    runGraph: async () => RESULT,
    keywordFallback: async () => FALLBACK,
  });
  assert.deepEqual(result.jobs, RESULT.jobs);
});

test('the documented limit is ten per hour', () => {
  assert.equal(RANK_LIMIT_PER_HOUR, 10);
  assert.equal(RATE_WINDOW_MS, 60 * 60 * 1000);
});

// ------------------------------------------------------------------
// rankCacheability
//
// The ladder in one place, so a change to the order is a failing test rather
// than a silently different cache.
// ------------------------------------------------------------------
const jobsScored = (llm, keyword) => [
  ...Array.from({ length: llm }, (_, i) => ({ jobId: `l${i}`, score: 70, scoredBy: 'llm' })),
  ...Array.from({ length: keyword }, (_, i) => ({ jobId: `k${i}`, score: 70, scoredBy: 'keyword' })),
];

test('a clean run caches at the full TTL', () => {
  const d = rankCacheability({ jobs: jobsScored(10, 0), scoredBy: 'llm' });
  assert.equal(d.cache, true);
  assert.equal(d.ttlMs, RANK_CACHE_TTL_MS);
  assert.equal(d.reason, 'fully_scored');
});

test('a partial run caches at the SHORTER TTL, not the full one', () => {
  // The shorter TTL is the whole compromise: worth keeping for a burst, not
  // worth being the answer hours after the provider recovered.
  const d = rankCacheability({ jobs: jobsScored(28, 2), scoredBy: 'mixed' });
  assert.equal(d.cache, true);
  assert.equal(d.reason, 'mostly_scored');
  assert.equal(d.ttlMs, PARTIAL_CACHE_TTL_MS);
  assert.ok(d.ttlMs < RANK_CACHE_TTL_MS, 'a partial answer must expire sooner');
});

test('the partial threshold is a real boundary, tested from both sides', () => {
  const total = 10;
  const atRatio = Math.round(PARTIAL_CACHE_MIN_LLM_RATIO * total);
  const at = rankCacheability({ jobs: jobsScored(atRatio, total - atRatio), scoredBy: 'mixed' });
  const under = rankCacheability({ jobs: jobsScored(atRatio - 1, total - atRatio + 1), scoredBy: 'mixed' });
  assert.equal(at.cache, true, 'exactly at the threshold is in');
  assert.equal(under.cache, false, 'one job under it is out');
  assert.equal(under.reason, 'too_much_keyword_scoring');
});

test('the first three rules outrank a perfectly scored list', () => {
  // Order matters: each of these carries a flawless list and must still be
  // refused, because what is wrong with them is not the scoring.
  const clean = { jobs: jobsScored(10, 0), scoredBy: 'llm' };
  assert.deepEqual(
    [
      rankCacheability({ ...clean, error: 'pool unreachable' }).reason,
      rankCacheability({ ...clean, limited: true }).reason,
      rankCacheability({ ...clean, budgetExhausted: true }).reason,
    ],
    ['pool_error', 'rate_limited', 'budget_exhausted']
  );
});

test('no model scoring at all is never cached, however long the list', () => {
  const d = rankCacheability({ jobs: jobsScored(0, 30), scoredBy: 'keyword' });
  assert.equal(d.cache, false);
  assert.equal(d.reason, 'no_model_scoring');
  assert.equal(d.ttlMs, 0, 'a refusal carries no TTL to misread');
});

test('an empty list is decided on degradeReason, not on scoredBy', () => {
  // summarizeScoredBy calls an empty list 'keyword' whether the model was
  // never asked or answered nothing, so scoredBy cannot separate these two —
  // and they need opposite decisions.
  const healthy = rankCacheability({ jobs: [], scoredBy: 'keyword', degradeReason: null });
  const failed = rankCacheability({ jobs: [], scoredBy: 'keyword', degradeReason: 'timeout' });
  assert.equal(healthy.cache, true);
  assert.equal(healthy.reason, 'empty_but_healthy');
  assert.equal(healthy.ttlMs, RANK_CACHE_TTL_MS);
  assert.equal(failed.cache, false);
  assert.equal(failed.reason, 'empty_after_provider_failure');
});

test('a caller-supplied TTL is respected and still caps the partial one', () => {
  const short = 60_000;
  assert.equal(rankCacheability({ jobs: jobsScored(10, 0), scoredBy: 'llm' }, short).ttlMs, short);
  // A partial result may never outlive the TTL the caller asked for, even
  // though PARTIAL_CACHE_TTL_MS is normally the smaller of the two.
  const partial = rankCacheability({ jobs: jobsScored(9, 1), scoredBy: 'mixed' }, short);
  assert.equal(partial.ttlMs, short);
});

test('rankCacheability is total: junk is refused, never thrown on', () => {
  for (const junk of [null, undefined, 0, 'x', [], { jobs: 'not-an-array' }]) {
    const d = rankCacheability(junk);
    assert.equal(typeof d.cache, 'boolean');
    assert.ok(Number.isFinite(d.ttlMs) && d.ttlMs >= 0);
    assert.equal(typeof d.reason, 'string');
  }
});
