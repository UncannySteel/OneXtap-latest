/**
 * Adapter contract tests.
 *
 * THE CONTRACT'S WHOLE POINT is that fetch() never throws — the orchestrator
 * runs the sources in order, and a throw from source #1 means sources #2-#4
 * are never tried. But an empty result and a dead API key must not look the
 * same, so every failure has to come back with a specific `error` reason.
 *
 * These tests drive every failure mode through both network adapters by
 * stubbing globalThis.fetch, and assert the reason string each one produces.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Set before the dynamic imports below: logger.js reads LOG_LEVEL at module
// load, and these tests deliberately trigger a dozen warn-level lines.
process.env.LOG_LEVEL = 'error';

const { adzunaAdapter, configuredCountries, cursorToTarget } = await import('../../server/jobs/adapters/adzuna.js');
const { remotiveAdapter } = await import('../../server/jobs/adapters/remotive.js');
const { atsAdapter, configuredBoards, cursorToBoard } = await import('../../server/jobs/adapters/ats.js');
const { cacheAdapter } = await import('../../server/jobs/adapters/cache.js');
const { ADAPTERS, getAdapter, ERROR_REASONS } = await import('../../server/jobs/adapters/index.js');

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Replaces globalThis.fetch and returns the restore function. */
function stubFetch(impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => { globalThis.fetch = original; };
}

/** A minimal Response-alike: fetchJson only reads ok, status and text(). */
function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function abortError() {
  const err = new Error('This operation was aborted');
  err.name = 'AbortError';
  return err;
}

const ENV_KEYS = [
  'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'ADZUNA_COUNTRIES',
  'ATS_BOARDS',
  'NODE_ENV', 'ALLOW_CACHE_SOURCE',
];

function snapshotEnv() {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  return () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
}

/** Adzuna refuses to run without both keys, so the failure tests need them set. */
function withAdzunaKeys() {
  const restore = snapshotEnv();
  process.env.ADZUNA_APP_ID = 'test-app-id';
  process.env.ADZUNA_APP_KEY = 'test-app-key';
  return restore;
}

/** ATS reports itself disabled with no boards configured, same idea. */
function withAtsBoards(value = 'greenhouse:figma') {
  const restore = snapshotEnv();
  process.env.ATS_BOARDS = value;
  return restore;
}

// ------------------------------------------------------------------
// The failure matrix — every mode, every network adapter
// ------------------------------------------------------------------

const FAILURE_MODES = [
  { name: '401 unauthorized', reason: 'bad_key', impl: async () => response(401, { error: 'bad credentials' }) },
  { name: '403 forbidden', reason: 'bad_key', impl: async () => response(403, 'Forbidden') },
  // 404 is the ATS case specifically: boards get renamed or taken private
  // (lever/plaid and lever/anthropic both answer 404 today). It must be a named
  // reason, not a crash, and 'network' is what the contract's closed enum has
  // for "their end rejected us".
  { name: '404 not found', reason: 'network', impl: async () => response(404, 'Not Found') },
  { name: '429 rate limited', reason: 'quota', impl: async () => response(429, 'Too Many Requests') },
  { name: '500 server error', reason: 'network', impl: async () => response(500, 'Internal Server Error') },
  { name: '503 unavailable', reason: 'network', impl: async () => response(503, 'Service Unavailable') },
  { name: '200 with invalid JSON', reason: 'parse', impl: async () => response(200, '<html>not json</html>') },
  { name: 'AbortError (timeout)', reason: 'timeout', impl: async () => { throw abortError(); } },
  { name: 'connection refused', reason: 'network', impl: async () => { throw new TypeError('fetch failed'); } },
];

const NETWORK_ADAPTERS = [
  { adapter: adzunaAdapter, setup: withAdzunaKeys },
  { adapter: remotiveAdapter, setup: () => () => {} },
  { adapter: atsAdapter, setup: () => withAtsBoards() },
];

for (const { adapter, setup } of NETWORK_ADAPTERS) {
  for (const mode of FAILURE_MODES) {
    test(`${adapter.id}: ${mode.name} -> error '${mode.reason}', no throw`, async () => {
      const restoreEnv = setup();
      const restoreFetch = stubFetch(mode.impl);
      try {
        const result = await adapter.fetch({ page: 1 });
        assert.deepEqual(result.items, [], 'a failed fetch must yield no items');
        assert.equal(result.hasMore, false);
        assert.equal(result.error, mode.reason);
        assert.ok(ERROR_REASONS.includes(result.error), `'${result.error}' is outside the contract enum`);
      } finally {
        restoreFetch();
        restoreEnv();
      }
    });
  }

  test(`${adapter.id}: a 200 with the wrong payload shape -> 'parse'`, async () => {
    const restoreEnv = setup();
    const restoreFetch = stubFetch(async () => response(200, { unexpected: true }));
    try {
      const result = await adapter.fetch({ page: 1 });
      assert.deepEqual(result.items, []);
      assert.equal(result.error, 'parse');
    } finally {
      restoreFetch();
      restoreEnv();
    }
  });
}

