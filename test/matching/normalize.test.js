import test from 'node:test';
import assert from 'node:assert/strict';

import {
  stripHtml,
  normalizeText,
  tokenize,
  ngrams,
  trigramSet,
  jaccard,
} from '../../src/matching/normalize.js';

test('stripHtml removes tags and decodes the fixed entity map', () => {
  assert.equal(stripHtml('<p>a</p><p>b</p>').trim(), 'a  b');
  assert.equal(stripHtml('R&amp;D &lt;team&gt;'), 'R&D <team>');
  assert.equal(stripHtml('&quot;x&quot; &#39;y&#39; &apos;z&apos;'), '"x" \'y\' \'z\'');
  assert.equal(stripHtml('a&nbsp;b'), 'a b');
  assert.equal(stripHtml('a&ndash;b&mdash;c'), 'a-b-c');
  assert.equal(stripHtml('&rsquo;&lsquo;&ldquo;&rdquo;'), '\'\'""');
});

test('stripHtml decodes numeric entities, decimal and hex', () => {
  assert.equal(stripHtml('&#65;&#x42;'), 'AB');
  // Unknown names are left alone rather than dropped.
  assert.equal(stripHtml('&notanentity;'), '&notanentity;');
});

test('normalizeText is total and lowercases, de-accents, collapses whitespace', () => {
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(undefined), '');
  assert.equal(normalizeText(42), '');
  assert.equal(normalizeText({}), '');
  assert.equal(normalizeText('  Café   Déjà \n Vu '), 'cafe deja vu');
  assert.equal(normalizeText('<b>Hello</b>   World'), 'hello world');
});

test('tokenize keeps c++, c#, node.js and ci-cd intact', () => {
  assert.deepEqual(tokenize('C++ and C# with Node.js plus ci-cd'), [
    'c++', 'and', 'c#', 'with', 'node.js', 'plus', 'ci-cd',
  ]);
});

test('tokenize treats / as a separator so ci/cd becomes two tokens', () => {
  assert.deepEqual(tokenize('ci/cd'), ['ci', 'cd']);
});

test('tokenize drops purely numeric tokens and bare single characters', () => {
  assert.deepEqual(tokenize('5+ years in 2024 with x and R and C'), [
    'years', 'in', 'with', 'and', 'r', 'and', 'c',
  ]);
});

test('tokenize trims sentence-final punctuation but not internal dots', () => {
  assert.deepEqual(tokenize('We use React. Also node.js.'), ['we', 'use', 'react', 'also', 'node.js']);
});

test('tokenize strips a trailing + only when something usable remains', () => {
  assert.deepEqual(tokenize('Python+'), ['python']);
  assert.deepEqual(tokenize('C++'), ['c++']);
});

test('ngrams reports inclusive token indices', () => {
  const tokens = ['a', 'b', 'c'];
  assert.deepEqual(ngrams(tokens, 2), [
    { text: 'a b', start: 0, end: 1 },
    { text: 'b c', start: 1, end: 2 },
  ]);
  assert.deepEqual(ngrams(tokens, 4), []);
  assert.deepEqual(ngrams(null, 2), []);
  assert.deepEqual(ngrams(tokens, 0), []);
});

test('trigramSet and jaccard behave on empty input', () => {
  assert.equal(trigramSet('ab').size, 0);
  assert.deepEqual([...trigramSet('abcd')], ['abc', 'bcd']);
  assert.equal(jaccard(new Set(), new Set()), 0);
  assert.equal(jaccard(null, undefined), 0);
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['b', 'c'])), 1 / 3);
  assert.equal(jaccard(new Set(['a']), new Set(['a'])), 1);
});
