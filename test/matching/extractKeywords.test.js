import test from 'node:test';
import assert from 'node:assert/strict';

import { extractKeywords, foldToLexicon } from '../../src/matching/extractKeywords.js';
import { FULL_JD, HTML_JD, SNIPPET_JD, TAGGED_JD } from '../fixtures/jobs.js';

/** @param {{keywords: Array<{term: string}>}} result */
const byTerm = (result) => new Map(result.keywords.map((k) => [k.term, k]));

test('extractKeywords is total', () => {
  for (const input of [null, undefined, 42, {}, '']) {
    const result = extractKeywords(input);
    assert.deepEqual(result.keywords, []);
    assert.deepEqual(result.requirements, []);
    assert.ok(Array.isArray(result.titles));
  }
  assert.doesNotThrow(() => extractKeywords('React', null));
});

test('js alias-folds to javascript but never matches inside jsx', () => {
  assert.ok(foldToLexicon('js').some((t) => t.term === 'javascript'));
  const jsx = foldToLexicon('jsx');
  assert.ok(!jsx.some((t) => t.term === 'javascript'));
  const json = foldToLexicon('json');
  assert.ok(!json.some((t) => t.term === 'javascript'));
  assert.ok(json.some((t) => t.term === 'json'));
});

test('longest n-gram wins and consumes its tokens', () => {
  const terms = byTerm(extractKeywords('We are hiring a machine learning engineer.'));
  assert.ok(terms.has('machine learning'));
  assert.ok(!terms.has('learning'));
  assert.ok(!terms.has('machine'));
});

test('heading state machine marks required terms and persists across segments', () => {
  const terms = byTerm(extractKeywords(FULL_JD, { title: 'Senior Backend Engineer' }));

  // Directly under "Requirements:" with an explicit cue.
  assert.equal(terms.get('python').required, true);
  assert.equal(terms.get('postgresql').required, true);
  // Two segments further down, with NO cue of its own: proves mode persists.
  assert.equal(terms.get('docker').required, true);
  assert.equal(terms.get('kubernetes').required, true);
  assert.equal(terms.get('system design').required, true);

  // Under "Nice to have:".
  assert.equal(terms.get('kafka').required, false);
  assert.equal(terms.get('terraform').required, false);
  assert.equal(terms.get('react').required, false);
});

test('requirements are collected, capped and truncated', () => {
  const { requirements } = extractKeywords(FULL_JD);
  assert.ok(requirements.length >= 3, `expected >=3 requirements, got ${requirements.length}`);
  assert.ok(requirements.length <= 8);
  for (const line of requirements) assert.ok(line.length <= 160);
  assert.ok(requirements.some((line) => line.includes('Python')));
  // The bare "Requirements:" label is not itself a requirement.
  assert.ok(!requirements.some((line) => line.trim() === 'Requirements:'));
});

test('free-text fallback terms are half weight and never required', () => {
  const { keywords } = extractKeywords(FULL_JD);
  for (const keyword of keywords) {
    if (keyword.weight === 0.5) assert.equal(keyword.required, false, `${keyword.term} was required`);
  }
});

test('HTML postings: tags stripped, entities decoded, headers still detected', () => {
  const terms = byTerm(extractKeywords(HTML_JD));
  for (const expected of ['javascript', 'typescript', 'node.js', 'c++', 'c#']) {
    assert.ok(terms.has(expected), `missing ${expected}`);
  }
  assert.equal(terms.get('javascript').required, true);
  assert.equal(terms.get('c++').required, true);
  // The <h2>Nice to have</h2> header flips the mode back off.
  assert.equal(terms.get('react').required, false);
  assert.equal(terms.get('vue').required, false);
});

test('snippet mode marks nothing required and boosts title terms by 1.6', () => {
  const result = extractKeywords(SNIPPET_JD.description, {
    title: SNIPPET_JD.title,
    quality: 'snippet',
  });
  assert.ok(result.keywords.length > 0);
  for (const keyword of result.keywords) {
    assert.equal(keyword.required, false, `${keyword.term} was required in snippet mode`);
  }
  assert.deepEqual(result.requirements, []);

  const terms = byTerm(result);
  // "machine learning" only appears in the title; ml category weight 1.1 * 1.6.
  assert.equal(terms.get('machine learning').weight, 1.76);
  // A description-only term keeps its plain lexicon weight.
  assert.equal(terms.get('python').weight, 1);
});