// ------------------------------------------------------------------
// Adzuna
// ------------------------------------------------------------------

test('adzuna.enabled() is false without the env vars and true with both', () => {
  const restore = snapshotEnv();
  try {
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;
    assert.equal(adzunaAdapter.enabled(), false, 'neither key set');

    process.env.ADZUNA_APP_ID = 'id-only';
    assert.equal(adzunaAdapter.enabled(), false, 'app_id alone is not enough');

    delete process.env.ADZUNA_APP_ID;
    process.env.ADZUNA_APP_KEY = 'key-only';
    assert.equal(adzunaAdapter.enabled(), false, 'app_key alone is not enough');

    process.env.ADZUNA_APP_ID = 'id';
    assert.equal(adzunaAdapter.enabled(), true, 'both set');
  } finally {
    restore();
  }
});

test('adzuna.fetch() short-circuits to disabled when keys are absent', async () => {
  const restore = snapshotEnv();
  const restoreFetch = stubFetch(async () => {
    throw new Error('fetch must not be called when the adapter is disabled');
  });
  try {
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;
    const result = await adzunaAdapter.fetch({ page: 1 });
    assert.deepEqual(result, { items: [], hasMore: false, error: 'disabled' });
  } finally {
    restoreFetch();
    restore();
  }
});

test('adzuna: a full page reports hasMore, a short page does not', async () => {
  const restore = withAdzunaKeys();
  const makeResults = (n) => Array.from({ length: n }, (_, i) => ({ id: i, title: `Job ${i}` }));

  let restoreFetch = stubFetch(async () => response(200, { count: 500, results: makeResults(50) }));
  try {
    const full = await adzunaAdapter.fetch({ page: 1 });
    assert.equal(full.items.length, 50);
    assert.equal(full.hasMore, true);
    assert.equal(full.error, null);
  } finally {
    restoreFetch();
  }

  restoreFetch = stubFetch(async () => response(200, { count: 12, results: makeResults(12) }));
  try {
    const short = await adzunaAdapter.fetch({ page: 1 });
    assert.equal(short.hasMore, false, 'a partial page is the last page');
  } finally {
    restoreFetch();
    restore();
  }
});

test('adzuna.toListing maps the provider shape and stamps snippet quality', () => {
  const listing = adzunaAdapter.toListing({
    id: 998877,
    title: 'Senior Backend Engineer',
    company: { display_name: 'Vantablue Systems' },
    location: { display_name: 'Austin, TX, US' },
    description: 'Short truncated blurb…',
    redirect_url: 'https://example.com/jobs/998877',
    created: '2026-09-01T09:00:00Z',
    salary_min: 130000,
    salary_max: 175000,
    contract_type: 'permanent',
    category: { label: 'IT Jobs' },
    _country: 'us',
  });

  assert.equal(listing.source, 'adzuna');
  assert.equal(listing.source_id, 998877);
  assert.equal(listing.company, 'Vantablue Systems');
  assert.equal(listing.location, 'Austin, TX, US');
  assert.equal(listing.url, 'https://example.com/jobs/998877');
  assert.equal(listing.category, 'IT Jobs');
  assert.equal(listing.job_type, 'permanent');
  assert.equal(listing.salary_currency, 'USD');
  // Adzuna's search endpoint always truncates; the matcher needs to know.
  assert.equal(listing.description_quality, 'snippet');
  assert.equal(listing.remote, false);
});

test('adzuna.toListing detects remote from the title or location', () => {
  const fromTitle = adzunaAdapter.toListing({
    id: 1, title: 'Remote Data Engineer', redirect_url: 'https://example.com/jobs/1',
    location: { display_name: 'Anywhere' },
  });
  assert.equal(fromTitle.remote, true);

  const fromLocation = adzunaAdapter.toListing({
    id: 2, title: 'Data Engineer', redirect_url: 'https://example.com/jobs/2',
    location: { display_name: 'Work From Home' },
  });
  assert.equal(fromLocation.remote, true);
});

test('adzuna.toListing returns null for an item with no title or url', () => {
  assert.equal(adzunaAdapter.toListing({ id: 1, redirect_url: 'https://example.com/jobs/1' }), null);
  assert.equal(adzunaAdapter.toListing({ id: 1, title: 'Engineer' }), null);
  assert.equal(adzunaAdapter.toListing(null), null);
});

// ------------------------------------------------------------------
// Remotive
// ------------------------------------------------------------------

test('remotive is keyless and never pages', () => {
  assert.equal(remotiveAdapter.enabled(), true);
  assert.equal(remotiveAdapter.supportsPaging, false);
});

test('remotive.fetch always reports hasMore false', async () => {
  const restoreFetch = stubFetch(async () => response(200, {
    jobs: Array.from({ length: 100 }, (_, i) => ({ id: i, title: `Job ${i}`, url: `https://example.com/jobs/${i}` })),
  }));
  try {
    const result = await remotiveAdapter.fetch({});
    assert.equal(result.items.length, 100);
    // A full page would look like "more to come" on any other source. There is
    // no paging parameter to ask with, so it must say false.
    assert.equal(result.hasMore, false);
    assert.equal(result.error, null);
  } finally {
    restoreFetch();
  }
});

