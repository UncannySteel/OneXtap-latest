/**
 * EVAL — FabricationRate
 *
 * THIS IS THE REGRESSION GATE. Zero model calls, no API keys, no network, same
 * answer every run: `validateAgainstCorpus` is deterministic by design (see the
 * header of src/matching/fabrication.js) and that is exactly what makes it
 * usable in CI. If any other eval in this directory has to be skipped, this one
 * still runs.
 *
 * What it measures, against hand-labelled generated sentences:
 *
 *   detectionRecall     fabricated sentences that raise at least one flag
 *   falsePositiveRate   faithful sentences that raise a flag anyway
 *   fabricationRate     the validator's own `rate`, pooled over each set
 *
 * Both failure directions matter. A checker that misses an inflated headcount
 * is useless; a checker that flags honest text is worse, because the amber box
 * gets ignored inside a week and then the real flags go unread too.
 *
 * `npm run evals`
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCorpus } from '../../src/corpus.js';
import { validateAgainstCorpus } from '../../src/matching/index.js';
import { CVS, cvById } from './fixtures/cvs.js';
import { GENERATIONS, FABRICATED, FAITHFUL } from './fixtures/generations.js';
import { pct } from './lib/score.js';

/**
 * THRESHOLD: every fabrication in the fixture set must be caught.
 *
 * 1.0 is only defensible because the fixtures are blatant on purpose — an
 * order-of-magnitude inflation, an employer that never existed, a budget
 * nobody managed. These are not edge cases; they are the failures that end an
 * interview. A single miss here is a real regression, not noise, so there is
 * no reason to leave slack. Add a subtle fixture and this number must be
 * lowered deliberately, in a commit that says why.
 */
const MIN_DETECTION_RECALL = 1.0;

/**
 * THRESHOLD: at most one faithful sentence in seven may be flagged.
 *
 * The validator is deliberately conservative on strict claims (0.85 similarity
 * against the nearest CV bullet), so a heavy reordering of a real bullet can
 * dip under the bar. The set scores 0.0 today; 0.15 is one sample of the
 * current seven, which is enough headroom to add fixtures without retuning and
 * tight enough that a change making the checker chatty fails right here.
 */
const MAX_FALSE_POSITIVE_RATE = 0.15;

/** Pooled `rate` bounds — the metric this eval is named after. */
const MIN_FABRICATED_POOL_RATE = 0.85;
const MAX_FAITHFUL_POOL_RATE = 0.15;

/** Corpora are built once: buildCorpus is pure, so sharing them is free. */
const CORPORA = new Map(CVS.map((cv) => [cv.id, buildCorpus(cv.parsed, cv.cvText)]));

const corpusFor = (id) => {
  const corpus = CORPORA.get(id);
  assert.ok(corpus?.length, `fixture "${id}" produced an empty corpus — the eval would be vacuous`);
  return corpus;
};

/** Pool a set of samples per CV and return the validator's own rate. */
function pooledRate(samples) {
  let flagged = 0;
  let claims = 0;
  for (const cv of CVS) {
    const text = samples.filter((s) => s.cv === cv.id).map((s) => s.text).join('\n');
    if (!text) continue;
    const result = validateAgainstCorpus(text, corpusFor(cv.id));
    flagged += result.flags.length;
    claims += result.totalClaims;
  }
  return { rate: claims === 0 ? 0 : flagged / claims, flagged, claims };
}

test('FabricationRate: every fixture corpus is non-trivial', () => {
  // Guards the whole file: an empty corpus flags everything, which would make
  // detectionRecall 1.0 and falsePositiveRate 1.0 for the wrong reason.
  for (const cv of CVS) {
    assert.ok(corpusFor(cv.id).length >= 8, `${cv.id} corpus is too small to be a real test`);
  }
});

test('FabricationRate: fabricated claims are caught', (t) => {
  const missed = [];
  for (const sample of FABRICATED) {
    const result = validateAgainstCorpus(sample.text, corpusFor(sample.cv));
    if (result.flags.length === 0) missed.push(sample.id);
    else {
      const flag = result.flags[0];
      t.diagnostic(`caught ${sample.id} (sim ${flag.similarity} < ${flag.threshold}, ${flag.severity})`);
    }
  }

  const recall = (FABRICATED.length - missed.length) / FABRICATED.length;
  t.diagnostic(`detectionRecall = ${pct(recall)} over ${FABRICATED.length} fabricated samples`);

  assert.ok(
    recall >= MIN_DETECTION_RECALL,
    `detectionRecall ${pct(recall)} below ${pct(MIN_DETECTION_RECALL)}; missed: ${missed.join(', ')}`,
  );
});

test('FabricationRate: faithful claims are left alone', (t) => {
  const falsePositives = [];
  for (const sample of FAITHFUL) {
    const result = validateAgainstCorpus(sample.text, corpusFor(sample.cv));
    if (result.flags.length > 0) {
      falsePositives.push(`${sample.id} (sim ${result.flags[0].similarity})`);
    }
  }

  const rate = falsePositives.length / FAITHFUL.length;
  t.diagnostic(`falsePositiveRate = ${pct(rate)} over ${FAITHFUL.length} faithful samples`);

  assert.ok(
    rate <= MAX_FALSE_POSITIVE_RATE,
    `falsePositiveRate ${pct(rate)} above ${pct(MAX_FALSE_POSITIVE_RATE)}; flagged: ${falsePositives.join(', ')}`,
  );
});

test('FabricationRate: the pooled rate separates the two sets', (t) => {
  const fabricated = pooledRate(FABRICATED);
  const faithful = pooledRate(FAITHFUL);

  t.diagnostic(`fabricationRate(fabricated) = ${fabricated.rate.toFixed(4)} (${fabricated.flagged}/${fabricated.claims} claims)`);
  t.diagnostic(`fabricationRate(faithful)   = ${faithful.rate.toFixed(4)} (${faithful.flagged}/${faithful.claims} claims)`);

  assert.ok(
    fabricated.rate >= MIN_FABRICATED_POOL_RATE,
    `pooled fabricated rate ${fabricated.rate} below ${MIN_FABRICATED_POOL_RATE}`,
  );
  assert.ok(
    faithful.rate <= MAX_FAITHFUL_POOL_RATE,
    `pooled faithful rate ${faithful.rate} above ${MAX_FAITHFUL_POOL_RATE}`,
  );
});

test('FabricationRate: the metric is reproducible', () => {
  // A gate that moves between runs is not a gate. Everything upstream —
  // buildCorpus and validateAgainstCorpus — is pure, and this is what keeps
  // that true.
  for (const sample of GENERATIONS) {
    const corpus = corpusFor(sample.cv);
    assert.deepEqual(
      validateAgainstCorpus(sample.text, corpus),
      validateAgainstCorpus(sample.text, corpus),
      `${sample.id} did not validate identically twice`,
    );
  }

  assert.deepEqual(pooledRate(FABRICATED), pooledRate(FABRICATED));
  // cvById is exercised here so an unused-export drift shows up as a failure.
  assert.equal(cvById(CVS[0].id).id, CVS[0].id);
});
