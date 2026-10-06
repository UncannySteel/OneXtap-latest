import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_GENERATE_LIMIT,
  GENERATE_WINDOW_MS,
  generateLimitPerHour,
  memoryLimitStore,
  supabaseLimitStore,
  consumeGeneration,
  limitMessage,
  __resetGenerateLimitForTests,
} from '../../server/generateLimit.js';

// The hourly ceiling on AI drafts (server/generateLimit.js). What matters:
// the limit holds within an hour and lifts after it, a refused retry does not
// push the reset further out, and a store that fails lets drafts through
// rather than stopping everyone writing.

/** A clock the test moves by hand. */
function clock(start = Date.UTC(2026, 9, 6, 12, 0, 0)) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('the limit is 30 an hour unless GENERATE_LIMIT_PER_HOUR says otherwise', () => {
  assert.equal(DEFAULT_GENERATE_LIMIT, 30);
  assert.equal(generateLimitPerHour({}), 30);
  assert.equal(generateLimitPerHour({ GENERATE_LIMIT_PER_HOUR: '12' }), 12);
  for (const junk of ['0', '-5', 'ten', '2.5', '', ' ', '1e3']) {
    assert.equal(generateLimitPerHour({ GENERATE_LIMIT_PER_HOUR: junk }), 30, `junk: ${JSON.stringify(junk)}`);
  }
});

test('within an hour the limit holds; after it, it lifts', async () => {
  const c = clock();
  const store = memoryLimitStore({ now: c.now });
  for (let i = 1; i <= 3; i += 1) {
    const r = await store.consume('u1', 3);
    assert.equal(r.allowed, true, `draft ${i}`);
    assert.equal(r.remaining, 3 - i);
  }
  const refused = await store.consume('u1', 3);
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);

  c.advance(GENERATE_WINDOW_MS);
  const fresh = await store.consume('u1', 3);
  assert.equal(fresh.allowed, true);
  assert.equal(fresh.remaining, 2);
});

test('a refused retry does not push the reset further out', async () => {
  const c = clock();
  const store = memoryLimitStore({ now: c.now });
  await store.consume('u1', 1);
  const first = await store.consume('u1', 1);
  c.advance(20 * 60 * 1000);
  const second = await store.consume('u1', 1);
  assert.equal(second.allowed, false);
  assert.equal(second.resetAt, first.resetAt);
});

test('accounts are counted apart', async () => {
  const store = memoryLimitStore();
  assert.equal((await store.consume('u1', 1)).allowed, true);
  assert.equal((await store.consume('u1', 1)).allowed, false);
  assert.equal((await store.consume('u2', 1)).allowed, true);
});

test('the Supabase store reads the window, then writes the new count', async () => {
  const c = clock();
  const writes = [];
  const clientWith = (row) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: row, error: null }),
      upsert: async (value, options) => { writes.push({ value, options }); return { error: null }; },
    };
    return { from: (table) => { assert.equal(table, 'generation_rate_limit'); return builder; } };
  };

  // No row yet: a fresh window, count 1.
  const first = await supabaseLimitStore(clientWith(null), { now: c.now }).consume('u1', 2);
  assert.equal(first.allowed, true);
  assert.deepEqual(writes[0].value, { user_id: 'u1', window_start: new Date(c.now()).toISOString(), request_count: 1 });
  assert.deepEqual(writes[0].options, { onConflict: 'user_id' });

  // At the limit, inside the window: refused, and the count stays.
  const full = { window_start: new Date(c.now()).toISOString(), request_count: 2 };
  const refused = await supabaseLimitStore(clientWith(full), { now: c.now }).consume('u1', 2);
  assert.equal(refused.allowed, false);
  assert.equal(writes[1].value.request_count, 2);
});

test('a store that fails lets the draft through (fail-open), and says so once', async () => {
  __resetGenerateLimitForTests();
  const broken = { consume: async () => { throw new Error('relation "public.generation_rate_limit" does not exist'); } };
  for (let i = 0; i < 3; i += 1) {
    const r = await consumeGeneration(broken, 'u1', { limit: 5 });
    assert.deepEqual(r, { allowed: true, remaining: null, resetAt: null, limit: 5 });
  }
  // And the Supabase store throws on a read error, which is what makes that happen.
  const missingTable = {
    from: () => {
      const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: null, error: { message: 'relation does not exist' } }) };
      return b;
    },
  };
  await assert.rejects(supabaseLimitStore(missingTable).consume('u1', 5), /relation does not exist/);
  __resetGenerateLimitForTests();
});

test('consumeGeneration passes the decision through with its limit', async () => {
  const store = memoryLimitStore();
  const r = await consumeGeneration(store, 'u1', { limit: 1 });
  assert.equal(r.allowed, true);
  assert.equal(r.limit, 1);
  assert.equal((await consumeGeneration(store, 'u1', { limit: 1 })).allowed, false);
});

test('the refusal says how long to wait, in minutes', () => {
  const now = Date.UTC(2026, 9, 6, 12, 0, 0);
  const at = (ms) => new Date(now + ms).toISOString();
  assert.equal(limitMessage(at(25 * 60 * 1000), 30, now), 'That’s the limit of 30 AI drafts an hour. Try again in 25 minutes.');
  assert.equal(limitMessage(at(30 * 1000), 30, now), 'That’s the limit of 30 AI drafts an hour. Try again in 1 minute.');
  assert.equal(limitMessage(at(-5000), 30, now), 'That’s the limit of 30 AI drafts an hour. Try again in 1 minute.');
  assert.equal(limitMessage(null, 12, now), 'That’s the limit of 12 AI drafts an hour. Try again in 60 minutes.');
});