test('remotive.toListing carries tags through and sets full quality', () => {
  const listing = remotiveAdapter.toListing({
    id: 4242,
    title: 'Senior React Engineer',
    company_name: 'Quillstone Digital',
    candidate_required_location: 'Europe',
    description: '<p>Build things with <b>React</b></p>',
    url: 'https://example.com/jobs/4242',
    publication_date: '2026-09-02T12:00:00',
    job_type: 'full_time',
    category: 'Software Development',
    tags: ['react', 'typescript', 'graphql'],
  });

  assert.deepEqual(listing.tags, ['react', 'typescript', 'graphql']);
  assert.equal(listing.description_quality, 'full');
  assert.equal(listing.remote, true, 'every Remotive listing is remote');
  assert.equal(listing.company, 'Quillstone Digital');
  assert.equal(listing.location, 'Europe');
  assert.equal(listing.source, 'remotive');
});

test('remotive.toListing tolerates a missing tags array', () => {
  const listing = remotiveAdapter.toListing({
    id: 1, title: 'Engineer', url: 'https://example.com/jobs/1',
  });
  assert.deepEqual(listing.tags, []);
});

// ------------------------------------------------------------------
// ATS boards (Greenhouse / Lever / Ashby)
//
// The fixtures below are copied from the real payload shapes, field for field,
// because every bug this adapter can have is a field-name bug: Lever's title is
// `text`, its `createdAt` is epoch milliseconds, Greenhouse's `location` is an
// object, and Greenhouse's `content` arrives HTML-ESCAPED.
// ------------------------------------------------------------------

const GREENHOUSE_ITEM = {
  id: 5426468004,
  title: 'Product Designer, Design Systems',
  absolute_url: 'https://boards.greenhouse.io/figma/jobs/5426468004',
  location: { name: 'San Francisco, CA • New York, NY • United States' },
  updated_at: '2026-09-01T09:00:00-04:00',
  // Escaped on the wire. This is not a typo in the fixture.
  content: '&lt;p&gt;Build &amp; ship the design system.&lt;/p&gt;',
  company_name: 'Figma',
  departments: [{ id: 11, name: 'Design' }],
  offices: [{ id: 22, name: 'San Francisco' }],
  first_published: '2026-08-20T09:00:00-04:00',
  _provider: 'greenhouse',
  _board: 'figma',
};

const LEVER_CREATED_AT_MS = 1756713600000;

const LEVER_ITEM = {
  id: 'a1b2c3d4-0000-4444-8888-99997777aaaa',
  // The TITLE. Not `title`, which Lever does not send at all.
  text: 'Backend Engineer, Payments',
  categories: {
    commitment: 'Full-time',
    department: 'Engineering',
    location: 'Stockholm, Sweden',
    team: 'Payments',
    allLocations: ['Stockholm, Sweden'],
  },
  hostedUrl: 'https://jobs.lever.co/spotify/a1b2c3d4-0000-4444-8888-99997777aaaa',
  applyUrl: 'https://jobs.lever.co/spotify/a1b2c3d4-0000-4444-8888-99997777aaaa/apply',
  // Epoch MILLISECONDS, not an ISO string.
  createdAt: LEVER_CREATED_AT_MS,
  descriptionPlain: 'We are hiring a backend engineer.\n\nRequirements:\n- 5 years of Go',
  description: '<div>We are hiring a backend engineer.</div>',
  workplaceType: 'onsite',
  country: 'SE',
  _provider: 'lever',
  _board: 'spotify',
};

const ASHBY_ITEM = {
  id: '0f1e2d3c-4b5a-6789-abcd-ef0123456789',
  title: 'Senior Software Engineer, Platform',
  department: 'Engineering',
  team: 'Platform',
  employmentType: 'FullTime',
  // A plain STRING here, unlike Greenhouse.
  location: 'New York, New York, United States',
  secondaryLocations: [],
  publishedAt: '2026-09-02T12:00:00.000Z',
  isListed: true,
  // A real boolean — the only source of the three that states this outright.
  isRemote: true,
  workplaceType: 'Hybrid',
  jobUrl: 'https://jobs.ashbyhq.com/ramp/0f1e2d3c-4b5a-6789-abcd-ef0123456789',
  applyUrl: 'https://jobs.ashbyhq.com/ramp/0f1e2d3c-4b5a-6789-abcd-ef0123456789/application',
  descriptionHtml: '<p>Ramp is building the finance automation platform.</p>',
  descriptionPlain: 'Ramp is building the finance automation platform.',
  _provider: 'ashby',
  _board: 'ramp',
};

