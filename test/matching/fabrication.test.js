import test from 'node:test';
import assert from 'node:assert/strict';

import {
  segmentClaims,
  similarity,
  isStrictClaim,
  validateAgainstCorpus,
  FAB_THRESHOLDS,
} from '../../src/matching/fabrication.js';
import { buildCorpus } from '../../src/corpus.js';
import { CV } from '../fixtures/jobs.js';

const corpus = () => buildCorpus(CV);

test('segmentClaims splits on sentences and bullets and drops fragments', () => {
  const claims = segmentClaims('Built the ledger service. React.\n• Shipped a data pipeline for billing.');
  assert.equal(claims.length, 2);
  assert.ok(claims[0].startsWith('Built the ledger'));
  assert.ok(claims[1].startsWith('Shipped a data pipeline'));
  assert.deepEqual(segmentClaims(''), []);
  assert.deepEqual(segmentClaims(null), []);
});

test('isStrictClaim fires on numbers, years, percentages, money and proper nouns', () => {
  assert.equal(isStrictClaim('Led a team of 40 engineers'), true);
  assert.equal(isStrictClaim('Joined in 2019 and stayed'), true);
  assert.equal(isStrictClaim('Cut latency by 30% across the fleet'), true);
  assert.equal(isStrictClaim('Managed a $2m infrastructure budget'), true);
  assert.equal(isStrictClaim('Worked at Norwick Labs on payments'), true);
  assert.equal(isStrictClaim('Collaborated closely with other teams'), false);
  assert.equal(isStrictClaim(null), false);
});

test('similarity uses the max of containment and trigram overlap', () => {
  const claim = 'Built REST APIs in Python.';
  const reference = 'Built REST APIs in Python serving 12 million requests per day.';
  // Containment is high (every claim token appears); trigram overlap is much
  // lower because the reference is far longer. max() must pick the high one.
  assert.ok(similarity(claim, reference) > 0.9);
  assert.equal(similarity('', reference), 0);
  assert.equal(similarity(claim, ''), 0);
  assert.equal(similarity(claim, { text: reference }), similarity(claim, reference));
});

test('validator catches a fabricated number at high severity', () => {
  const result = validateAgainstCorpus('Led a team of 40 engineers rebuilding the payments ledger.', corpus());
  assert.equal(result.totalClaims, 1);
  assert.equal(result.flags.length, 1);
  assert.equal(result.flags[0].severity, 'high');
  assert.equal(result.flags[0].threshold, FAB_THRESHOLDS.STRICT_SIM);
  assert.equal(result.flags[0].nearestRef, 'exp.0.bullet.0');
  assert.equal(result.rate, 1);
});

test('validator does not flag a faithful paraphrase', () => {
  const result = validateAgainstCorpus(
    'Migrated the deployment pipeline to Docker and Kubernetes.',
    corpus(),
  );
  assert.equal(result.totalClaims, 1);
  assert.deepEqual(result.flags, []);
  assert.equal(result.rate, 0);
});

test('validator on an empty or missing corpus flags everything without throwing', () => {
  for (const empty of [[], null, undefined, 'nope']) {
    const result = validateAgainstCorpus('Built REST APIs in Python serving traffic.', empty);
    assert.equal(result.totalClaims, 1);
    assert.equal(result.flags.length, 1);
    assert.equal(result.flags[0].nearestRef, null);
    assert.equal(result.flags[0].nearestText, '');
    assert.equal(result.flags[0].similarity, 0);
  }
});

test('empty generated text yields a zero rate, never NaN', () => {
  const result = validateAgainstCorpus('', corpus());
  assert.deepEqual(result, { flags: [], rate: 0, totalClaims: 0 });
  assert.equal(validateAgainstCorpus(null, corpus()).rate, 0);
  assert.ok(!Number.isNaN(validateAgainstCorpus('', []).rate));
});

test('a grounded number in an otherwise matching claim is not flagged', () => {
  const result = validateAgainstCorpus('Led a team of 4 engineers rebuilding the payments ledger.', corpus());
  assert.deepEqual(result.flags, []);
});

test('thresholds can be overridden per call', () => {
  // The numeral gate is independent of the similarity threshold: a lowered
  // strictSim does not make a fabricated headcount acceptable.
  const fabricated = 'Led a team of 40 engineers rebuilding the payments ledger.';
  assert.equal(validateAgainstCorpus(fabricated, corpus(), { strictSim: 0.1 }).flags.length, 1);
  assert.equal(
    validateAgainstCorpus(fabricated, corpus(), { strictSim: 0.1, requireGroundedNumerals: false }).flags.length,
    0,
  );

  const soft = 'Collaborated closely with partner teams on delivery.';
  assert.equal(validateAgainstCorpus(soft, corpus(), { minSim: 0.99 }).flags.length, 1);
  assert.equal(validateAgainstCorpus(soft, corpus(), { minSim: 0.05 }).flags.length, 0);
});

test('validation is deterministic', () => {
  const text = 'Led a team of 40 engineers.\nMigrated the deployment pipeline to Docker and Kubernetes.';
  assert.deepEqual(validateAgainstCorpus(text, corpus()), validateAgainstCorpus(text, corpus()));
});
