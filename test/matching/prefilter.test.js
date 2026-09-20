import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildResumeProfile,
  prefilterJobs,
  normalizeJobKeywords,
  titleOverlap,
} from '../../src/matching/prefilter.js';
import { CV } from '../fixtures/jobs.js';

const compactJob = {
  id: 'j1',
  title: 'Senior Backend Engineer',
  company: 'Norwick Labs',
  posted_at: '2026-01-02',
  keywords: [
    { t: 'python', w: 1, r: true },
    { t: 'kubernetes', w: 1, r: true },
    { t: 'kafka', w: 1, r: false },
  ],
};

const expandedJob = {
  ...compactJob,
  keywords: [
    { term: 'python', weight: 1, required: true },
    { term: 'kubernetes', weight: 1, required: true },
    { term: 'kafka', weight: 1, required: false },
  ],
};

test('buildResumeProfile is total', () => {
  for (const input of [null, undefined, 42, {}, { skills: 'nope' }]) {
    const profile = buildResumeProfile(input);
    assert.ok(profile.keywordSet instanceof Map);
    assert.deepEqual(profile.titles, []);
    assert.equal(profile.level, null);
    assert.equal(profile.yearsExperience, null);
  }
});

test('buildResumeProfile folds resume skills into job vocabulary', () => {
  const profile = buildResumeProfile(CV);
  // "K8s" on the resume must land on the same canonical term a JD's
  // "Kubernetes" produces.
  assert.ok(profile.keywordSet.has('kubernetes'));
  assert.ok(profile.keywordSet.has('python'));
  assert.ok(profile.keywordSet.has('postgresql'));
  assert.ok(profile.keywordSet.has('rest api'));
  assert.ok(profile.keywordSet.has('system design'));
  // Education contributes at a discount.
  assert.ok(profile.keywordSet.has('computer science') || profile.keywordSet.has('science'));
  assert.equal(profile.yearsExperience, 7);
  assert.equal(profile.level, 3); // "Senior Backend Engineer"
});

test('normalizeJobKeywords accepts both stored shapes identically', () => {
  assert.deepEqual(normalizeJobKeywords(compactJob), normalizeJobKeywords(expandedJob));
  assert.deepEqual(normalizeJobKeywords(null), []);
  assert.deepEqual(normalizeJobKeywords({ keyword_terms: ['React', 'Vue'] }), [
    { term: 'react', weight: 1, required: false, count: 1, category: 'frontend' },
    { term: 'vue', weight: 1, required: false, count: 1, category: 'frontend' },
  ]);
});

test('prefilterJobs produces identical ordering for both keyword shapes', () => {
  const profile = buildResumeProfile(CV);
  const compact = prefilterJobs(profile, [
    compactJob,
    { ...compactJob, id: 'j2', keywords: [{ t: 'php', w: 1, r: true }] },
  ]);
  const expanded = prefilterJobs(profile, [
    expandedJob,
    { ...expandedJob, id: 'j2', keywords: [{ term: 'php', weight: 1, required: true }] },
  ]);
  assert.deepEqual(
    compact.map((row) => [row.job.id, row.prefilterScore, row.matchedTerms]),
    expanded.map((row) => [row.job.id, row.prefilterScore, row.matchedTerms]),
  );
  assert.equal(compact[0].job.id, 'j1');
  assert.ok(compact[0].prefilterScore > compact[1].prefilterScore);
});

test('prefilterJobs tie-break is deterministic and not sort-stability luck', () => {
  const profile = buildResumeProfile(CV);
  const shared = { title: 'Backend Engineer', keywords: [{ t: 'python', w: 1, r: true }] };
  const jobs = [
    { ...shared, id: 'bbb', posted_at: '2026-01-01' },
    { ...shared, id: 'aaa', posted_at: '2026-01-01' },
    { ...shared, id: 'ccc', posted_at: '2026-02-01' },
  ];
  const order = () => prefilterJobs(profile, jobs).map((row) => row.job.id);
  // posted_at desc first, then id asc.
  assert.deepEqual(order(), ['ccc', 'aaa', 'bbb']);
  // Reversing the input must not change the output.
  assert.deepEqual(prefilterJobs(profile, [...jobs].reverse()).map((r) => r.job.id), ['ccc', 'aaa', 'bbb']);
  assert.deepEqual(order(), order());
});

test('prefilterJobs honours the limit and survives junk input', () => {
  const profile = buildResumeProfile(CV);
  const jobs = Array.from({ length: 40 }, (_, i) => ({
    id: `j${i}`,
    keywords: [{ t: 'python', w: 1, r: true }],
  }));
  assert.equal(prefilterJobs(profile, jobs).length, 30);
  assert.equal(prefilterJobs(profile, jobs, { limit: 5 }).length, 5);
  assert.deepEqual(prefilterJobs(null, null), []);
  assert.deepEqual(prefilterJobs(profile, [null, undefined, 3]), []);
});