test('configuredBoards parses provider:board pairs and drops everything else', () => {
  const restore = snapshotEnv();
  try {
    process.env.ATS_BOARDS = 'greenhouse:figma,lever:spotify,ashby:ramp';
    assert.deepEqual(configuredBoards(), [
      { provider: 'greenhouse', board: 'figma' },
      { provider: 'lever', board: 'spotify' },
      { provider: 'ashby', board: 'ramp' },
    ]);

    process.env.ATS_BOARDS = '  GreenHouse : figma ,  LEVER:spotify ';
    assert.deepEqual(
      configuredBoards(),
      [{ provider: 'greenhouse', board: 'figma' }, { provider: 'lever', board: 'spotify' }],
      'trimmed, and the provider lowercased',
    );

    process.env.ATS_BOARDS = 'greenhouse:figma,greenhouse:figma,lever:spotify';
    assert.deepEqual(
      configuredBoards(),
      [{ provider: 'greenhouse', board: 'figma' }, { provider: 'lever', board: 'spotify' }],
      'duplicates collapse',
    );

    // Dropped, never coerced: an unknown provider, a missing half, a board slug
    // with a path separator or a space in it (it goes into a URL PATH), and a
    // stray third segment.
    process.env.ATS_BOARDS = 'workday:acme,greenhouse,:figma,lever:,greenhouse:../../etc,ashby:two words,greenhouse:figma:oops,greenhouse:figma';
    assert.deepEqual(
      configuredBoards(),
      [{ provider: 'greenhouse', board: 'figma' }],
      'only the one valid pair survives',
    );

    process.env.ATS_BOARDS = '!!,??,,';
    assert.deepEqual(configuredBoards(), [], 'nothing valid means nothing — there is no default board');

    process.env.ATS_BOARDS = '';
    assert.deepEqual(configuredBoards(), []);

    delete process.env.ATS_BOARDS;
    assert.deepEqual(configuredBoards(), [], 'unset means off');
  } finally {
    restore();
  }
});

test('ats.enabled() is false without ATS_BOARDS and true with one valid pair', () => {
  const restore = snapshotEnv();
  try {
    delete process.env.ATS_BOARDS;
    assert.equal(atsAdapter.enabled(), false, 'unset');

    process.env.ATS_BOARDS = 'workday:acme';
    assert.equal(atsAdapter.enabled(), false, 'an unsupported provider is not configuration');

    process.env.ATS_BOARDS = 'lever:spotify';
    assert.equal(atsAdapter.enabled(), true, 'one valid pair is enough');
  } finally {
    restore();
  }
});

test('the cursor round-robins ATS boards instead of re-reading one', () => {
  const boards = [
    { provider: 'greenhouse', board: 'figma' },
    { provider: 'lever', board: 'spotify' },
    { provider: 'ashby', board: 'ramp' },
  ];
  const visited = [1, 2, 3, 4, 5, 6].map((cursor) => cursorToBoard(cursor, boards));

  assert.deepEqual(
    visited.map((v) => `${v.provider}:${v.board}`),
    [
      'greenhouse:figma', 'lever:spotify', 'ashby:ramp',
      'greenhouse:figma', 'lever:spotify', 'ashby:ramp',
    ],
  );

  // The property that matters, same as adzuna's countries: a run cut short
  // after three requests has covered three boards, not one board three times.
  assert.equal(new Set(visited.slice(0, 3).map((v) => v.board)).size, 3);
});

test('cursorToBoard is total', () => {
  const boards = [{ provider: 'lever', board: 'spotify' }];
  for (const cursor of [null, -5, 0, 'x', [], undefined, NaN, 1.7]) {
    const target = cursorToBoard(cursor, boards);
    assert.deepEqual(target, { provider: 'lever', board: 'spotify' }, `cursor: ${String(cursor)}`);
  }

  // No boards, or junk where boards should be, is null rather than a throw.
  // 'constructor' is in there on purpose: it resolves on Object.prototype, so a
  // truthiness check on PROVIDERS[provider] would let it through and fetch()
  // would then throw on a url() that does not exist.
  for (const list of [
    null, undefined, [], 42, 'nope', [{}], [null],
    [{ provider: 'workday', board: 'acme' }],
    [{ provider: 'constructor', board: 'acme' }],
    [{ provider: 'lever', board: '../../etc/passwd' }],
  ]) {
    assert.equal(cursorToBoard(1, list), null, `boards: ${JSON.stringify(list) ?? String(list)}`);
  }
});

test('ats.toListing maps a Greenhouse item', () => {
  const listing = atsAdapter.toListing(GREENHOUSE_ITEM);

  assert.equal(listing.source, 'ats', 'one source for all three providers');
  assert.equal(listing.source_id, 'greenhouse:figma:5426468004',
    'provider and board in the id, so two boards cannot collide on a bare number');
  assert.equal(listing.title, 'Product Designer, Design Systems');
  assert.equal(listing.url, 'https://boards.greenhouse.io/figma/jobs/5426468004');
  assert.equal(listing.company, 'Figma', 'company_name wins over the board slug');
  assert.equal(listing.location, 'San Francisco, CA • New York, NY • United States',
    'the location OBJECT becomes a string');
  assert.equal(listing.category, 'Design');
  assert.equal(listing.remote, false);
  assert.equal(listing.posted_at, new Date('2026-09-01T09:00:00-04:00').toISOString());
  assert.deepEqual(listing.tags, []);
  assert.equal(listing.salary_min, null);
  assert.equal(listing.salary_max, null);
  assert.equal(listing.salary_currency, null);
});

