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
