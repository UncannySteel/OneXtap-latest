/**
 * Versioned technology names: "HTML" and "HTML5", "CSS" and "CSS3", "Vue" and
 * "Vue3" are one skill to a recruiter and must be one term to the matcher.
 *
 * HANDOVER §7 item 32: Job Matches listed "HTML · required" as not evidenced
 * beside a matched "HTML5". The plain spellings already met through ALIASES;
 * the ways they still did not meet are pinned here:
 *
 *   - a fused version the alias list never named (`vue3`, `php8`, `angular2+`)
 *     or a hyphenated / dotted one (`html-5`, `css3.0`), which fell through to
 *     a free-text term no posting carries;
 *   - a stored job term that predates the fold (`normalizeJobKeywords` reads
 *     rows as they were ingested);
 *   - the fabrication check, which grounded a written "HTML" only against the
 *     bare spelling, so a resume saying "HTML5" did not back it.
 *
 * And the other half, which matters as much: the rule is an explicit list of
 * names, not "strip the digits". S3, EC2, Web3, ES6, D3, K8s and C++ are not
 * versions of anything, and Python 2 and Python 3 keep folding exactly as
 * they did before.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  foldToLexicon,
  extractKeywords,
  buildResumeProfile,
  missingKeywords,
  keywordCoverage,
  prefilterJobs,
  normalizeJobKeywords,
  validateAgainstCorpus,
  SKILL_LEXICON,
  ALIASES,
} from '../../src/matching/index.js';
import { foldVersionedName, VERSIONED_NAMES } from '../../src/matching/lexicon.js';

const termsOf = (text) => foldToLexicon(text).map((f) => f.term);

// ------------------------------------------------------------------
// The rule itself
// ------------------------------------------------------------------
test('every versioned name is a real lexicon term and never an alias key', () => {
  for (const name of VERSIONED_NAMES) {
    assert.ok(SKILL_LEXICON.has(name), `${name} must be a lexicon term, or folding to it reaches nothing`);
    assert.ok(!ALIASES.has(name), `${name} must not be an alias key`);
  }
});

test('a version on a listed name folds to the name', () => {
  const cases = [
    ['html5', 'html'], ['html4', 'html'], ['html-5', 'html'], ['html5.0', 'html'],
    ['css3', 'css'], ['css2', 'css'], ['css-3', 'css'], ['css3.0', 'css'],
    ['vue2', 'vue'], ['vue3', 'vue'],
    ['angular2', 'angular'], ['angular17', 'angular'],
    ['php7', 'php'], ['php8', 'php'], ['php8.2', 'php'],
    ['bootstrap5', 'bootstrap'], ['webpack5', 'webpack'],
    ['java8', 'java'], ['java17', 'java'],
    ['swift5', 'swift'], ['oauth2', 'oauth'],
  ];
  for (const [token, expected] of cases) {
    assert.equal(foldVersionedName(token), expected, `${token} should fold to ${expected}`);
  }
});

test('tokens that are not a listed name plus a version are left exactly alone', () => {
  const untouched = [
    // Not versions of anything: the digit is part of the name.
    's3', 'ec2', 'web3', 'es6', 'd3', 'k8s', 'k8', 'b2b', 'p5', 'r2', 'c4', 'mp3', 'x86', 'gpt4',
    // A listed name with no version, or a different word that starts with one.
    'html', 'css', 'java', 'javascript', 'javascript5', 'xhtml5', 'angularjs', 'vuex', 'swiftui', 'phpunit',
    // Single-letter languages are never versioned here: C4, R2 and C11 are other things.
    'c11', 'c99', 'r4', 'go1',
    // Python is deliberately not in the list (see the Python test below).
    'python2', 'python3',
    // Not a version: too many digits, or a year.
    'html500', 'css2024', 'java2024',
    // Language symbols survive whole.
    'c++', 'c#', 'f#',
  ];
  for (const token of untouched) {
    assert.equal(foldVersionedName(token), token, `${token} must not be rewritten`);
  }
  for (const junk of [undefined, null, 5, '', {}]) {
    assert.equal(foldVersionedName(junk), junk);
  }
});

// ------------------------------------------------------------------
// The resume side and the posting side meet
// ------------------------------------------------------------------
test('a versioned spelling on a resume folds to the term a posting uses', () => {
  const pairs = [
    ['HTML5', 'HTML'], ['HTML 5', 'HTML'], ['HTML-5', 'HTML'], ['HTML5.0', 'HTML'],
    ['CSS3', 'CSS'], ['CSS-3', 'CSS'],
    ['Vue3', 'Vue'], ['Vue 3', 'Vue'],
    ['Angular2+', 'Angular'], ['Angular 17', 'Angular'],
    ['PHP8', 'PHP'], ['Bootstrap5', 'Bootstrap'], ['Webpack5', 'Webpack'],
    ['Java8', 'Java'], ['Swift5', 'Swift'], ['OAuth2', 'OAuth'], ['OAuth 2.0', 'OAuth'],
    ['Tailwind CSS3', 'Tailwind CSS'],
  ];
  for (const [versioned, plain] of pairs) {
    const a = termsOf(versioned);
    const b = termsOf(plain);
    assert.ok(a.length > 0, `${versioned} resolved to nothing`);
    assert.deepEqual(a, b, `${versioned} folds to ${a.join(',')} but ${plain} folds to ${b.join(',')}`);
  }
});

test('versioned names inside a skills line split and fold like any other', () => {
  assert.deepEqual(termsOf('HTML5/CSS3/JavaScript'), ['html', 'css', 'javascript']);
  assert.deepEqual(termsOf('HTML5, CSS3 & Vue3'), ['html', 'css', 'vue']);
  assert.deepEqual(termsOf('PHP 8.2'), ['php']);
});

test('names that only look versioned keep the meaning they had', () => {
  assert.deepEqual(termsOf('S3'), ['s3']);
  assert.deepEqual(termsOf('EC2'), ['ec2']);
  assert.deepEqual(termsOf('ES6'), ['javascript'], 'ES6 is JavaScript, through its alias');
  assert.deepEqual(termsOf('D3'), ['d3.js']);
  assert.deepEqual(termsOf('K8s'), ['kubernetes']);
  assert.deepEqual(termsOf('C++'), ['c++']);
  assert.deepEqual(termsOf('C++17'), ['c++']);
  assert.deepEqual(termsOf('C#'), ['c#']);
  assert.deepEqual(termsOf('Web3'), ['web3'], 'Web3 is not the web, version 3');
  assert.deepEqual(termsOf('AngularJS'), ['angularjs'], 'AngularJS (1.x) stays apart from Angular');
  assert.deepEqual(termsOf('Java'), ['java']);
  assert.deepEqual(termsOf('JavaScript'), ['javascript'], 'Java and JavaScript never meet');
});

test('Python 2 and Python 3 fold exactly as they did before', () => {
  assert.deepEqual(termsOf('Python 2'), ['python']);
  assert.deepEqual(termsOf('Python 3'), ['python']);
  assert.deepEqual(termsOf('Python3'), ['python'], 'through its existing alias');
  assert.deepEqual(termsOf('Python2'), ['python2'], 'not in the versioned list, so unchanged');
});

test('a posting that writes HTML5 extracts the same term as one that writes HTML', () => {
  const html = extractKeywords('Requirements:\n- Semantic HTML and CSS\n- Vue');
  const html5 = extractKeywords('Requirements:\n- Semantic HTML5 and CSS3\n- Vue3');
  const terms = (out) => out.keywords.filter((k) => k.term !== 'semantic').map((k) => [k.term, k.required]).sort();
  assert.deepEqual(terms(html5), terms(html));
  assert.ok(terms(html).some(([term, required]) => term === 'html' && required));
});

// ------------------------------------------------------------------
// The Job Matches chips: the bug as it was seen
// ------------------------------------------------------------------
test('an HTML5 resume is not told it is missing a required HTML', () => {
  const profile = buildResumeProfile({ skills: ['HTML5', 'CSS3', 'Vue3', 'JavaScript'] });
  const job = {
    title: 'Frontend Developer',
    keywords: [
      { t: 'html', w: 1, r: true },
      { t: 'css', w: 1, r: true },
      { t: 'vue', w: 1, r: false },
      { t: 'typescript', w: 1, r: false },
    ],
    description_quality: 'full',
  };

  const missing = missingKeywords(profile, job).map((m) => m.term);
  assert.deepEqual(missing, ['typescript'], 'only the skill the resume truly lacks is listed');
  assert.deepEqual(keywordCoverage(profile, job), { met: 3, total: 4 });
});

test('a stored job term ingested before the fold still meets the resume', () => {
  // Rows keep the terms they were ingested with until they leave the pool, so
  // `vue3` from an unrecognised tag yesterday must match `vue` today.
  const normalized = normalizeJobKeywords({
    keywords: [{ t: 'vue3', w: 1.2, r: false }, { t: 'html-5', w: 1, r: true }, { t: 'html', w: 1, r: false }],
  });
  assert.deepEqual(
    normalized.map((k) => [k.term, k.weight, k.required]),
    [['vue', 1.2, false], ['html', 1, true]],
    'folded, and the two spellings of html merged into one required term',
  );

  const profile = buildResumeProfile({ skills: ['Vue', 'HTML'] });
  const [ranked] = prefilterJobs(profile, [{ id: 'j1', keyword_terms: ['vue3', 'html5'] }]);
  assert.deepEqual(ranked.matchedTerms, ['html', 'vue']);
});

test('stored terms that are not versioned names are read exactly as before', () => {
  const normalized = normalizeJobKeywords({
    keyword_terms: ['s3', 'ec2', 'web3', 'python2', 'c++', 'tailwind css3', 'java'],
  });
  assert.deepEqual(normalized.map((k) => k.term), ['s3', 'ec2', 'web3', 'python2', 'c++', 'tailwind css', 'java']);
});

// ------------------------------------------------------------------
// The fabrication check
// ------------------------------------------------------------------
test('a written "HTML" is backed by a resume that says "HTML5"', () => {
  const corpus = [{ ref: 'skills', text: 'HTML5, CSS3 and Vue3' }];
  const { flags } = validateAgainstCorpus('I built the storefront in HTML, CSS and Vue for every release.', corpus);
  assert.deepEqual(flags, [], 'the same skill, spelled with its version, is not a fabrication');
});

test('a versioned tool the resume never mentions is still flagged', () => {
  // The fold must not make the check blind: "Angular2" is Angular, and a
  // resume without Angular does not back it.
  const corpus = [{ ref: 'skills', text: 'HTML5 and CSS3' }];
  const { flags } = validateAgainstCorpus('I built the storefront in Angular2 for every release.', corpus);
  assert.equal(flags.length, 1);
  assert.ok(flags[0].ungrounded.includes('$angular'));
});