/**
 * The single easiest thing to get wrong in this adapter.
 *
 * Greenhouse returns `content` HTML-escaped, so the entities have to be decoded
 * BEFORE tags are stripped. Do it the other way round — which is the order
 * normalizeListing's stripHtml() uses — and the strip pass finds no tags at
 * all, the decode then produces them, and every description reaches the matcher
 * full of visible markup.
 */
test('Greenhouse escaped HTML is decoded before tags are stripped', () => {
  const listing = atsAdapter.toListing({
    ...GREENHOUSE_ITEM,
    content: '&lt;p&gt;Build &amp; ship&lt;/p&gt;',
  });

  assert.match(listing.description, /Build & ship/, 'the entity decoded');
  assert.doesNotMatch(listing.description, /<p>/, 'tags were stripped, not left as markup');
  assert.doesNotMatch(listing.description, /&lt;/, 'no entity survived undecoded');
  assert.doesNotMatch(listing.description, /&amp;/);
});

test('Greenhouse descriptions keep their line structure for the extractor', () => {
  const listing = atsAdapter.toListing({
    ...GREENHOUSE_ITEM,
    content: '&lt;h2&gt;Requirements:&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;5 years of Go&lt;/li&gt;&lt;/ul&gt;',
  });

  // extractKeywords() runs a heading state machine over line structure, so a
  // posting flattened onto one line loses the "Requirements:" detection that
  // full descriptions are being fetched for.
  assert.match(listing.description, /Requirements:\n/);
  assert.match(listing.description, /5 years of Go/);
});

test('ats.toListing maps a Lever item — title from `text`, createdAt from epoch ms', () => {
  const listing = atsAdapter.toListing(LEVER_ITEM);

  assert.equal(listing.title, 'Backend Engineer, Payments', 'Lever calls the title `text`');
  assert.equal(listing.url, 'https://jobs.lever.co/spotify/a1b2c3d4-0000-4444-8888-99997777aaaa');
  assert.equal(listing.source_id, 'lever:spotify:a1b2c3d4-0000-4444-8888-99997777aaaa');
  assert.equal(listing.company, 'spotify', 'Lever names no company, so the board slug is it');
  assert.equal(listing.location, 'Stockholm, Sweden');
  assert.equal(listing.category, 'Engineering');
  assert.equal(listing.job_type, 'Full-time');
  assert.equal(listing.remote, false);
  assert.match(listing.description, /Requirements:/, 'descriptionPlain needs no stripping');

  assert.equal(listing.posted_at, new Date(LEVER_CREATED_AT_MS).toISOString());
  assert.ok(Number.isFinite(new Date(listing.posted_at).getTime()), 'never an Invalid Date');
});

test('a Lever createdAt that is not a number becomes null, not Invalid Date', () => {
  for (const createdAt of [undefined, null, 'yesterday', {}, NaN]) {
    const listing = atsAdapter.toListing({ ...LEVER_ITEM, createdAt });
    assert.equal(listing.posted_at, null, `createdAt: ${String(createdAt)}`);
  }
});

test('ats.toListing maps an Ashby item and honours isRemote directly', () => {
  const listing = atsAdapter.toListing(ASHBY_ITEM);

  assert.equal(listing.title, 'Senior Software Engineer, Platform');
  assert.equal(listing.url, 'https://jobs.ashbyhq.com/ramp/0f1e2d3c-4b5a-6789-abcd-ef0123456789');
  assert.equal(listing.source_id, 'ashby:ramp:0f1e2d3c-4b5a-6789-abcd-ef0123456789');
  assert.equal(listing.company, 'ramp');
  assert.equal(listing.location, 'New York, New York, United States', 'a plain string upstream');
  assert.equal(listing.category, 'Engineering');
  assert.equal(listing.job_type, 'FullTime');
  assert.equal(listing.posted_at, '2026-09-02T12:00:00.000Z');

  // Nothing in the title or the location says "remote". The boolean is the
  // whole point: this is the one source that does not have to be guessed at.
  assert.equal(listing.remote, true);

  const notRemote = atsAdapter.toListing({
    ...ASHBY_ITEM, isRemote: false, title: 'Remote Support Engineer',
  });
  assert.equal(notRemote.remote, false, 'the flag beats the keyword, in both directions');
});

test('remote is inferred from title or location where there is no flag', () => {
  const fromTitle = atsAdapter.toListing({ ...GREENHOUSE_ITEM, title: 'Remote Data Engineer' });
  assert.equal(fromTitle.remote, true);

  const fromLocation = atsAdapter.toListing({
    ...LEVER_ITEM,
    categories: { ...LEVER_ITEM.categories, location: 'Remote - Europe' },
  });
  assert.equal(fromLocation.remote, true);
});

