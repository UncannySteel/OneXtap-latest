import test from 'node:test';
import assert from 'node:assert/strict';

import {
  segmentClaims,
  similarity,
  isStrictClaim,
  isCheckableClaim,
  entitiesOf,
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

// ── The two-pass design ────────────────────────────────────────────────────
// Everything below is a regression: each case is one of the failure modes that
// made the validator flag truth and pass fabrication. See the header of
// src/matching/fabrication.js.

test('checkability: a sentence that only addresses the employer is not a claim', () => {
  // The cover-letter prompt REQUIRES naming the company and role, and both come
  // from the posting, which a CV corpus can never contain. Flagging them made
  // every letter open with a HIGH-severity false positive.
  assert.equal(isCheckableClaim('I am writing to apply for the Staff Engineer role at Kestrel Analytics.'), false);
  assert.equal(isCheckableClaim('Your posting mentions distributed systems and I have worked on them.'), false);
  assert.equal(isCheckableClaim('I would welcome the chance to discuss the role with your team.'), false);
  assert.equal(isCheckableClaim('Dear Hiring Team,'), false);
});

test('checkability: the resume-bullet voice is a claim even with no "I"', () => {
  // Bullets and Answer Studio output have no subject. A first-person test alone
  // would have exempted the entire shape the product actually generates.
  assert.equal(isCheckableClaim('Migrated the deployment pipeline to Docker and Kubernetes.'), true);
  assert.equal(isCheckableClaim('Collaborated closely with partner teams on delivery.'), true);
  assert.equal(isCheckableClaim('Led a team of 4 engineers rebuilding the payments ledger.'), true);
});

test('checkability: anything quantified is checked, addressing or not', () => {
  // Without this, "Raised $9M in 2021." has no first-person subject and is
  // skipped — and that is the highest-risk sentence shape there is.
  assert.equal(isCheckableClaim('Raised $9M in 2021.'), true);
  assert.equal(isCheckableClaim('I am applying for the role and led 40 engineers there.'), true);
});

test('entities: numerals, multi-word names and known skills, punctuation-insensitive', () => {
  const entities = entitiesOf('At Kestrel Analytics. I shipped 9 Python services.');
  assert.ok(entities.has('#9'), 'numeral');
  assert.ok(entities.has('$python'), 'lexicon skill');
  // "At" is a sentence opener, not part of the name, and the trailing full stop
  // must not make this a different entity from the corpus spelling.
  assert.ok(entities.has('@kestrel analytics'), `name, got ${[...entities].join(' ')}`);
  assert.ok(!entities.has('@at kestrel analytics.'), 'lead word and punctuation trimmed');
  assert.deepEqual([...entitiesOf(null)], []);
});

test('a multi-skill summary is grounded by the skills, not by sentence similarity', () => {
  // Each skill is its own one-word corpus item, so whole-sentence similarity
  // against any SINGLE item is structurally near zero. This is what used to
  // flag "I work in Python and PostgreSQL every day."
  const result = validateAgainstCorpus('I work in Python, PostgreSQL and Docker every day.', corpus());
  assert.deepEqual(result.flags, []);
  assert.equal(result.rate, 0);
});

test('an unlisted tool is still caught in that same shape', () => {
  // The mirror of the test above: entity grounding must not have simply turned
  // the multi-skill sentence into a blanket pass.
  const result = validateAgainstCorpus('I work in Python, PostgreSQL and Terraform every day.', corpus());
  assert.equal(result.flags.length, 1);
  assert.ok(result.flags[0].ungrounded.includes('$terraform'), result.flags[0].ungrounded.join(' '));
});

test('the numeral gate is per-claim, not pooled across the whole corpus', () => {
  // THE case the gate exists for. "a team of 40" against a CV saying 4 is a
  // near-verbatim copy, so similarity cannot catch it. A gate pooled over the
  // whole corpus grounds the 40 from any unrelated bullet — and a numerate CV
  // saturates that pool and disarms the gate completely.
  const inflated = validateAgainstCorpus('Led a team of 40 engineers rebuilding the payments ledger.', corpus());
  assert.equal(inflated.flags.length, 1);
  assert.ok(inflated.flags[0].ungrounded.includes('#40'));
  assert.equal(inflated.flags[0].severity, 'high');

  // The truthful version of the same sentence must stay quiet.
  assert.deepEqual(
    validateAgainstCorpus('Led a team of 4 engineers rebuilding the payments ledger.', corpus()).flags,
    [],
  );
});

test('magnitude suffixes are folded, so $1.2M grounds against $1,200,000', () => {
  // Without folding, the thousands-separator strip made this WORSE: the claim
  // yielded "1.2" and the CV "1200000", and a real achievement was reported as
  // a high-severity fabrication.
  const cv = [{ ref: 'exp.0.bullet.0', text: 'Grew annual recurring revenue from $400,000 to $1,200,000.' }];
  assert.deepEqual(
    validateAgainstCorpus('Grew annual recurring revenue from $400k to $1.2M.', cv).flags,
    [],
  );
  // "12 million" in the corpus grounds "12,000,000" in the claim and vice versa.
  assert.deepEqual(
    validateAgainstCorpus('Built REST APIs in Python serving 12,000,000 requests per day.', corpus()).flags,
    [],
  );
  // Folding must not fire on ordinary units: "40 minutes" is not 40 million.
  const minutes = [{ ref: 'exp.0.bullet.0', text: 'Cut the nightly run from 6 hours to 40 minutes.' }];
  assert.deepEqual(
    validateAgainstCorpus('Cut the nightly run from 6 hours to 40 minutes.', minutes).flags,
    [],
  );
});

test('the claim-token floor counts numerals, so terse metric claims are checked', () => {
  // `tokenize` discards numeric-only tokens, so this counted 3 against a floor
  // of 4 and was dropped unchecked — number-dense claims, the highest-risk
  // ones, were the ones being exempted.
  assert.deepEqual(segmentClaims('Raised $9M in 2021.'), ['Raised $9M in 2021.']);
  const result = validateAgainstCorpus('Raised $9M in 2021.', corpus());
  assert.equal(result.totalClaims, 1);
  assert.equal(result.flags.length, 1);
});

test('employment dates are groundable, because buildCorpus puts them in the text', () => {
  // They used to live in `meta` only, so every date a cover letter stated was
  // ungrounded by construction.
  const items = corpus();
  assert.ok(
    items.some((item) => item.ref === 'exp.0.title' && item.text.includes('2021-03')),
    'exp.0.title should carry its date range',
  );
  assert.deepEqual(
    validateAgainstCorpus('I have led the payments ledger team at Norwick Labs since 2021-03.', items).flags,
    [],
  );
});

test('an abbreviation does not split one sentence into two fragments', () => {
  // `Co.`, `Inc.`, `Ph.D.` all end in a full stop. Splitting on them produced
  // two orphaned halves, neither of which could be grounded against anything.
  assert.equal(segmentClaims('I worked at Halbrook Systems Inc. and maintained the schemas there.').length, 1);
  assert.equal(segmentClaims('I finished my Ph.D. before joining the payments team.').length, 1);
  // A real sentence boundary must still split.
  assert.equal(segmentClaims('Built the ledger service. Shipped a data pipeline for billing.').length, 2);
});

test('REGRESSION: a faithful cover letter is clean', () => {
  // The headline failure. Every sentence below is true and the only numeral is
  // copied from the CV, yet this scored rate 0.75 with a HIGH flag on the
  // opening line, while an inflated headcount scored 0.
  const letter = [
    'I am writing to apply for the Staff Backend Engineer role at Kestrel Analytics.',
    'Your posting mentions payments infrastructure, which is where I have spent my career.',
    'At Norwick Labs I led a team of 4 engineers rebuilding the payments ledger.',
    'I work in Python, PostgreSQL and Docker every day.',
    'I would welcome the chance to discuss the role with your team.',
  ].join(' ');

  const result = validateAgainstCorpus(letter, corpus());
  assert.deepEqual(result.flags, [], `expected a clean letter, got ${JSON.stringify(result.flags)}`);
  assert.equal(result.rate, 0);
  // Only the two sentences that actually assert something about the candidate
  // are graded; the three addressing sentences must not pad the denominator.
  assert.equal(result.totalClaims, 2);
});

test('REGRESSION: the same letter with one inflated number is not clean', () => {
  const letter = [
    'I am writing to apply for the Staff Backend Engineer role at Kestrel Analytics.',
    'At Norwick Labs I led a team of 40 engineers rebuilding the payments ledger.',
  ].join(' ');

  const result = validateAgainstCorpus(letter, corpus());
  assert.equal(result.flags.length, 1);
  assert.equal(result.flags[0].severity, 'high');
  assert.ok(result.flags[0].ungrounded.includes('#40'));
  assert.equal(result.totalClaims, 1);
  assert.equal(result.rate, 1);
});
