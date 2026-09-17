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

test('a degraded result is not cached, so an outage is not served for six hours', async () => {
  const store = memoryStore();
  let runs = 0;
  const call = () =>
    rankWithCache({
      store,
      userId: 'u1',
      key: 'k',
      runGraph: async () => { runs += 1; return { ...RESULT, degraded: true }; },
      keywordFallback: async () => FALLBACK,
    });

  await call();
  const second = await call();
  assert.equal(runs, 2, 'the graph must be retried, not served from the cache');
  assert.equal(second.cached, false);
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