test('every ATS provider is stamped description_quality full', () => {
  // The reason this adapter exists at all: these are complete postings, so the
  // matcher must not down-weight them the way it down-weights Adzuna snippets.
  for (const item of [GREENHOUSE_ITEM, LEVER_ITEM, ASHBY_ITEM]) {
    const listing = atsAdapter.toListing(item);
    assert.equal(listing.description_quality, 'full', `${item._provider} must be full`);
    assert.ok(listing.description.length > 0, `${item._provider} produced an empty description`);
  }
});

test('ats.toListing returns null for an item with no title or no url', () => {
  assert.equal(atsAdapter.toListing({ ...GREENHOUSE_ITEM, title: '' }), null);
  assert.equal(atsAdapter.toListing({ ...GREENHOUSE_ITEM, absolute_url: '' }), null);
  assert.equal(atsAdapter.toListing({ ...LEVER_ITEM, text: undefined }), null, 'Lever: no `text`');
  assert.equal(atsAdapter.toListing({ ...LEVER_ITEM, hostedUrl: '', applyUrl: '' }), null);
  assert.equal(atsAdapter.toListing({ ...ASHBY_ITEM, title: null }), null);
  assert.equal(atsAdapter.toListing({ ...ASHBY_ITEM, jobUrl: '', applyUrl: '' }), null);

  // And for anything that is not a provider item at all.
  for (const junk of [null, undefined, 42, 'nope', [], {}]) {
    assert.equal(atsAdapter.toListing(junk), null, `junk: ${String(junk)}`);
  }
});

test('ats.fetch reads one board per cursor and rotates through the cycle', async () => {
  const restore = withAtsBoards('greenhouse:figma,lever:spotify,ashby:ramp');
  const requested = [];
  const restoreFetch = stubFetch(async (url) => {
    requested.push(String(url));
    // Lever answers with a BARE ARRAY; the other two wrap theirs in { jobs }.
    if (String(url).includes('api.lever.co')) return response(200, [LEVER_ITEM]);
    return response(200, { jobs: [GREENHOUSE_ITEM] });
  });

  try {
    const first = await atsAdapter.fetch({ page: 1 });
    assert.equal(first.error, null);
    assert.equal(first.items.length, 1);
    assert.equal(first.hasMore, true, 'two boards still unvisited in this cycle');

    const second = await atsAdapter.fetch({ page: 2 });
    assert.equal(second.error, null, 'a bare array is a valid Lever payload');
    assert.equal(second.items.length, 1);
    assert.equal(second.hasMore, true);

    const third = await atsAdapter.fetch({ page: 3 });
    assert.equal(third.hasMore, false, 'the last board wraps the cursor back to 1');

    // The fourth request must be the first board again, not a fourth board.
    await atsAdapter.fetch({ page: 4 });

    assert.deepEqual(
      requested.map((u) => u.split('?')[0]),
      [
        'https://boards-api.greenhouse.io/v1/boards/figma/jobs',
        'https://api.lever.co/v0/postings/spotify',
        'https://api.ashbyhq.com/posting-api/job-board/ramp',
        'https://boards-api.greenhouse.io/v1/boards/figma/jobs',
      ],
    );
    assert.match(requested[0], /content=true/, 'without content=true Greenhouse sends no description');
  } finally {
    restoreFetch();
    restore();
  }
});

test('ats.fetch stamps the provider and board onto every item it returns', async () => {
  const restore = withAtsBoards('ashby:ramp');
  // Deliberately un-stamped fixtures: fetch() is what adds _provider/_board,
  // and toListing() needs them to build a collision-proof source_id.
  const { _provider, _board, ...bare } = ASHBY_ITEM;
  const restoreFetch = stubFetch(async () => response(200, { jobs: [bare] }));
  try {
    const result = await atsAdapter.fetch({ page: 1 });
    assert.equal(result.items[0]._provider, 'ashby');
    assert.equal(result.items[0]._board, 'ramp');
    assert.equal(atsAdapter.toListing(result.items[0]).source_id, `ashby:ramp:${ASHBY_ITEM.id}`);
  } finally {
    restoreFetch();
    restore();
  }
});

test('ats.fetch short-circuits to disabled when no board is configured', async () => {
  const restore = snapshotEnv();
  const restoreFetch = stubFetch(async () => {
    throw new Error('fetch must not be called when the adapter is disabled');
  });
  try {
    delete process.env.ATS_BOARDS;
    assert.deepEqual(await atsAdapter.fetch({ page: 1 }), { items: [], hasMore: false, error: 'disabled' });

    process.env.ATS_BOARDS = 'workday:acme';
    assert.deepEqual(await atsAdapter.fetch({ page: 1 }), { items: [], hasMore: false, error: 'disabled' },
      'an unsupported provider is not a reason to make a request');
  } finally {
    restoreFetch();
    restore();
  }
});