test('a required cue in a snippet still marks nothing required', () => {
  const result = extractKeywords('Requirements: must have Python and Docker.', { quality: 'snippet' });
  for (const keyword of result.keywords) assert.equal(keyword.required, false);
});

test('curated tags land at weight 1.2 and merge by canonical term', () => {
  const terms = byTerm(extractKeywords(TAGGED_JD.description, {
    title: TAGGED_JD.title,
    tags: TAGGED_JD.tags,
  }));
  assert.equal(terms.get('typescript').weight, 1.2);
  assert.equal(terms.get('typescript').required, false);
  assert.equal(terms.get('tailwind css').weight, 1.2);
  // React is in the description as a requirement AND a tag: weight takes the
  // tag's max, required stays true from the description.
  assert.equal(terms.get('react').weight, 1.2);
  assert.equal(terms.get('react').required, true);
});

test('output is capped at 25 and deterministically ordered', () => {
  const a = extractKeywords(FULL_JD, { title: 'Senior Backend Engineer' });
  const b = extractKeywords(FULL_JD, { title: 'Senior Backend Engineer' });
  assert.ok(a.keywords.length <= 25);
  assert.deepEqual(a, b);
});

test('titles pick up title tokens and the normalized opts.title', () => {
  const { titles } = extractKeywords(FULL_JD, { title: 'Senior Backend Engineer' });
  assert.ok(titles.includes('senior backend engineer'));
  assert.ok(titles.includes('engineer'));
});

test('unrecognised curated tags pass the same noise filter as free text', () => {
  // Remotive ships exactly this shape: a few genuine skills mixed with
  // employment-type and seniority boilerplate. The boilerplate must not reach
  // the output at TAG_WEIGHT, where it would sort above every real skill and
  // pad the prefilter denominator with terms no resume can match.
  const tags = ['Python', 'Kubernetes', 'Remote', 'Full Time', 'Senior', 'Anywhere'];
  const result = extractKeywords('We are growing the platform group.', { tags });
  const terms = byTerm(result);

  for (const noise of ['remote', 'full time', 'senior', 'full', 'time']) {
    assert.ok(!terms.has(noise), `boilerplate tag "${noise}" leaked into the keywords`);
  }
  // A lexicon-recognised tag keeps its curated trust boost.
  assert.equal(terms.get('python').weight, 1.2);
  assert.equal(terms.get('kubernetes').weight, 1.2);
  // An unknown tag that is NOT noise is still kept verbatim at tag weight.
  assert.equal(terms.get('anywhere').weight, 1.2);
});

test('a seniority-only tag is dropped even though it is not a stopword', () => {
  for (const word of ['Senior', 'Junior', 'Lead', 'Principal', 'Staff', 'Intern', 'VP']) {
    const terms = byTerm(extractKeywords('Platform group.', { tags: [word] }));
    assert.ok(!terms.has(word.toLowerCase()), `seniority tag "${word}" leaked into the keywords`);
  }
});

test('shift times and money never become skills', () => {
  // A live Remotive row stored `00am`, `00pm` and the bigram `00am 00pm` among
  // its skills. They are frequent, so they rank high, and no resume can ever
  // match them — each one displaced a real requirement from the capped output.
  const { keywords } = extractKeywords(
    'Shift runs 8:00am to 5:00pm. Pays $40000 annually. Requires Python and Docker.',
    { source: 'remotive', title: 'Engineer' }
  );
  const terms = keywords.map((k) => k.term);
  for (const junk of ['00am', '00pm', '00am 00pm', '40000', '00']) {
    assert.ok(!terms.includes(junk), `emitted numeric fragment "${junk}"`);
  }
  // ...and the real skills in the same sentence still come through.
  assert.ok(terms.includes('python'), `python missing from ${terms.join(', ')}`);
});
