/**
 * EVAL — ProfileFieldAccuracy
 *
 * How much of a resume does the parser get right, field by field, against a
 * human's reading of the same document?
 *
 * Runs offline with no API keys. The fixtures hold RECORDED parser output
 * rather than calling Gemini, so this is a snapshot gate: it holds the line
 * on extraction quality between re-recordings and fails loudly if the scoring
 * definition itself is loosened. When the parser or its model changes,
 * re-record `parsed` in test/evals/fixtures/cvs.js and read the new number
 * before accepting it.
 *
 * `npm run evals`
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CVS } from './fixtures/cvs.js';
import { GRADED_FIELDS, scoreProfileFields, pct } from './lib/score.js';

/**
 * THRESHOLD: nine fields in ten.
 *
 * Below this the user is re-typing their resume rather than reviewing it,
 * which is the entire value proposition gone. The fixture set scores ~0.946
 * today, so the gate leaves about half a field of headroom per CV: tight
 * enough that a regression which drops one more field across the set fails
 * here, loose enough that adding a harder fixture does not require retuning.
 */
const MIN_MICRO_ACCURACY = 0.90;

/**
 * THRESHOLD: no single resume may collapse.
 *
 * A micro-average hides a catastrophe — two perfect parses and one at 0.55
 * still averages 0.85. Set lower than the micro gate because one document is
 * a small sample: two wrong fields out of thirteen is a bad day, not a broken
 * parser, and 0.85 is a shade under that (11/13 = 0.846 fails).
 */
const MIN_PER_CV_ACCURACY = 0.85;

test('ProfileFieldAccuracy: recorded parses match the hand-labelled CVs', (t) => {
  let earned = 0;
  let total = 0;

  for (const cv of CVS) {
    const result = scoreProfileFields(cv.parsed, cv.labels);
    earned += result.earned;
    total += result.total;

    const misses = result.fields.filter((f) => f.score < 1);
    t.diagnostic(
      `${cv.id}: ${pct(result.score)} (${result.earned.toFixed(2)}/${result.total})`
      + (misses.length ? ` — missed ${misses.map((m) => m.path).join(', ')}` : ' — clean')
    );

    assert.ok(
      result.score >= MIN_PER_CV_ACCURACY,
      `${cv.id} scored ${pct(result.score)}, below the per-CV floor of ${pct(MIN_PER_CV_ACCURACY)}`,
    );
  }

  const micro = earned / total;
  t.diagnostic(`ProfileFieldAccuracy = ${pct(micro)} over ${total} graded fields`);

  assert.ok(
    micro >= MIN_MICRO_ACCURACY,
    `ProfileFieldAccuracy ${pct(micro)} is below the ${pct(MIN_MICRO_ACCURACY)} gate`,
  );
});

test('ProfileFieldAccuracy: the scorer discriminates', () => {
  // Without this, a scorer that always returned ~0.9 would sail through the
  // gate above and the eval would measure nothing at all.
  const cv = CVS[0];

  const perfect = scoreProfileFields(cv.labels, cv.labels);
  assert.equal(perfect.score, 1, 'labels scored against themselves must be a perfect 1');

  // An empty parse is not exactly 0, and should not be: `experience.0.endDate`
  // is legitimately blank for a current job, so returning nothing happens to
  // agree on that one field. Every other field must be wrong.
  const nothing = scoreProfileFields({}, cv.labels);
  assert.ok(
    nothing.score <= 1 / GRADED_FIELDS.length,
    `an empty parse scored ${pct(nothing.score)}; only the blank end date may match`,
  );

  const total = scoreProfileFields(cv.parsed, cv.labels).total;
  assert.equal(total, GRADED_FIELDS.length, 'every graded field must be scored');
});