test('ats.fetch survives a null or wrong-typed argument', async () => {
  const restore = withAtsBoards();
  const restoreFetch = stubFetch(async () => response(200, { jobs: [] }));
  try {
    for (const argument of [undefined, null, 42, 'nope', [], { page: null }]) {
      const result = await atsAdapter.fetch(argument);
      assert.ok(Array.isArray(result.items), `fetch(${String(argument)}) returned no items array`);
      assert.equal(typeof result.hasMore, 'boolean');
    }
  } finally {
    restoreFetch();
    restore();
  }
});

// ------------------------------------------------------------------
// Wellfound — removed. See the note above ADAPTERS in adapters/index.js for
// why there is no Wellfound source and why a scraper is not the answer.
// ------------------------------------------------------------------

test('wellfound is not a registered source', () => {
  assert.equal(getAdapter('wellfound'), null);
});

// ------------------------------------------------------------------
// Cache (fixtures)
// ------------------------------------------------------------------

test('cache.enabled() is false in production unless explicitly allowed', () => {
  const restore = snapshotEnv();
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_CACHE_SOURCE;
    assert.equal(cacheAdapter.enabled(), false, 'synthetic listings must not reach real users');

    process.env.ALLOW_CACHE_SOURCE = 'true';
    assert.equal(cacheAdapter.enabled(), true, 'the explicit staging override');

    // Only the exact string 'true'. A truthy-looking value is not consent.
    process.env.ALLOW_CACHE_SOURCE = '1';
    assert.equal(cacheAdapter.enabled(), false);

    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_CACHE_SOURCE;
    assert.equal(cacheAdapter.enabled(), true, 'local dev with no API keys');
  } finally {
    restore();
  }
});

// The regression this guards: ALLOW_CACHE_SOURCE=false used to be read only as
// an *enable*, so it was silently ignored and the NODE_ENV fallback returned
// true anyway. A manual ingest from a laptop pointed at the production database
// then wrote 40 synthetic example.com listings into the real pool.
test('cache.enabled() honours an explicit ALLOW_CACHE_SOURCE=false outside production', () => {
  const restore = snapshotEnv();
  try {
    // The exact shape of the incident: not production, flag says no.
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_CACHE_SOURCE = 'false';
    assert.equal(cacheAdapter.enabled(), false, 'an explicit opt-out must win over the dev default');

    delete process.env.NODE_ENV;
    assert.equal(cacheAdapter.enabled(), false, 'unset NODE_ENV is the laptop case, and must not re-enable it');

    process.env.NODE_ENV = 'production';
    assert.equal(cacheAdapter.enabled(), false, 'still off where it was already off');

    // Only the exact string 'false' is an opt-out, mirroring the 'true' rule.
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_CACHE_SOURCE = '0';
    assert.equal(cacheAdapter.enabled(), true, 'a falsy-looking value is not an opt-out');
  } finally {
    restore();
  }
});

test('cache.fetch serves fixtures without touching the network', async () => {
  const restore = snapshotEnv();
  const restoreFetch = stubFetch(async () => {
    throw new Error('the cache adapter must never make a request');
  });
  try {
    process.env.NODE_ENV = 'test';
    const result = await cacheAdapter.fetch({});
    assert.ok(result.items.length >= 40, `expected ~40 fixtures, got ${result.items.length}`);
    assert.equal(result.hasMore, false);
    assert.equal(result.error, null);
  } finally {
    restoreFetch();
    restore();
  }
});

test('cache.fetch returns disabled when it is switched off', async () => {
  const restore = snapshotEnv();
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_CACHE_SOURCE;
    const result = await cacheAdapter.fetch({});
    assert.deepEqual(result, { items: [], hasMore: false, error: 'disabled' });
  } finally {
    restore();
  }
});

// ------------------------------------------------------------------
// The fixture file itself
// ------------------------------------------------------------------

