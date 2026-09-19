/**
 * The pool query: what it selects, and what a user can type into it.
 *
 * Two things are under test, and neither is "does the query work" — that
 * needs a database, and the database is unreachable. What is testable, and
 * what actually breaks in production, is the SHAPE of the query that gets
 * built:
 *
 *   1. THE COLUMN LIST. `select('*')` would put the description column back
 *      into every pool response the moment someone adds a column, silently
 *      turning a list endpoint into a multi-megabyte one. The stub records
 *      exactly what was asked for.
 *   2. LIKE METACHARACTERS. A user typing `%` into the location box is not
 *      searching for a percent sign; unescaped, they get the entire pool back
 *      and no indication that their filter did nothing.
 *
 * The Supabase client is a parameter of fetchJobPool, so all of this runs with
 * no network and no database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'error';

const {
  escapeLike,
  fetchJobPool,
  toClientJob,
  toMatcherJob,
  resetLocationPartsCache,
  encodeCursor,
  decodeCursor,
  JOB_COLUMNS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} = await import('../../server/jobs/query.js');

/**
 * A Supabase query-builder stub that records every call and resolves to `rows`.
 * Each builder method returns the same object, matching postgrest-js chaining.
 */
function stubClient(rows = [], error = null) {
  const calls = [];
  const builder = {
    select(...args) { calls.push(['select', ...args]); return builder; },
    eq(...args) { calls.push(['eq', ...args]); return builder; },
    in(...args) { calls.push(['in', ...args]); return builder; },
    gte(...args) { calls.push(['gte', ...args]); return builder; },
    lt(...args) { calls.push(['lt', ...args]); return builder; },
    or(...args) { calls.push(['or', ...args]); return builder; },
    ilike(...args) { calls.push(['ilike', ...args]); return builder; },
    order(...args) { calls.push(['order', ...args]); return builder; },
    limit(...args) { calls.push(['limit', ...args]); return builder; },
    then(resolve, reject) {
      return Promise.resolve({ data: rows, error }).then(resolve, reject);
    },
  };
  return {
    calls,
    from(table) { calls.push(['from', table]); return builder; },
  };
}

/** First recorded call with this method name, or undefined. */
function firstCall(client, method) {
  return client.calls.find((c) => c[0] === method);
}

/** Every recorded call with this method name. */
function allCalls(client, method) {
  return client.calls.filter((c) => c[0] === method);
}

// ------------------------------------------------------------------
// escapeLike
// ------------------------------------------------------------------
test('escapeLike neutralises %, _ and backslash', () => {
  assert.equal(escapeLike('100%'), '100\\%');
  assert.equal(escapeLike('a_b'), 'a\\_b');
  assert.equal(escapeLike('c:\\dev'), 'c:\\\\dev');
  assert.equal(escapeLike('%_\\'), '\\%\\_\\\\');
});

test('escapeLike leaves ordinary text untouched', () => {
  assert.equal(escapeLike('San Francisco'), 'San Francisco');
  assert.equal(escapeLike("O'Brien & Co."), "O'Brien & Co.");
});

test('escapeLike does not double-escape a backslash it just emitted', () => {
  // One pass, one replacement per matched character. If the emitted backslash
  // were re-scanned, '%' would become '\\\\%' and the pattern would look for a
  // literal backslash followed by a percent sign.
  assert.equal(escapeLike('%'), '\\%');
  assert.equal(escapeLike('\\%'), '\\\\\\%');
});

test('escapeLike is total on null, undefined and non-strings', () => {
  assert.equal(escapeLike(null), '');
  assert.equal(escapeLike(undefined), '');
  assert.equal(escapeLike(42), '42');
});

test('a location of "%" cannot match the whole pool', async () => {
  const client = stubClient([]);
  await fetchJobPool(client, { location: '%' });
  const ilike = firstCall(client, 'ilike');
  assert.deepEqual(ilike, ['ilike', 'location', '%\\%%']);
  // The wildcards that remain are ours, wrapping an escaped literal.
  assert.ok(!ilike[2].includes('%%%'), 'the user percent must not survive as a wildcard');
});

test('a free-text q is escaped the same way', async () => {
  const client = stubClient([]);
  await fetchJobPool(client, { q: 'c_+' });
  const ilike = allCalls(client, 'ilike').find((c) => c[1] === 'title');
  assert.deepEqual(ilike, ['ilike', 'title', '%c\\_+%']);
});

