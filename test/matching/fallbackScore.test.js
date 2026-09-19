import test from 'node:test';
import assert from 'node:assert/strict';

import { buildResumeProfile } from '../../src/matching/prefilter.js';
import {
  fallbackScoreJob,
  missingKeywords,
  keywordCoverage,
  seniorityFit,
  ratio,
  SCORE_WEIGHTS,
} from '../../src/matching/fallbackScore.js';
import { NEVER_EMIT } from '../../src/matching/stopwords.js';
import { SKILL_LEXICON } from '../../src/matching/lexicon.js';
import { CV } from '../fixtures/jobs.js';

const profile = () => buildResumeProfile(CV);

test('ratio returns null for a zero denominator or non-finite input, never NaN', () => {
  assert.equal(ratio(1, 2), 0.5);
  // 0 hits out of 4 is a real answer; it must not collapse to the null case.
  assert.equal(ratio(0, 4), 0);
  assert.equal(ratio(3, 0), null);
  assert.equal(ratio(NaN, 4), null);
});

test('seniorityFit is exactly 0.5 when either level is unknown', () => {
  assert.equal(seniorityFit(null, 3), 0.5);
  assert.equal(seniorityFit(3, null), 0.5);
  assert.equal(seniorityFit(null, null), 0.5);
  assert.equal(seniorityFit(3, 3), 1);
  assert.equal(seniorityFit(0, 3), 0);
  assert.equal(seniorityFit(3, 7), 0);
});

test('fallbackScoreJob always returns an integer in [0,100], including for empty input', () => {
  const cases = [
    [null, null],
    [profile(), null],
    [null, { title: 'Backend Engineer' }],
    [profile(), {}],
    [profile(), { keywords: [] }],
  ];
  for (const [resume, job] of cases) {
    const result = fallbackScoreJob(resume, job);
    assert.ok(Number.isInteger(result.score), `not an integer: ${result.score}`);
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.ok(Array.isArray(result.matched));
    assert.ok(Array.isArray(result.missing));
    assert.equal(typeof result.lowSignal, 'boolean');
  }
});

test('a job with no keywords at all is lowSignal and scored on title alone', () => {
  const result = fallbackScoreJob(profile(), { id: 'x', title: 'Senior Backend Engineer' });
  assert.equal(result.lowSignal, true);
  assert.equal(result.score, 100); // full title overlap, nothing else to weigh
  assert.ok(result.confidence < 0.5);
});

test('null re-normalization: required-only coverage uses that ratio at full weight', () => {
  const resume = profile();
  const requiredOnly = {
    id: 'r1',
    title: 'Senior Backend Engineer',
    keywords: [
      { t: 'python', w: 1, r: true },
      { t: 'kubernetes', w: 1, r: true },
      { t: 'rust', w: 1, r: true },
      { t: 'php', w: 1, r: true },
    ],
  };
  const result = fallbackScoreJob(resume, requiredOnly);
  // 2 of 4 required matched → coverage is 0.5, NOT 0.65 * 0.5.
  const coverage = 0.5;
  const title = 1;
  const fit = 1; // "Senior ..." on both sides
  const expected = Math.round(
    100 * (SCORE_WEIGHTS.COVERAGE * coverage + SCORE_WEIGHTS.TITLE * title + SCORE_WEIGHTS.SENIORITY * fit),
  );
  assert.equal(result.score, expected);
  assert.equal(result.lowSignal, false);

  // And the same posting expressed as nice-to-haves re-normalizes identically.
  const niceOnly = { ...requiredOnly, keywords: requiredOnly.keywords.map((k) => ({ ...k, r: false })) };
  assert.equal(fallbackScoreJob(resume, niceOnly).score, expected);
});

test('mixed required and nice coverage uses the 0.65 / 0.35 split', () => {
  const resume = profile();
  const job = {
    id: 'm1',
    title: 'Backend Engineer',
    keywords: [
      { t: 'python', w: 1, r: true },
      { t: 'rust', w: 1, r: true },
      { t: 'docker', w: 1, r: false },
      { t: 'php', w: 1, r: false },
    ],
  };
  const coverage = SCORE_WEIGHTS.REQUIRED * 0.5 + SCORE_WEIGHTS.NICE * 0.5;
  const expected = Math.round(
    100 * (SCORE_WEIGHTS.COVERAGE * coverage + SCORE_WEIGHTS.TITLE * 1 + SCORE_WEIGHTS.SENIORITY * 0.5),
  );
  assert.equal(fallbackScoreJob(resume, job).score, expected);
});

test('scoring is deterministic', () => {
  const resume = profile();
  const job = {
    id: 'd1',
    title: 'Senior Backend Engineer',
    keywords: [
      { t: 'python', w: 1, r: true },
      { t: 'kafka', w: 1.1, r: false },
    ],
  };
  assert.deepEqual(fallbackScoreJob(resume, job), fallbackScoreJob(resume, job));
});

test('snippet descriptions get a confidence haircut', () => {
  const resume = profile();
  const base = { id: 's1', title: 'Backend Engineer', keywords: [{ t: 'python', w: 1, r: false }] };
  const plain = fallbackScoreJob(resume, base);
  const snippet = fallbackScoreJob(resume, { ...base, description_quality: 'snippet' });
  assert.equal(plain.score, snippet.score);
  assert.ok(snippet.confidence < plain.confidence);
});