test('cached_jobs.json parses and contains only fake listings', () => {
  const path = fileURLToPath(new URL('../../server/data/cached_jobs.json', import.meta.url));
  const parsed = JSON.parse(readFileSync(path, 'utf8'));

  assert.ok(typeof parsed._comment === 'string' && parsed._comment.length > 0,
    'the fixture must declare itself synthetic in the file');
  assert.ok(Array.isArray(parsed.jobs));
  assert.ok(parsed.jobs.length >= 40, `expected ~40 fixtures, got ${parsed.jobs.length}`);

  for (const job of parsed.jobs) {
    assert.ok(job.title, `missing title: ${JSON.stringify(job.id)}`);
    assert.ok(job.url, `missing url: ${JSON.stringify(job.id)}`);
    // The real assertion: no genuine listing has ever crept in here. A real
    // apply link in a "synthetic" fixture is how fake jobs reach real users.
    assert.match(job.url, /^https:\/\/example\.com\/jobs\//, `non-example.com url: ${job.url}`);
  }

  const ids = parsed.jobs.map((j) => j.id);
  assert.equal(new Set(ids).size, ids.length, 'fixture ids must be unique');

  // Coverage the downstream ranking depends on.
  assert.ok(new Set(parsed.jobs.map((j) => j.category)).size >= 4, 'needs a spread of role families');
  assert.ok(parsed.jobs.some((j) => j.remote), 'needs remote roles');
  assert.ok(parsed.jobs.some((j) => !j.remote), 'needs onsite roles');
  assert.ok(parsed.jobs.some((j) => j.description_quality === 'snippet'), 'needs snippet rows');
  assert.ok(
    parsed.jobs.some((j) => /Requirements:/.test(j.description) && /Nice to have:/.test(j.description)),
    "needs real 'Requirements:' / 'Nice to have:' headers to exercise the extractor",
  );
});

// ------------------------------------------------------------------
// The registry
// ------------------------------------------------------------------

test('ADAPTERS is the cascade, in order, and every entry honours the contract', () => {
  assert.deepEqual(ADAPTERS.map((a) => a.id), ['adzuna', 'remotive', 'ats', 'cache']);

  for (const adapter of ADAPTERS) {
    assert.equal(typeof adapter.id, 'string');
    assert.equal(typeof adapter.enabled, 'function');
    assert.equal(typeof adapter.supportsPaging, 'boolean');
    assert.equal(typeof adapter.fetch, 'function');
    assert.equal(typeof adapter.toListing, 'function');
  }

  assert.equal(getAdapter('remotive'), remotiveAdapter);
  assert.equal(getAdapter('nope'), null);
});

/**
 * The never-throws contract has to hold for malformed ARGUMENTS too, not just
 * malformed responses. A defaulted parameter (`fetch({...} = {})`) only fires
 * on `undefined`, so an explicit `null` sails past it and throws inside the
 * destructure — which would take down the whole cascade, not just one source.
 */
test('every adapter fetch() survives a null or wrong-typed argument', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  };
  try {
    for (const adapter of ADAPTERS) {
      for (const argument of [undefined, null, 42, 'nope', []]) {
        const result = await adapter.fetch(argument);
        assert.ok(
          result && Array.isArray(result.items),
          `${adapter.id}.fetch(${JSON.stringify(argument)}) returned no items array`,
        );
        assert.equal(typeof result.hasMore, 'boolean');
        // cache.js reads a local fixture file and never touches globalThis.fetch,
        // so it legitimately succeeds here with error: null. The contract is the
        // SHAPE — a usable result, never an exception — not that every source fails.
        assert.ok(
          result.error === null || (typeof result.error === 'string' && result.error.length > 0),
          `${adapter.id}.fetch(${JSON.stringify(argument)}) returned a malformed error field`,
        );
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/**
 * ADZUNA_COUNTRIES is plural and must behave that way.
 *
 * It used to be read as `.split(',')[0]`, so `in,us,gb` silently fetched India
 * and nothing else while the currency table stamped INR across the pool. The
 * ingest cursor is a single integer per source, so several countries are
 * round-robined across consecutive cursor values rather than reshaping the
 * cursor for every adapter.
 */
test('configuredCountries parses the whole list, not just the first entry', () => {
  const original = process.env.ADZUNA_COUNTRIES;
  try {
    process.env.ADZUNA_COUNTRIES = 'in,us,gb';
    assert.deepEqual(configuredCountries(), ['in', 'us', 'gb']);

    process.env.ADZUNA_COUNTRIES = ' IN , us ,GB ';
    assert.deepEqual(configuredCountries(), ['in', 'us', 'gb'], 'trimmed and lowercased');

    process.env.ADZUNA_COUNTRIES = 'in,in,us';
    assert.deepEqual(configuredCountries(), ['in', 'us'], 'duplicates collapse');

    process.env.ADZUNA_COUNTRIES = '!!,??';
    assert.deepEqual(configuredCountries(), ['us'], 'nothing valid falls back');

    delete process.env.ADZUNA_COUNTRIES;
    assert.deepEqual(configuredCountries(), ['us'], 'unset falls back');
  } finally {
    if (original === undefined) delete process.env.ADZUNA_COUNTRIES;
    else process.env.ADZUNA_COUNTRIES = original;
  }
});

test('the cursor round-robins countries instead of draining one', () => {
  const countries = ['in', 'us', 'gb'];
  const visited = [1, 2, 3, 4, 5, 6].map((cursor) => cursorToTarget(cursor, countries));

  assert.deepEqual(visited.map((v) => v.country), ['in', 'us', 'gb', 'in', 'us', 'gb']);
  assert.deepEqual(visited.map((v) => v.page), [1, 1, 1, 2, 2, 2]);

  // The property that matters: a run cut short after N pages has covered
  // min(N, countries) countries, not the first N pages of one country.
  const firstThree = new Set(visited.slice(0, 3).map((v) => v.country));
  assert.equal(firstThree.size, 3, 'three pages must reach all three countries');
});

test('cursorToTarget is total', () => {
  for (const [cursor, list] of [[null, null], [-5, []], ['x', ['in']], [undefined, undefined]]) {
    const t = cursorToTarget(cursor, list);
    assert.ok(/^[a-z]{2}$/.test(t.country), 'always a usable country code');
    assert.ok(Number.isInteger(t.page) && t.page >= 1, 'always a 1-based page');
  }
});
