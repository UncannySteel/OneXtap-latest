import test from 'node:test';
import assert from 'node:assert/strict';

import { SKILL_LEXICON, ALIASES } from '../../src/matching/lexicon.js';
import { foldToLexicon } from '../../src/matching/extractKeywords.js';
import { buildResumeProfile, prefilterJobs } from '../../src/matching/prefilter.js';

/**
 * The structural guard for the dead-alias bug class.
 *
 * `resolveTerm` consults SKILL_LEXICON before ALIASES — correctly, because a
 * literal vocabulary entry should win over a rewrite. The consequence is that
 * any key present in BOTH maps makes its alias unreachable: the surface form
 * resolves to itself and never folds to the canonical, so a resume saying "GCP"
 * and a JD saying "Google Cloud" land on different terms and score 0.
 *
 * These two assertions are what stops that from coming back. They are cheap and
 * they fire at the moment someone adds the duplicate, not months later when a
 * user reports a zero score they cannot explain.
 */

test('SKILL_LEXICON and ALIASES share zero keys', () => {
  const collisions = [...ALIASES.keys()].filter((key) => SKILL_LEXICON.has(key));
  assert.deepEqual(
    collisions,
    [],
    `these alias keys are shadowed by a lexicon entry and can never fire: ${collisions.join(', ')}`,
  );
});

test('every alias value resolves to a real SKILL_LEXICON key', () => {
  const dangling = [...ALIASES.entries()]
    .filter(([, canonical]) => !SKILL_LEXICON.has(canonical))
    .map(([surface, canonical]) => `${surface} -> ${canonical}`);
  assert.deepEqual(dangling, [], `aliases pointing at a non-existent canonical: ${dangling.join(', ')}`);
});

test('abbreviated cloud and NLP spellings fold to their canonical term', () => {
  const termsOf = (text) => foldToLexicon(text).map((f) => f.term);

  assert.deepEqual(termsOf('GCP'), ['google cloud']);
  assert.deepEqual(termsOf('Google Cloud Platform'), ['google cloud']);
  assert.deepEqual(termsOf('Google Cloud'), ['google cloud']);
  assert.deepEqual(termsOf('NLP'), ['natural language processing']);
  assert.deepEqual(termsOf('Natural Language Processing'), ['natural language processing']);
});

test('a GCP resume prefilters above zero against a Google Cloud posting', () => {
  const profile = buildResumeProfile({ skills: ['GCP', 'NLP'] });
  const job = {
    id: 'j1',
    keywords: [
      { term: 'google cloud', weight: 1, required: true },
      { term: 'natural language processing', weight: 1, required: false },
    ],
  };
  const [ranked] = prefilterJobs(profile, [job]);
  assert.ok(ranked.prefilterScore > 0, `expected a non-zero prefilter, got ${ranked.prefilterScore}`);
  assert.deepEqual(ranked.matchedTerms, ['google cloud', 'natural language processing']);
});

/**
 * Every abbreviation/expansion pair the lexicon knows about must land on ONE
 * canonical term, or a resume and a posting that mean the same thing score
 * zero against each other. The structural guards above catch the shadowing
 * case; this table catches the quieter variant where both spellings are
 * independent lexicon entries and simply never meet.
 */
test('abbreviation and expansion always fold to the same canonical term', () => {
  const termsOf = (text) => foldToLexicon(text).map((f) => f.term);
  const pairs = [
    ['LLM', 'large language models'],
    ['RAG', 'retrieval augmented generation'],
    ['CNN', 'convolutional neural networks'],
    ['SSR', 'server side rendering'],
    ['D3', 'd3.js'],
    ['GCP', 'google cloud'],
    ['NLP', 'natural language processing'],
  ];

  for (const [abbreviation, expansion] of pairs) {
    const short = termsOf(abbreviation);
    const long = termsOf(expansion);
    assert.ok(short.length > 0, `${abbreviation} resolved to nothing`);
    assert.deepEqual(
      short,
      long,
      `${abbreviation} folds to ${short.join(',') || '(none)'} but ${expansion} folds to ${long.join(',') || '(none)'}`,
    );
  }
});