// ------------------------------------------------------------------
// The column list
// ------------------------------------------------------------------
test('fetchJobPool never selects * and never selects description', async () => {
  const client = stubClient([]);
  await fetchJobPool(client, {});

  const select = firstCall(client, 'select');
  assert.ok(select, 'select() was never called');
  const columns = String(select[1]).split(',').map((c) => c.trim());

  assert.ok(!columns.includes('*'), 'select("*") would leak every future column');
  assert.ok(
    !columns.includes('description'),
    'descriptions are for server-side LLM scoring only and must not reach the client'
  );
  assert.ok(columns.includes('title'));
  assert.ok(columns.includes('keyword_terms'));
});

test('JOB_COLUMNS itself contains no description and no wildcard', () => {
  assert.ok(!JOB_COLUMNS.includes('description'));
  assert.ok(!JOB_COLUMNS.includes('*'));
});

test('the query reads job_listings', async () => {
  const client = stubClient([]);
  await fetchJobPool(client, {});
  assert.deepEqual(firstCall(client, 'from'), ['from', 'job_listings']);
});

// ------------------------------------------------------------------
// Filters
// ------------------------------------------------------------------
test('limit defaults, clamps to MAX_LIMIT, and survives junk', async () => {
  for (const [input, expected] of [
    [undefined, DEFAULT_LIMIT],
    ['not a number', DEFAULT_LIMIT],
    [0, DEFAULT_LIMIT],
    [-5, DEFAULT_LIMIT],
    [10, 10],
    ['25', 25],
    [99999, MAX_LIMIT],
  ]) {
    const client = stubClient([]);
    await fetchJobPool(client, { limit: input });
    assert.deepEqual(firstCall(client, 'limit'), ['limit', expected], `limit=${String(input)}`);
  }
});

test('remote is tri-state: true, false, or no filter at all', async () => {
  const yes = stubClient([]);
  await fetchJobPool(yes, { remote: 'true' });
  assert.ok(allCalls(yes, 'eq').some((c) => c[1] === 'remote' && c[2] === true));

  const no = stubClient([]);
  await fetchJobPool(no, { remote: false });
  assert.ok(allCalls(no, 'eq').some((c) => c[1] === 'remote' && c[2] === false));

  for (const value of ['any', '', undefined, 'banana']) {
    const client = stubClient([]);
    await fetchJobPool(client, { remote: value });
    assert.ok(
      !allCalls(client, 'eq').some((c) => c[1] === 'remote'),
      `remote=${String(value)} must not filter`
    );
  }
});

test('a single source uses eq, several use in, unknown ones are dropped', async () => {
  const one = stubClient([]);
  await fetchJobPool(one, { source: 'adzuna' });
  assert.ok(allCalls(one, 'eq').some((c) => c[1] === 'source' && c[2] === 'adzuna'));

  const many = stubClient([]);
  await fetchJobPool(many, { source: 'adzuna, remotive' });
  assert.deepEqual(firstCall(many, 'in'), ['in', 'source', ['adzuna', 'remotive']]);

  const junk = stubClient([]);
  await fetchJobPool(junk, { source: 'myspace,geocities' });
  assert.ok(!allCalls(junk, 'eq').some((c) => c[1] === 'source'));
  assert.ok(!firstCall(junk, 'in'));
});

test('every registered adapter id survives the source filter', async () => {
  // The drift this catches is invisible in production. A source missing from
  // KNOWN_SOURCES is not rejected — normalizeSources drops it, no filter is
  // applied, and the caller gets the whole pool back looking like a filter
  // that matched everything. 'ats' shipped that way: the adapter ingested,
  // the CHECK constraint allowed it, the UI offered the chip, and checking it
  // silently widened the search instead of narrowing it.
  //
  // Asserted through fetchJobPool rather than by exporting KNOWN_SOURCES,
  // because what matters is that a filter is APPLIED, not that a set contains
  // a string.
  const { ADAPTERS } = await import('../../server/jobs/adapters/index.js');

  for (const adapter of ADAPTERS) {
    const client = stubClient([]);
    await fetchJobPool(client, { source: adapter.id });
    assert.ok(
      allCalls(client, 'eq').some((c) => c[1] === 'source' && c[2] === adapter.id),
      `source=${adapter.id} is a registered adapter but built no filter — ` +
        'add it to KNOWN_SOURCES in server/jobs/query.js'
    );
  }
});

test('since defaults to a 30-day floor and accepts an explicit date', async () => {
  const now = Date.now();
  const client = stubClient([]);
  await fetchJobPool(client, {});
  const gte = firstCall(client, 'gte');
  assert.equal(gte[1], 'posted_at');
  const floor = new Date(gte[2]).getTime();
  const days = (now - floor) / (24 * 60 * 60 * 1000);
  assert.ok(days > 29.9 && days < 30.1, `expected ~30 days, got ${days}`);

  const explicit = stubClient([]);
  await fetchJobPool(explicit, { since: '2024-01-01T00:00:00.000Z' });
  assert.equal(firstCall(explicit, 'gte')[2], '2024-01-01T00:00:00.000Z');
});

