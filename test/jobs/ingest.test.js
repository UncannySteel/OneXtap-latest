/**
 * Ingest orchestrator — the error string it leaves behind, and its totality.
 *
 * What is under test here is not the happy path (that needs live tables) but
 * the two promises runIngest() makes when things go wrong:
 *
 *   1. WHATEVER IT STORES IN last_error IS READABLE. It is the only durable
 *      record of a provider or database failure, it is rendered straight into
 *      the ingest API response, and nobody re-runs a cron job to find out what
 *      broke. A stack trace in that column, or the same sentence printed
 *      twice, is the difference between a diagnosis and a shrug.
 *   2. IT NEVER THROWS. The caller is a cron endpoint; a rejected promise
 *      there is a 500 with no detail about which of four sources broke.
 *
 * Supabase is never reachable in these tests. globalThis.fetch is stubbed to
 * fail, which is what drives the real postgrest-js error shape through
 * formatSupabaseError() and out the other side — no network, no fixtures of
 * somebody else's error format.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// All set before the dynamic imports below. server/supabase.js builds its
// client at module load and refuses an empty URL, and logger.js reads
// LOG_LEVEL at module load. Nothing here is ever dialled: every request in
// this file goes through the stubbed fetch.
process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.LOG_LEVEL = 'error';
process.env.NODE_ENV = 'test';
delete process.env.ADZUNA_APP_ID;
delete process.env.ADZUNA_APP_KEY;

const { runIngest, shortError } = await import('../../server/jobs/ingest.js');
const { formatSupabaseError } = await import('../../server/supabase.js');

/** Replaces globalThis.fetch and returns the restore function. */
function stubFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

/** Fails every request the way an unreachable host does. */
function failingFetch() {
  return stubFetch(async () => { throw new TypeError('fetch failed'); });
}

// ------------------------------------------------------------------
// shortError
// ------------------------------------------------------------------

test('shortError collapses the doubled Supabase network error to one diagnosis', () => {
  // This is postgrest-js's exact shape for a failed fetch: message is
  // `${err.name}: ${err.message}` and details is `err.stack` — whose FIRST
  // LINE is that same string. formatSupabaseError() joins the two, so taking
  // the first line used to yield the diagnosis printed twice.
  const err = new TypeError('fetch failed');
  const postgrestError = {
    message: `${err.name}: ${err.message}`,
    details: err.stack,
    hint: '',
    code: '',
  };

  const joined = formatSupabaseError(postgrestError);
  assert.ok(
    joined.startsWith('TypeError: fetch failed — TypeError: fetch failed'),
    'the doubling this test exists for is no longer being produced upstream; ' +
      `re-check the fix against the real shape, got: ${joined.slice(0, 120)}`,
  );

  assert.equal(shortError(joined), 'TypeError: fetch failed');
  assert.equal(`db: ${shortError(joined)}`, 'db: TypeError: fetch failed');
});

test('shortError keeps a genuine message/details/hint trio intact', () => {
  // De-duplication must only drop a REPEAT. Three different segments are three
  // different facts, and losing the hint loses the fix.
  const joined = formatSupabaseError({
    message: 'duplicate key value violates unique constraint "job_listings_job_id_key"',
    details: 'Key (job_id)=(adzuna:12345) already exists.',
    hint: 'Use onConflict to upsert instead of insert.',
    code: '23505',
  });

  assert.equal(
    shortError(joined),
    'duplicate key value violates unique constraint "job_listings_job_id_key"'
      + ' — Key (job_id)=(adzuna:12345) already exists.'
      + ' — Use onConflict to upsert instead of insert.',
  );
});

test('shortError keeps the first line only, so no stack reaches last_error', () => {
  // Node's fetch errors carry a multi-line "Caused by:" block. Stored whole it
  // fills the column with a trace nobody reads and renders as a wall of text
  // in the API response.
  const multiline = [
    'TypeError: fetch failed',
    '',
    'Caused by: Error: connect ECONNREFUSED 127.0.0.1:9',
    '    at makeNetworkError (node:internal/deps/undici/undici:9269:35)',
    '    at mainFetch (node:internal/deps/undici/undici:10495:20)',
  ].join('\n');

  const short = shortError(multiline);
  assert.equal(short, 'TypeError: fetch failed');
  assert.ok(!short.includes('Caused by'), 'the Caused by block leaked into storage');
  assert.ok(!short.includes('    at '), 'a stack frame leaked into storage');
});

test('shortError caps at 300 characters', () => {
  // last_error is for a human reading a dashboard. The full error is already
  // in the log line next to it.
  assert.equal(shortError('x'.repeat(500)).length, 300);
  // The cap survives de-duplication: two distinct long segments still get cut.
  const twoLongSegments = `${'a'.repeat(250)} — ${'b'.repeat(250)}`;
  assert.equal(shortError(twoLongSegments).length, 300);
});

test('shortError collapses whitespace and returns null for nothing', () => {
  assert.equal(shortError('  spaced\t\tout   message  '), 'spaced out message');
  assert.equal(shortError(null), null);
  assert.equal(shortError(undefined), null);
  assert.equal(shortError(''), null);
  assert.equal(shortError('   '), null);
});

// ------------------------------------------------------------------
// runIngest
// ------------------------------------------------------------------

test('runIngest reports a failed write as an undoubled db: error', async () => {
  const restoreFetch = failingFetch();
  try {
    const report = await runIngest({ sources: ['cache'], maxPages: 1 });

    assert.equal(report.perSource.length, 1);
    const [entry] = report.perSource;
    assert.equal(entry.id, 'cache');
    assert.equal(entry.enabled, true, 'the fixture source must be on outside production');
    assert.ok(entry.fetched > 0, 'fixtures were read, so the failure is the WRITE');

    // The whole point: one diagnosis, prefixed once, no repeat.
    assert.equal(entry.error, 'db: TypeError: fetch failed');
    assert.equal(report.retentionError, 'TypeError: fetch failed');

    // A run where nothing landed is not ok — that is what turns the route into
    // a 500 so a scheduler dashboard shows red rather than green-over-empty.
    assert.equal(report.ok, false);
    assert.equal(report.totalInserted, 0);
  } finally {
    restoreFetch();
  }
});

test('runIngest never throws, whatever it is handed', async () => {
  // The route passes it whatever the query string produced, and a rejected
  // promise from here is a 500 that names none of the sources.
  const restoreFetch = failingFetch();
  try {
    for (const junk of [undefined, null, 42, 'sources=cache', [], { sources: 'not-an-array' }]) {
      const report = await runIngest(junk);
      assert.equal(typeof report, 'object', `junk: ${JSON.stringify(junk) ?? String(junk)}`);
      assert.equal(report.ok, false);
      // Anything unrecognised falls back to the full cascade in cascade order.
      assert.deepEqual(
        report.perSource.map((s) => s.id),
        ['adzuna', 'remotive', 'ats', 'wellfound', 'cache'],
        `junk: ${JSON.stringify(junk) ?? String(junk)}`,
      );
    }

    // An unknown source id narrows the run instead of breaking it.
    const unknown = await runIngest({ sources: ['definitely-not-a-source'] });
    assert.deepEqual(unknown.perSource, []);
    assert.equal(unknown.ok, false, 'zero enabled sources is deliberately NOT ok');
  } finally {
    restoreFetch();
  }
});
