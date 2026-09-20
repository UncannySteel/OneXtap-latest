/**
 * The occupation taxonomy and its cursor.
 *
 * These are pure functions, so they are cheap to pin — and worth pinning,
 * because the failure they guard against is silent. Ingest asking Adzuna for
 * nothing in particular produced a pool that was ~100% long-haul trucking for
 * months without erroring once; every symptom showed up as "the matcher is
 * broken" instead. A rotation that quietly stops rotating would do exactly the
 * same thing again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { SEARCH_TERMS, cursorToSearch } = await import('../../server/jobs/searchTerms.js');

/** Adzuna's own category tags, read from GET /v1/api/jobs/us/categories. */
const ADZUNA_CATEGORY_TAGS = new Set([
  'accounting-finance-jobs', 'it-jobs', 'sales-jobs', 'customer-services-jobs',
  'engineering-jobs', 'hr-jobs', 'healthcare-nursing-jobs', 'hospitality-catering-jobs',
  'pr-advertising-marketing-jobs', 'logistics-warehouse-jobs', 'teaching-jobs',
  'trade-construction-jobs', 'admin-jobs', 'legal-jobs', 'creative-design-jobs',
  'graduate-jobs', 'retail-jobs', 'consultancy-jobs', 'manufacturing-jobs',
  'scientific-qa-jobs', 'social-work-jobs', 'travel-jobs', 'energy-oil-gas-jobs',
  'property-jobs', 'charity-voluntary-jobs', 'domestic-help-cleaning-jobs',
  'maintenance-jobs', 'part-time-jobs', 'other-general-jobs', 'unknown',
]);

test('every category is a real Adzuna tag', () => {
  // An unknown tag is NOT an error at Adzuna — it is an empty result set. So a
  // typo here costs one occupation's worth of the pool and reports success.
  for (const entry of SEARCH_TERMS) {
    assert.ok(
      ADZUNA_CATEGORY_TAGS.has(entry.adzunaCategory),
      `${entry.term}: '${entry.adzunaCategory}' is not an Adzuna category tag`
    );
  }
});

test('terms are unique, non-empty and lowercase', () => {
  const seen = new Set();
  for (const entry of SEARCH_TERMS) {
    assert.ok(entry.term && entry.term.trim(), 'empty term');
    assert.equal(entry.term, entry.term.toLowerCase(), `${entry.term} is not lowercase`);
    assert.ok(!seen.has(entry.term), `duplicate term: ${entry.term}`);
    seen.add(entry.term);
  }
});

test('the taxonomy still covers non-office work', () => {
  // The obvious overcorrection is to fill this list with software roles. The
  // pool's current trucking bias is somebody's GOOD experience — whoever the
  // matching already works for is not a developer. Dropping these categories
  // would fix one cohort by breaking another.
  const categories = new Set(SEARCH_TERMS.map((e) => e.adzunaCategory));
  for (const required of [
    'logistics-warehouse-jobs', 'healthcare-nursing-jobs',
    'trade-construction-jobs', 'hospitality-catering-jobs', 'retail-jobs',
  ]) {
    assert.ok(categories.has(required), `lost coverage of ${required}`);
  }
  // ...and it must no longer be dominated by any single one.
  const counts = new Map();
  for (const e of SEARCH_TERMS) counts.set(e.adzunaCategory, (counts.get(e.adzunaCategory) || 0) + 1);
  const biggest = Math.max(...counts.values());
  assert.ok(
    biggest <= SEARCH_TERMS.length / 3,
    `one category holds ${biggest} of ${SEARCH_TERMS.length} slots`
  );
});

test('the cursor is term-major: +1 is the next occupation, not the next page', () => {
  // Load-bearing. Page-major rotation would spend a whole daily run — the
  // entire Adzuna call budget — deepening ONE occupation, which is the
  // behaviour this file exists to undo.
  const first = cursorToSearch(1);
  const second = cursorToSearch(2);
  assert.notEqual(first.term, second.term);
  assert.equal(first.page, 1);
  assert.equal(second.page, 1);
});

test('the cursor reaches every term before any term reaches page 2', () => {
  const n = SEARCH_TERMS.length;
  const covered = new Set();
  for (let c = 1; c <= n; c += 1) {
    const s = cursorToSearch(c);
    assert.equal(s.page, 1, `cursor ${c} went deep before the sweep finished`);
    covered.add(s.term);
  }
  assert.equal(covered.size, n, 'a full sweep missed an occupation');
  assert.equal(cursorToSearch(n + 1).page, 2);
  assert.equal(cursorToSearch(n + 1).term, cursorToSearch(1).term);
});