test('an unparseable since falls back to the default window instead of an invalid literal', async () => {
  const client = stubClient([]);
  await fetchJobPool(client, { since: 'last tuesday-ish' });
  const value = firstCall(client, 'gte')[2];
  assert.ok(!Number.isNaN(new Date(value).getTime()));
});

test('a junk filter object produces a valid query and never throws', async () => {
  for (const filters of [
    null,
    undefined,
    'a string',
    { limit: {}, remote: [], location: {}, q: [], source: 7, since: {}, cursor: 12 },
  ]) {
    const client = stubClient([]);
    const result = await fetchJobPool(client, filters);
    assert.deepEqual(result.jobs, []);
    assert.ok(firstCall(client, 'select'), 'a query was still built');
  }
});

// ------------------------------------------------------------------
// Keyset paging
// ------------------------------------------------------------------
test('a cursor round-trips and drives the keyset predicate', async () => {
  const cursor = encodeCursor({ postedAt: '2024-05-01T00:00:00.000Z', id: 'abc' });
  assert.deepEqual(decodeCursor(cursor), { postedAt: '2024-05-01T00:00:00.000Z', id: 'abc' });

  const client = stubClient([]);
  await fetchJobPool(client, { cursor });
  const or = firstCall(client, 'or');
  assert.ok(or, 'a cursor must produce the keyset OR');
  assert.ok(or[1].includes('posted_at.lt.2024-05-01T00:00:00.000Z'));
  assert.ok(or[1].includes('and(posted_at.eq.2024-05-01T00:00:00.000Z,id.lt.abc)'));
});

test('a junk cursor is ignored rather than throwing', async () => {
  for (const junk of ['', 'not-base64!!', Buffer.from('{}').toString('base64url'), 42, null]) {
    assert.equal(decodeCursor(junk), null, `decodeCursor(${String(junk)})`);
    const client = stubClient([]);
    await fetchJobPool(client, { cursor: junk });
    assert.ok(!firstCall(client, 'or'));
  }
});

test('nextCursor is returned only on a full page', async () => {
  const row = (id) => ({ id, posted_at: '2024-05-01T00:00:00.000Z', title: 't', job_id: `x:${id}` });

  const full = stubClient([row('a'), row('b')]);
  const fullResult = await fetchJobPool(full, { limit: 2 });
  assert.ok(fullResult.nextCursor, 'a full page may have more after it');
  assert.deepEqual(decodeCursor(fullResult.nextCursor), {
    postedAt: '2024-05-01T00:00:00.000Z',
    id: 'b',
  });

  const short = stubClient([row('a')]);
  const shortResult = await fetchJobPool(short, { limit: 2 });
  assert.equal(shortResult.nextCursor, null, 'a short page is the end');
});

test('ordering is posted_at desc then id desc, so the keyset boundary is total', async () => {
  const client = stubClient([]);
  await fetchJobPool(client, {});
  const orders = allCalls(client, 'order');
  assert.deepEqual(orders[0], ['order', 'posted_at', { ascending: false }]);
  assert.deepEqual(orders[1], ['order', 'id', { ascending: false }]);
});

// ------------------------------------------------------------------
// Shape
// ------------------------------------------------------------------
test('rows come back camelCased with no description key', () => {
  const job = toClientJob({
    id: 'u1',
    job_id: 'adzuna:1',
    source: 'adzuna',
    source_id: '1',
    title: 'Backend Engineer',
    remote: true,
    salary_min: 100,
    keyword_terms: ['node'],
    description_quality: 'snippet',
    posted_at: '2024-05-01T00:00:00.000Z',
    description: 'should never be here',
  });

  assert.equal(job.jobId, 'adzuna:1');
  assert.equal(job.isRemote, true);
  assert.equal(job.salaryMin, 100);
  assert.deepEqual(job.keywordTerms, ['node']);
  assert.equal(job.descriptionQuality, 'snippet');
  assert.equal(job.postedAt, '2024-05-01T00:00:00.000Z');
  assert.ok(!('description' in job), 'the mapper must not carry a description through');
  assert.ok(!('remote' in job));
});

test('toMatcherJob restores the snake_case keys src/matching reads', () => {
  // Without this adapter, description_quality reads as undefined inside the
  // scorer and every snippet job silently scores as if it had a full posting.
  const view = toMatcherJob({
    title: 'Backend Engineer',
    keywords: [{ t: 'node' }],
    keywordTerms: ['node'],
    descriptionQuality: 'snippet',
  });
  assert.equal(view.description_quality, 'snippet');
  assert.deepEqual(view.keyword_terms, ['node']);
});

