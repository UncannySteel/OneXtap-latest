/**
 * normalizeListing — adapter output to a job_listings row.
 *
 * The rules under test are the ones that are invisible when they break: an
 * un-prefixed job_id collides silently across sources, an un-coerced numeric
 * source_id fails at query time rather than write time, and an uncapped
 * keywords array bloats every read for months before anyone notices.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeListing, dedupeHash, splitLocation, canonicalRegion,
} from '../../server/jobs/normalizeListing.js';

const base = {
  source_id: 'abc',
  title: 'Backend Engineer',
  url: 'https://example.com/jobs/abc',
  company: 'Lumenrift Labs',
  location: 'Austin, TX, US',
  description: 'We need a backend engineer with Node.js and PostgreSQL.',
};

test('job_id is source-prefixed', () => {
  const row = normalizeListing({ ...base }, 'adzuna');
  assert.equal(row.job_id, 'adzuna:abc');
  assert.equal(row.source, 'adzuna');

  // The whole reason for the prefix: two sources hand out the same bare id.
  const a = normalizeListing({ ...base, source_id: 12345 }, 'adzuna');
  const b = normalizeListing({ ...base, source_id: 12345 }, 'remotive');
  assert.notEqual(a.job_id, b.job_id);
});

test('numeric source_id is coerced to a string', () => {
  const row = normalizeListing({ ...base, source_id: 12345 }, 'adzuna');
  assert.equal(typeof row.source_id, 'string');
  assert.equal(row.source_id, '12345');
  assert.equal(row.job_id, 'adzuna:12345');
});

test('a 5000-char description is truncated to exactly 4000', () => {
  const row = normalizeListing({ ...base, description: 'a'.repeat(5000) }, 'cache');
  assert.equal(row.description.length, 4000);
});

test('a short description is left alone', () => {
  const row = normalizeListing({ ...base }, 'cache');
  assert.equal(row.description, base.description);
});

test('keywords cap at 25 and keyword_terms mirrors them', () => {
  const skills = [
    'React', 'TypeScript', 'JavaScript', 'Python', 'Java', 'Go', 'Rust',
    'Kubernetes', 'Docker', 'AWS', 'GCP', 'Azure', 'Terraform', 'Ansible',
    'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Kafka', 'GraphQL', 'Node.js',
    'Django', 'Flask', 'Spring', 'TensorFlow', 'PyTorch', 'pandas', 'numpy',
    'SQL', 'Jenkins', 'Git', 'Linux', 'Kotlin', 'Swift', 'Ruby', 'PHP',
  ];
  const description = `We need an engineer.\n\nRequirements:\n${
    skills.map((s) => `- Strong hands-on experience with ${s} in production`).join('\n')
  }\n`;

  const row = normalizeListing({ ...base, description }, 'cache');

  assert.equal(row.keywords.length, 25, 'far more than 25 candidates went in');
  // Compact storage shape.
  for (const kw of row.keywords) {
    assert.deepEqual(Object.keys(kw).sort(), ['r', 't', 'w']);
    assert.equal(typeof kw.t, 'string');
    assert.ok(kw.t.length > 0);
    assert.equal(typeof kw.w, 'number');
    assert.equal(typeof kw.r, 'boolean');
  }
  // keyword_terms exists only to back the GIN index. If it ever disagrees with
  // keywords[].t, index hits and rendered chips describe different listings.
  assert.deepEqual(row.keyword_terms, row.keywords.map((k) => k.t));
});

test('requirements cap at 8 and each at 160 chars', () => {
  const bullets = [
    `- ${'An extremely long requirement line that keeps going '.repeat(12)}`,
    ...Array.from({ length: 14 }, (_, i) => `- Requirement number ${i + 2} about Python and SQL`),
  ];
  const description = `Role summary.\n\nRequirements:\n${bullets.join('\n')}\n`;

  const row = normalizeListing({ ...base, description }, 'cache');

  assert.equal(row.requirements.length, 8);
  for (const req of row.requirements) {
    assert.ok(req.length <= 160, `requirement too long: ${req.length}`);
  }
});

test('dedupe_hash is stable for the same company/title/city', () => {
  const one = normalizeListing({ ...base }, 'adzuna');
  const two = normalizeListing({ ...base, source_id: 'different', description: 'Totally different text' }, 'remotive');
  assert.equal(one.dedupe_hash, two.dedupe_hash, 'same opening on two boards must hash alike');

  // The city is the stable part of a location string; the rest is noise.
  const sameCity = normalizeListing({ ...base, location: 'Austin, Texas, United States' }, 'adzuna');
  assert.equal(one.dedupe_hash, sameCity.dedupe_hash);

  // Punctuation and case must not split the hash.
  assert.equal(
    dedupeHash('Acme, Inc.', 'Backend Engineer', 'Austin, TX'),
    dedupeHash('acme inc', 'backend engineer', 'austin, texas'),
  );
});

test('dedupe_hash differs when company, title or city differs', () => {
  const one = normalizeListing({ ...base }, 'adzuna');
  const otherCompany = normalizeListing({ ...base, company: 'Vantablue Systems' }, 'adzuna');
  const otherTitle = normalizeListing({ ...base, title: 'Frontend Engineer' }, 'adzuna');
  const otherCity = normalizeListing({ ...base, location: 'Berlin, Germany' }, 'adzuna');

  assert.notEqual(one.dedupe_hash, otherCompany.dedupe_hash);
  assert.notEqual(one.dedupe_hash, otherTitle.dedupe_hash);
  assert.notEqual(one.dedupe_hash, otherCity.dedupe_hash);
});

test('returns null for a missing title', () => {
  assert.equal(normalizeListing({ ...base, title: undefined }, 'adzuna'), null);
  assert.equal(normalizeListing({ ...base, title: '' }, 'adzuna'), null);
  assert.equal(normalizeListing({ ...base, title: '   ' }, 'adzuna'), null);
});

test('returns null for a missing url', () => {
  assert.equal(normalizeListing({ ...base, url: undefined }, 'adzuna'), null);
  assert.equal(normalizeListing({ ...base, url: '' }, 'adzuna'), null);
});

test('returns null for a missing source_id', () => {
  assert.equal(normalizeListing({ ...base, source_id: undefined }, 'adzuna'), null);
});

test('returns null for junk input instead of throwing', () => {
  for (const junk of [null, undefined, 42, [], '', 'a string', true, NaN]) {
    assert.equal(normalizeListing(junk, 'adzuna'), null, `junk: ${String(junk)}`);
  }
  // A missing adapter id is also unusable — the row could not be prefixed.
  assert.equal(normalizeListing({ ...base }, undefined), null);
});

test('optional fields normalize to null rather than undefined', () => {
  const row = normalizeListing({ source_id: 1, title: 'PM', url: 'https://example.com/jobs/1' }, 'cache');
  assert.equal(row.company, null);
  assert.equal(row.location, null);
  assert.equal(row.category, null);
  assert.equal(row.job_type, null);
  assert.equal(row.salary_min, null);
  assert.equal(row.salary_max, null);
  assert.equal(row.posted_at, null);
  assert.equal(row.remote, false);
  assert.deepEqual(row.tags, []);
  assert.deepEqual(row.keywords, []);
  assert.deepEqual(row.keyword_terms, []);
  assert.deepEqual(row.requirements, []);
  // The DB check constraint only allows 'full' | 'snippet'.
  assert.equal(row.description_quality, 'full');
});

test('an unknown description_quality falls back to full', () => {
  const row = normalizeListing({ ...base, description_quality: 'partial' }, 'cache');
  assert.equal(row.description_quality, 'full');
});

test('snippet quality is carried through', () => {
  const row = normalizeListing({ ...base, description_quality: 'snippet' }, 'adzuna');
  assert.equal(row.description_quality, 'snippet');
});

test('posted_at is coerced to an ISO string, and garbage to null', () => {
  const good = normalizeListing({ ...base, posted_at: '2026-09-01T09:00:00Z' }, 'cache');
  assert.equal(good.posted_at, '2026-09-01T09:00:00.000Z');

  const bad = normalizeListing({ ...base, posted_at: 'not a date' }, 'cache');
  assert.equal(bad.posted_at, null);
});

test('HTML descriptions are stripped before storage', () => {
  const row = normalizeListing({ ...base, description: '<p>Build <b>APIs</b> in Node.js</p>' }, 'remotive');
  assert.ok(!row.description.includes('<'), 'markup survived into the stored row');
  assert.ok(row.description.includes('APIs'));
});

test('non-finite salaries become null', () => {
  const row = normalizeListing({ ...base, salary_min: 'not a number', salary_max: Infinity }, 'adzuna');
  assert.equal(row.salary_min, null);
  assert.equal(row.salary_max, null);
});

// ------------------------------------------------------------------
// splitLocation — structured location parts
// ------------------------------------------------------------------

test('splitLocation prefers the provider structured area, broadest-first', () => {
  // Adzuna sends ['US','Florida','Hillsborough County','Tampa Palms'] while
  // its display_name is "Tampa Palms, Hillsborough County" — a city and a
  // COUNTY. The display string can never answer "jobs in Florida"; this can.
  assert.deepEqual(
    splitLocation(['US', 'Florida', 'Hillsborough County', 'Tampa Palms'], 'Tampa Palms, Hillsborough County'),
    { country: 'United States', region: 'Florida', city: 'Tampa Palms' }
  );
});

test('splitLocation resolves a US state abbreviation to its country', () => {
  // The region is stored under the state's NAME, never the code that matched.
  // See the cross-path test below for why.
  assert.deepEqual(
    splitLocation(null, 'San Francisco, CA'),
    { city: 'San Francisco', region: 'California', country: 'United States' }
  );
});

test('splitLocation reads a trailing country name', () => {
  assert.deepEqual(
    splitLocation(null, 'Bengaluru, India'),
    { city: 'Bengaluru', region: null, country: 'India' }
  );
});

test('splitLocation tells a lone country from a lone city', () => {
  // Remotive's entire location vocabulary is values like these. Before the
  // reverse name lookup, "Canada" parsed as a city called Canada and the
  // typeahead offered it as one.
  assert.equal(splitLocation(null, 'Canada').country, 'Canada');
  assert.equal(splitLocation(null, 'Canada').city, null);
  assert.equal(splitLocation(null, 'USA').country, 'United States');
  assert.equal(splitLocation(null, 'London').city, 'London');
  assert.equal(splitLocation(null, 'London').country, null);
});

test('splitLocation treats a broad region as a region, not a city', () => {
  for (const value of ['Worldwide', 'Europe', 'APAC', 'LATAM']) {
    const parts = splitLocation(null, value);
    assert.equal(parts.city, null, `${value} became a city`);
    assert.equal(parts.region, value);
  }
});

test('splitLocation takes only the first of a multi-location string', () => {
  // "SF • New York • United States" is three places. A composite is a place
  // that does not exist and nobody can search for it.
  assert.equal(
    splitLocation(null, 'San Francisco, CA • New York, NY • United States').city,
    'San Francisco'
  );
});

test('splitLocation never promotes an unrecognised trailing segment to a country', () => {
  // Every one of these was in location_country in production on 2026-09-19,
  // offered by the typeahead as a country somebody could pick.
  const bad = {
    'Dresden, Altmarkt 21/22': 'Altmarkt 21/22',          // a street address
    'Paris, Paris': 'Paris',                               // a city
    'Berlin, Brandenburg': 'Brandenburg',                  // a German state
    'Düsseldorf, North Rhine-Westphalia': 'North Rhine-Westphalia',
    'London, England': 'England',                          // a UK nation
    'Tampa Palms, Hillsborough County': 'Hillsborough County',
  };
  for (const [display, wrongCountry] of Object.entries(bad)) {
    const parts = splitLocation(null, display);
    assert.equal(parts.country, null, `${display} still produced a country`);
    // It degrades to the weaker claim rather than vanishing.
    assert.equal(parts.region, wrongCountry);
    assert.equal(parts.city, display.split(',')[0].trim());
  }
});

test('splitLocation still reads a real country after the last comma', () => {
  // The guard above is only safe because the name table has real coverage.
  // Portugal is not in the alias map and must still parse as a country.
  assert.deepEqual(
    splitLocation(null, 'Lisbon, Portugal'),
    { city: 'Lisbon', region: null, country: 'Portugal' }
  );
  assert.equal(splitLocation(null, 'Tokyo, Japan').country, 'Japan');
  assert.deepEqual(
    splitLocation(null, 'Munich, Bavaria, Germany'),
    { city: 'Munich', region: 'Bavaria', country: 'Germany' }
  );
});

test('splitLocation resolves a Canadian province to its country', () => {
  assert.deepEqual(
    splitLocation(null, 'Toronto, ON'),
    { city: 'Toronto', region: 'Ontario', country: 'Canada' }
  );
});

// ------------------------------------------------------------------
// The two paths must agree on how a region is SPELLED
// ------------------------------------------------------------------
//
// ═══ THE DEFECT THIS PINS ═══
//
// splitLocation reaches a region two ways, and they used to disagree. The
// free-text branch matched a two-letter code and stored `last.toUpperCase()`
// — the CODE. The structured branch took Adzuna's `area[1]` — the NAME. So one
// state occupied two rows of the location facets, each holding part of its
// listings, and picking either in the dropdown returned only that half:
// measured on the live pool 2026-09-20, CA(105) beside California(55) and
// NY(144) beside New York(38).
//
// Nothing in the old tests could catch it, because each branch was asserted
// on its own and each was self-consistent. Only a test that runs BOTH against
// the same real place can fail here — which is why this one is written as an
// equality between paths rather than against a literal.

test('the free-text and structured paths agree on a region, for every state and province', () => {
  const places = [
    // [display string, Adzuna area array, expected canonical region]
    ['Austin, TX', ['US', 'Texas', 'Travis County', 'Austin'], 'Texas'],
    ['San Francisco, CA', ['US', 'California', 'San Francisco County', 'San Francisco'], 'California'],
    ['Brooklyn, NY', ['US', 'New York', 'Kings County', 'Brooklyn'], 'New York'],
    ['Toronto, ON', ['CA', 'Ontario', 'Toronto Division', 'Toronto'], 'Ontario'],
  ];

  for (const [display, area, expected] of places) {
    const free = splitLocation(null, display);
    const structured = splitLocation(area, display);

    assert.equal(free.region, expected, `free-text "${display}" should give ${expected}`);
    assert.equal(structured.region, expected, `structured ${JSON.stringify(area)} should give ${expected}`);
    // The claim that actually matters: not what either one says, but that they
    // say the SAME thing. One place, one facet row.
    assert.equal(free.region, structured.region, `"${display}" split into two facet values`);
  }
});

test('a region already spelled out is folded onto one casing', () => {
  // "austin, texas" and "Austin, TX" are the same place said two ways, and a
  // facet grouped on the exact stored string cannot tell that on its own.
  assert.equal(splitLocation(null, 'Austin, texas').region, 'Texas');
  assert.equal(splitLocation(null, 'Austin, TEXAS').region, 'Texas');
  assert.equal(splitLocation(['US', 'texas', 'Austin'], 'Austin').region, 'Texas');
});

test('a spelled-out state or province resolves to its country too', () => {
  // "Austin, TX" got country 'United States' from the abbreviation branch;
  // "Austin, Texas" fell past it and stored a null country. Same place, in the
  // country filter only half the time.
  for (const [display, expected] of [
    ['Austin, Texas', { city: 'Austin', region: 'Texas', country: 'United States' }],
    ['Austin, TX', { city: 'Austin', region: 'Texas', country: 'United States' }],
    ['Seattle, Washington', { city: 'Seattle', region: 'Washington', country: 'United States' }],
    ['Toronto, Ontario', { city: 'Toronto', region: 'Ontario', country: 'Canada' }],
    ['Toronto, ON', { city: 'Toronto', region: 'Ontario', country: 'Canada' }],
  ]) {
    assert.deepEqual(splitLocation(null, display), expected, display);
  }

  // Spelled out and abbreviated must be indistinguishable once stored.
  assert.deepEqual(splitLocation(null, 'Austin, Texas'), splitLocation(null, 'Austin, TX'));
});

test('Georgia stays the country, because the string cannot say which it is', () => {
  // The one name that is both a US state and a country. "Tbilisi, Georgia" and
  // "Atlanta, Georgia" are genuinely ambiguous, and filing the country as a US
  // state is the worse of the two errors — so the country keeps precedence and
  // this behaviour is unchanged from before state names were recognised.
  assert.deepEqual(
    splitLocation(null, 'Tbilisi, Georgia'),
    { city: 'Tbilisi', region: null, country: 'Georgia' }
  );
  assert.deepEqual(
    splitLocation(null, 'Atlanta, Georgia'),
    { city: 'Atlanta', region: null, country: 'Georgia' }
  );

  // Adzuna names the level structurally, so there is no ambiguity to resolve:
  // area[1] IS the region, and Georgia is read as the state there.
  assert.deepEqual(
    splitLocation(['US', 'Georgia', 'Fulton County', 'Atlanta'], 'Atlanta, Fulton County'),
    { city: 'Atlanta', region: 'Georgia', country: 'United States' }
  );
});

test('a region that is not a state or province still yields no country', () => {
  // The inference must not widen into "any trailing segment is a US state".
  assert.deepEqual(
    splitLocation(null, 'Lille, Nord'),
    { city: 'Lille', region: 'Nord', country: null }
  );
  assert.equal(splitLocation(null, 'Paris, Île-de-France').country, null);
});

test('canonicalRegion passes an unrecognised region through as null', () => {
  // Alias semantics, not validation — most regions in this pool are neither a
  // US state nor a Canadian province, and callers fold with `|| value`.
  assert.equal(canonicalRegion('tx'), 'Texas');
  assert.equal(canonicalRegion('Texas'), 'Texas');
  assert.equal(canonicalRegion('Île-de-France'), null);
  assert.equal(canonicalRegion(''), null);
  assert.equal(canonicalRegion(null), null);

  // ...and splitLocation keeps those unknowns rather than dropping them.
  assert.equal(splitLocation(null, 'Lille, Nord').region, 'Nord');
  assert.equal(splitLocation(['FR', 'Île-de-France', 'Paris'], 'Paris').region, 'Île-de-France');
});

test('splitLocation keeps NL as the Netherlands, not Newfoundland', () => {
  // NL is both. A jobs feed means Amsterdam far more often than St. John's,
  // so CA_PROVINCES deliberately omits it — see the comment there.
  assert.equal(splitLocation(null, 'Amsterdam, NL').country, 'Netherlands');
});

test('splitLocation folds endonyms and casing onto one canonical name', () => {
  // 'Deutschland' (48), 'Germany' (33) and 'Allemagne' (1) were three
  // separate buckets in the country typeahead on the same pool.
  for (const spelling of ['Deutschland', 'deutschland', 'GERMANY', 'Allemagne', 'DE']) {
    assert.equal(splitLocation(null, spelling).country, 'Germany', spelling);
  }
  assert.equal(splitLocation(null, 'Frankrijk').country, 'France');
  assert.equal(splitLocation(null, 'Paris, Frankreich').country, 'France');
});

test('splitLocation splits a multi-location string on a semicolon too', () => {
  // arbeitnow uses "; " where Remotive uses the bullet. Splitting on only the
  // bullet made "Nord; Paris" one region and "Paris" a country.
  const parts = splitLocation(null, 'Lille - Btwin Village, Nord; Paris, Paris');
  assert.equal(parts.city, 'Lille - Btwin Village');
  assert.equal(parts.region, 'Nord');
  assert.equal(parts.country, null);
});

test('splitLocation trusts the provider structured country it has not heard of', () => {
  // area[0] is the country by contract, so it is aliased, never gated — a
  // country missing from the name table must not be discarded here.
  assert.equal(splitLocation(['Kiribati', 'Tarawa'], '').country, 'Kiribati');
});

test('splitLocation strips the (HQ) suffix and is total on junk', () => {
  assert.equal(splitLocation(null, 'New York, NY (HQ)').city, 'New York');
  for (const junk of ['', null, undefined, '   ', ',,,']) {
    assert.deepEqual(splitLocation(null, junk), { city: null, region: null, country: null });
  }
});

test('normalizeListing stores the parts alongside the display string', () => {
  const row = normalizeListing(
    { ...base, location: 'Tampa Palms, Hillsborough County', location_area: ['US', 'Florida', 'Hillsborough County', 'Tampa Palms'] },
    'adzuna'
  );
  assert.equal(row.location, 'Tampa Palms, Hillsborough County', 'the display column must survive');
  assert.equal(row.location_city, 'Tampa Palms');
  assert.equal(row.location_region, 'Florida');
  assert.equal(row.location_country, 'United States');
});