test('cursorToSearch is total: junk reads as the first term, page 1', () => {
  for (const junk of [0, -5, NaN, undefined, null, 'x']) {
    const s = cursorToSearch(junk);
    assert.equal(s.term, SEARCH_TERMS[0].term);
    assert.equal(s.page, 1);
  }
});

test('SEARCH_TERMS is frozen, entries included', () => {
  assert.ok(Object.isFrozen(SEARCH_TERMS));
  for (const entry of SEARCH_TERMS) assert.ok(Object.isFrozen(entry));
});

// ------------------------------------------------------------------
// The country dimension
//
// The bug these pin: country used to ride on a sub-cursor that advanced once
// per FULL pass over the taxonomy, making it the slowest-moving of the three
// dimensions. With 33 terms that meant cursors 1-33 were all one country and
// the second began at 34 — eleven daily runs of nothing. India held 8 rows,
// none from Adzuna, while the US held 1,211.
// ------------------------------------------------------------------
test('country is the FASTEST-moving dimension, not the slowest', () => {
  const countries = ['us', 'in'];
  const first = cursorToSearch(1, undefined, countries);
  const second = cursorToSearch(2, undefined, countries);
  const third = cursorToSearch(3, undefined, countries);

  // Consecutive cursors: same occupation, next country.
  assert.equal(first.country, 'us');
  assert.equal(second.country, 'in');
  assert.equal(second.term, first.term, 'the term holds while the country rotates');
  // Only once every country has been visited does the term advance.
  assert.equal(third.country, 'us');
  assert.notEqual(third.term, first.term);
});

test('one daily run of six cursors covers every configured country', () => {
  // MAX_PAGES_PER_RUN is 6. The whole point of the fix is that a single run
  // touches all of them rather than spending itself on the first.
  for (const countries of [['us', 'in'], ['us', 'in', 'gb']]) {
    const seen = new Set();
    for (let c = 1; c <= 6; c += 1) seen.add(cursorToSearch(c, undefined, countries).country);
    assert.deepEqual([...seen].sort(), [...countries].sort(),
      `six cursors must reach all of ${countries.join(',')}`);
  }
});

test('a full sweep visits every (country, term) pair exactly once', () => {
  // No duplicates and no holes. A hole is how a country goes unfetched; a
  // duplicate is a wasted call against a metered free tier.
  const countries = ['us', 'in', 'gb'];
  const seen = [];
  for (let c = 1; c <= countries.length * SEARCH_TERMS.length; c += 1) {
    const s = cursorToSearch(c, undefined, countries);
    assert.equal(s.page, 1, 'one sweep of depth 1 stays on page 1');
    seen.push(`${s.country}|${s.term}`);
  }
  assert.equal(new Set(seen).size, seen.length, 'no pair is visited twice');
  assert.equal(seen.length, countries.length * SEARCH_TERMS.length, 'and none is missed');
  for (const country of countries) {
    assert.equal(seen.filter((p) => p.startsWith(`${country}|`)).length, SEARCH_TERMS.length,
      `${country} gets the whole taxonomy, not a slice of it`);
  }
});

test('page depth advances only after every (country, term) pair is done', () => {
  const countries = ['us', 'in'];
  const perPage = countries.length * SEARCH_TERMS.length;
  assert.equal(cursorToSearch(perPage, undefined, countries).page, 1);
  const wrapped = cursorToSearch(perPage + 1, undefined, countries);
  assert.equal(wrapped.page, 2, 'the next pass goes one page deeper');
  assert.equal(wrapped.term, cursorToSearch(1, undefined, countries).term);
  assert.equal(wrapped.country, cursorToSearch(1, undefined, countries).country);
});

test('with no countries the decode is exactly the old term-major one', () => {
  // Every non-Adzuna caller still passes two arguments. This is the guarantee
  // that the third one is additive.
  for (const cursor of [1, 2, 17, 33, 34, 99]) {
    const bare = cursorToSearch(cursor);
    const empty = cursorToSearch(cursor, undefined, []);
    assert.equal(bare.country, undefined);
    assert.deepEqual(empty, bare);
    assert.equal(bare.term, SEARCH_TERMS[(cursor - 1) % SEARCH_TERMS.length].term);
    assert.equal(bare.page, Math.floor((cursor - 1) / SEARCH_TERMS.length) + 1);
  }
});

test('cursorToSearch stays total with junk countries', () => {
  for (const junk of [null, undefined, 'us', [null, ''], [undefined]]) {
    const s = cursorToSearch(5, undefined, junk);
    assert.equal(typeof s.term, 'string');
    assert.ok(s.page >= 1);
  }
});