test('titleOverlap is bounded and empty-safe', () => {
  assert.equal(titleOverlap('Backend Engineer', ['Senior Backend Engineer']), 1);
  assert.equal(titleOverlap('Backend Engineer', ['Graphic Designer']), 0);
  assert.equal(titleOverlap('', ['Backend Engineer']), 0);
  assert.equal(titleOverlap('Backend Engineer', []), 0);
  assert.equal(titleOverlap(null, null), 0);
});

test('normalizeJobKeywords merges duplicate terms instead of dropping the later one', () => {
  // First-wins dedupe threw away the STRONGER signal: the second row carried
  // required:true and weight 2 and was discarded whole. Reachable from any
  // hand-built or externally-ingested keyword payload.
  const merged = normalizeJobKeywords({
    keywords: [
      { t: 'python', r: false },
      { t: 'Python', w: 2, r: true, c: 3 },
      { term: 'python', weight: 0.5, required: false, count: 2 },
      { t: 'docker', w: 1, r: true },
    ],
  });

  assert.equal(merged.length, 2);
  const python = merged[0];
  assert.equal(python.term, 'python', 'the merged entry keeps its first-occurrence position');
  assert.equal(python.required, true, 'required is the OR across occurrences');
  assert.equal(python.weight, 2, 'weight is the max across occurrences');
  assert.equal(python.count, 3, 'count is the max, not the sum — a duplicate row is an artifact');
  assert.equal(merged[1].term, 'docker');
});

test('normalizeJobKeywords merges across the compact and expanded shapes', () => {
  const merged = normalizeJobKeywords({
    keywords: [{ term: 'kubernetes', weight: 1, required: false }],
    keyword_terms: ['Kubernetes'],
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].weight, 1);
  assert.equal(merged[0].count, 1);
});

// ------------------------------------------------------------------
// The optional score floor
// ------------------------------------------------------------------

test('minScore drops the zero-overlap tail instead of padding to the limit', () => {
  const resume = buildResumeProfile({ skills: ['python', 'django'], titles: ['Engineer'] });
  const relevant = Array.from({ length: 10 }, (_, i) => ({
    id: `hit${i}`, title: 'Engineer', keyword_terms: ['python', 'django'],
  }));
  const irrelevant = Array.from({ length: 40 }, (_, i) => ({
    id: `miss${i}`, title: 'Driver', keyword_terms: ['cdl-a', 'otr'],
  }));
  const jobs = [...irrelevant, ...relevant];

  // Without the floor the caller gets a full 30, two thirds of which share
  // nothing at all with the resume.
  assert.equal(prefilterJobs(resume, jobs, { limit: 30 }).length, 30);

  const floored = prefilterJobs(resume, jobs, { limit: 30, minScore: 0 });
  assert.equal(floored.length, 10);
  for (const entry of floored) assert.ok(entry.prefilterScore > 0);
});

test('the floor returns nothing rather than a list of unrelated jobs', () => {
  // Every job scores 0 here. This used to return all 20 on the argument that
  // "we found nothing" reads worse than a short list — but the list it
  // returned was 20 driving jobs for a resume that shares not one term with
  // them, and that is the complaint, not the cure. Empty is the true answer
  // and the caller renders it as "no matches".
  const resume = buildResumeProfile({ skills: ['underwater basket weaving'] });
  const jobs = Array.from({ length: 20 }, (_, i) => ({
    id: `j${i}`, title: 'Driver', keyword_terms: ['cdl-a', 'otr'],
  }));
  assert.deepEqual(prefilterJobs(resume, jobs, { limit: 30, minScore: 0 }), []);

  // Without the floor the same call is still the "best N you have" pass.
  assert.equal(prefilterJobs(resume, jobs, { limit: 30 }).length, 20);
});

test('the floor holds in a pool too small to reach MIN_KEPT_CANDIDATES', () => {
  // ═══ THE REGRESSION THIS FILE EXISTS FOR ═══
  //
  // The floor used to be guarded by `above.length >= Math.min(8,
  // scored.length)`, which in a pool of 8 demanded that all 8 clear it — so
  // one relevant job among seven irrelevant ones discarded the floor entirely
  // and sent all eight to the scorer. Measured against the live pool on
  // 2026-09-20: India held exactly 8 listings, 1 of them relevant to a
  // software resume, and all 8 were rendered as matches.
  const resume = buildResumeProfile({
    skills: ['python', 'docker', 'javascript'], titles: ['Software Engineer'],
  });
  const relevant = { id: 'hit', title: 'Engineer', keyword_terms: ['python', 'docker'] };
  const irrelevant = Array.from({ length: 7 }, (_, i) => ({
    id: `miss${i}`, title: 'Music Producer', keyword_terms: ['music-production', 'mixing'],
  }));

  const floored = prefilterJobs(resume, [...irrelevant, relevant], { limit: 30, minScore: 0 });
  assert.equal(floored.length, 1, 'a thin pool must still be filtered');
  assert.equal(floored[0].job.id, 'hit');
});