test('toMatcherJob carries the two fields prefilterJobs SORTS by', () => {
  // prefilterJobs ties break on "score, then newest, then id". Both of those
  // keys are snake_case on the row and camelCase on the client job, so without
  // them here every comparison after the score collapsed to '' vs '' and the
  // surviving order was ascending UUID — arbitrary, and stable enough to look
  // deliberate.
  const view = toMatcherJob({
    id: 'job-1',
    title: 'Backend Engineer',
    postedAt: '2026-09-18T04:06:22+00:00',
  });
  assert.equal(view.id, 'job-1');
  assert.equal(view.posted_at, '2026-09-18T04:06:22+00:00');
});

test('a database error becomes a thrown Error, not a silent empty list', async () => {
  const client = stubClient(null, { message: 'connection refused' });
  await assert.rejects(() => fetchJobPool(client, {}), /connection refused/);
});

// ------------------------------------------------------------------
// Structured location (migration 004)
// ------------------------------------------------------------------

test('a picked location filters the structured columns exactly, not the display string', async () => {
  // The whole point of migration 004: "Florida" cannot be found in
  // "Tampa Palms, Hillsborough County", because Adzuna's display string names
  // a county and never a state.
  const client = stubClient([]);
  await fetchJobPool(client, { locationRegion: 'Florida' });
  const ilikes = allCalls(client, 'ilike');
  const region = ilikes.find((c) => c[1] === 'location_region');
  assert.ok(region, `no location_region filter in ${JSON.stringify(ilikes)}`);
  // No wildcards: the user picked a value the API offered, so this is an
  // exact, case-insensitive match that the lower() index can serve.
  assert.equal(region[2], 'Florida');
  assert.ok(!ilikes.some((c) => c[1] === 'location'), 'free-text filter must not also apply');
});

test('free text still falls back to the display column', async () => {
  // Rows ingested before 004 have null parts, and a hand-typed value may not
  // be anything we hold. Substring on `location` is all that can honestly be
  // done for either.
  const client = stubClient([]);
  await fetchJobPool(client, { location: 'new york' });
  const free = allCalls(client, 'ilike').find((c) => c[1] === 'location');
  assert.ok(free);
  assert.equal(free[2], '%new york%');
});

test('a structured location wins over free text when both arrive', async () => {
  const client = stubClient([]);
  await fetchJobPool(client, { location: 'ignored', locationCountry: 'United States' });
  const ilikes = allCalls(client, 'ilike');
  assert.ok(ilikes.some((c) => c[1] === 'location_country' && c[2] === 'United States'));
  assert.ok(!ilikes.some((c) => c[1] === 'location'));
});

test('structured location values are LIKE-escaped like every other free text', () => {
  // They come from a JSON body, not necessarily from our own suggestions.
  assert.equal(escapeLike('100%_real'), '100\\%\\_real');
});

test('a pool read survives migration 004 not being applied yet', async () => {
  // Migrations here are pasted by hand into the SQL editor, so the code is
  // always deployed before the SQL on at least one occasion. Selecting a
  // column that does not exist is not a degraded read — it is a hard error on
  // EVERY pool query, i.e. ranking down for everyone. This repo has already
  // taken that outage once, from a missing table.
  resetLocationPartsCache();
  let attempt = 0;
  const client = {
    calls: [],
    from() {
      const builder = {
        select(cols) { client.calls.push(cols); return builder; },
        eq() { return builder; }, in() { return builder; }, gte() { return builder; },
        lt() { return builder; }, or() { return builder; }, ilike() { return builder; },
        order() { return builder; }, limit() { return builder; },
        then(resolve, reject) {
          attempt += 1;
          // First attempt fails the way Postgres reports an unknown column.
          const result = attempt === 1
            ? { data: null, error: { code: '42703', message: 'column job_listings.location_city does not exist' } }
            : { data: [], error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };

  const page = await fetchJobPool(client, {});
  assert.deepEqual(page.jobs, [], 'the retry should succeed, not throw');
  assert.equal(attempt, 2, 'exactly one retry');
  assert.ok(client.calls[0].includes('location_city'), 'first try asks for the new columns');
  assert.ok(!client.calls[1].includes('location_city'), 'the retry drops them');

  // And it is learned, not re-probed: a later read asks for the base set only.
  await fetchJobPool(client, {});
  assert.ok(!client.calls[2].includes('location_city'), 'absence must be remembered');
  resetLocationPartsCache();
});
