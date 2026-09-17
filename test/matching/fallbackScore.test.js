import test from 'node:test';
import assert from 'node:assert/strict';

import { buildResumeProfile } from '../../src/matching/prefilter.js';
import {
  fallbackScoreJob,
  missingKeywords,
  seniorityFit,
  ratio,
  SCORE_WEIGHTS,
} from '../../src/matching/fallbackScore.js';
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