test('missingKeywords respects the cap and the required-first ranking', () => {
  const resume = profile();
  const job = {
    id: 'k1',
    keywords: [
      { t: 'rust', w: 1, r: true, c: 1 },
      { t: 'php', w: 1, r: false, c: 4 },
      { t: 'elixir', w: 1, r: false, c: 1 },
      { t: 'scala', w: 1, r: true, c: 3 },
      { t: 'perl', w: 0.5, r: false, c: 1 },
      { t: 'python', w: 1, r: true, c: 9 },
      { t: 'haskell', w: 1, r: false, c: 1 },
      { t: 'clojure', w: 1, r: false, c: 1 },
    ],
  };
  const missing = missingKeywords(resume, job);
  assert.equal(missing.length, 6);
  // python is on the resume, so it is never "missing".
  assert.ok(!missing.some((m) => m.term === 'python'));
  // scala: 2 * 1 * log2(4) = 4 beats rust: 2 * 1 * log2(2) = 2 beats php: 1 * 1 * log2(5) ≈ 2.32.
  assert.deepEqual(missing.slice(0, 3).map((m) => m.term), ['scala', 'php', 'rust']);
  assert.equal(missing[0].category, 'language');
  assert.equal(missingKeywords(resume, job, { limit: 2 }).length, 2);
});

test('missingKeywords returns nothing for a truncated description', () => {
  const resume = profile();
  const job = {
    id: 'k2',
    description_quality: 'snippet',
    keywords: [{ t: 'rust', w: 1, r: true }],
  };
  assert.deepEqual(missingKeywords(resume, job), []);
});

test('missingKeywords is total', () => {
  assert.deepEqual(missingKeywords(null, null), []);
  assert.deepEqual(missingKeywords(undefined, {}), []);
});

// ------------------------------------------------------------------
// keywordCoverage — what replaced the percentage on a job card
// ------------------------------------------------------------------

test('keywordCoverage counts job keywords the resume evidences', () => {
  const resume = buildResumeProfile({ skills: ['python', 'sql'], titles: ['Data Analyst'] });
  const job = {
    title: 'Data Analyst',
    description_quality: 'full',
    keywords: [{ t: 'python' }, { t: 'sql' }, { t: 'tableau' }, { t: 'r' }],
  };
  assert.deepEqual(keywordCoverage(resume, job), { met: 2, total: 4 });
});

test('keywordCoverage complements missingKeywords for a short keyword list', () => {
  // The count and the amber chips under it are rendered side by side, from the
  // same vocabulary, so for a job inside the coverage window they must add up.
  const resume = buildResumeProfile({ skills: ['python'], titles: ['Engineer'] });
  const job = {
    title: 'Engineer',
    description_quality: 'full',
    keywords: [{ t: 'python' }, { t: 'kubernetes' }, { t: 'terraform' }],
  };
  const coverage = keywordCoverage(resume, job);
  const missing = missingKeywords(resume, job, { limit: 100 });
  assert.equal(coverage.total - coverage.met, missing.length);
});

test('keywordCoverage measures against the top terms, not all 25', () => {
  // Extraction emits up to 25 terms and many are not requirements — live rows
  // yield `spotify`, `bar`, `feel`. Counting against all of them renders a
  // good match as "2 of 25": a denominator made of noise, not a high bar.
  const resume = buildResumeProfile({ skills: ['python'], titles: ['Engineer'] });
  const job = {
    title: 'Engineer',
    description_quality: 'full',
    keywords: Array.from({ length: 25 }, (_, i) => ({ t: i === 0 ? 'python' : `filler${i}` })),
  };
  const coverage = keywordCoverage(resume, job);
  assert.ok(coverage.total <= 8, `denominator was ${coverage.total}`);
  assert.ok(coverage.total > 0);
});

test('the coverage window and the missing chips rank terms the same way', () => {
  // One definition of "important". If they diverged, a term could be inside
  // the count's window but never appear as a chip, or the reverse.
  const resume = buildResumeProfile({ skills: [], titles: [] });
  const job = {
    title: 'Engineer',
    description_quality: 'full',
    keywords: [
      { t: 'rare', w: 1, c: 1 },
      { t: 'central', w: 3, c: 9 },
      { t: 'mentioned', w: 1, c: 4 },
    ],
  };
  // Nothing is met, so every counted term is also a missing term, and the
  // highest-ranked one must lead the chips.
  assert.equal(missingKeywords(resume, job, { limit: 3 })[0].term, 'central');
});

test('keywordCoverage returns null for a snippet job, not a zero', () => {
  // ~200 characters of the posting were read. "0 of 2" would read as a bad
  // match when it means an unread one — the same reason missingKeywords
  // suppresses its chips here.
  const resume = buildResumeProfile({ skills: ['python'], titles: ['Engineer'] });
  const snippet = {
    title: 'Engineer',
    description_quality: 'snippet',
    keywords: [{ t: 'python' }, { t: 'go' }],
  };
  assert.equal(keywordCoverage(resume, snippet), null);
});

test('keywordCoverage returns null when there is nothing to count', () => {
  const resume = buildResumeProfile({ skills: ['python'] });
  assert.equal(keywordCoverage(resume, { description_quality: 'full', keywords: [] }), null);
  assert.equal(keywordCoverage(resume, null), null);
  assert.equal(keywordCoverage(null, null), null);
});

test('no NEVER_EMIT term is also a real lexicon skill', () => {
  // The two lists are edited independently and pull in opposite directions:
  // one says "this word carries no signal", the other says "this word IS a
  // competency". A term in both is silently unmatchable — it was caught once
  // with 'organization', which sits in SKILL_LEXICON beside 'time management'.
  const clashes = [...NEVER_EMIT].filter((term) => SKILL_LEXICON.has(term));
  assert.deepEqual(clashes, [], `blocked terms that are real skills: ${clashes.join(', ')}`);
});
