import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCorpus, indexCorpus } from '../../src/corpus.js';
import { CV, CV_TEXT } from '../fixtures/jobs.js';

test('buildCorpus is total', () => {
  for (const input of [null, undefined, 42, {}, { experience: 'nope', skills: 5 }]) {
    assert.deepEqual(buildCorpus(input), []);
  }
  assert.doesNotThrow(() => buildCorpus(CV, 12345));
});

test('buildCorpus produces the documented ref scheme', () => {
  const refs = buildCorpus(CV).map((item) => item.ref);
  assert.ok(refs.includes('summary'));
  assert.ok(refs.includes('exp.0.title'));
  assert.ok(refs.includes('exp.0.bullet.0'));
  assert.ok(refs.includes('exp.0.bullet.2'));
  assert.ok(refs.includes('exp.1.bullet.0'));
  assert.ok(refs.includes('edu.0'));
  assert.ok(refs.includes('cert.0'));
  assert.ok(refs.includes('skill.python'));
  assert.ok(refs.includes('skill.rest-apis'));
});

test('every item carries a kind from the documented union', () => {
  const kinds = new Set(['bullet', 'skill', 'title', 'education', 'certification', 'summary']);
  for (const item of buildCorpus(CV)) {
    assert.ok(kinds.has(item.kind), `unexpected kind ${item.kind}`);
    assert.equal(typeof item.text, 'string');
    assert.ok(item.text.length > 0);
    assert.equal(typeof item.meta, 'object');
  }
});

test('bullets are split off the experience description', () => {
  const bullets = buildCorpus(CV).filter((item) => item.ref.startsWith('exp.0.bullet.'));
  assert.equal(bullets.length, 3);
  assert.equal(bullets[0].text, 'Led a team of 4 engineers rebuilding the payments ledger.');
  assert.ok(bullets.every((item) => item.meta.company === 'Norwick Labs'));
});

test('sourceSpan is located in cvText when present, null otherwise', () => {
  const withText = buildCorpus(CV, CV_TEXT);
  const bullet = withText.find((item) => item.ref === 'exp.0.bullet.0');
  assert.ok(Array.isArray(bullet.sourceSpan));
  assert.equal(CV_TEXT.slice(bullet.sourceSpan[0], bullet.sourceSpan[1]), bullet.text);

  // A reassembled field does not appear verbatim in the raw text.
  const education = withText.find((item) => item.ref === 'edu.0');
  assert.equal(education.sourceSpan, null);

  for (const item of buildCorpus(CV)) assert.equal(item.sourceSpan, null);
});

test('refs are stable across re-parses of the same resume', () => {
  const first = buildCorpus(CV, CV_TEXT);
  const second = buildCorpus(JSON.parse(JSON.stringify(CV)), CV_TEXT);
  assert.deepEqual(first, second);
});

test('skill refs are content-derived, so reordering skills does not move them', () => {
  const original = buildCorpus(CV);
  const reordered = buildCorpus({ ...CV, skills: [...CV.skills].reverse() });
  const refOf = (items, text) => items.find((item) => item.text === text).ref;
  for (const skill of CV.skills) {
    assert.equal(refOf(original, skill), refOf(reordered, skill));
  }
  // Deleting one skill leaves the others' refs untouched.
  const pruned = buildCorpus({ ...CV, skills: CV.skills.slice(1) });
  assert.equal(refOf(pruned, 'PostgreSQL'), 'skill.postgresql');
});

test('indexCorpus gives O(1) ref lookup and tolerates junk', () => {
  const index = indexCorpus(buildCorpus(CV));
  assert.equal(index.get('skill.docker').kind, 'skill');
  assert.equal(indexCorpus(null).size, 0);
  assert.equal(indexCorpus([null, 'x', { ref: 'a' }]).size, 1);
});

test('leading list markers are stripped repeatedly, not one kind per bullet', () => {
  // A single non-global `replace` with an alternating pattern removes only the
  // first alternative that matches, so "- 1. Led ..." kept its "1.". That stray
  // numeral then reaches the fabrication validator's numeral gate as an
  // ungrounded number and raises a false `high`-severity flag.
  const corpus = buildCorpus({
    experience: [{
      company: 'Acme',
      title: 'Engineer',
      description: [
        '- 1. Led the payments rewrite',
        '* Built the billing service',
        '1) Shipped the new checkout flow',
        '— Owned the ingestion pipeline',
        '2. - Reduced p99 latency by half',
        'Drove adoption across three teams',
      ].join('\n'),
    }],
  });

  assert.deepEqual(
    corpus.filter((item) => item.kind === 'bullet').map((item) => item.text),
    [
      'Led the payments rewrite',
      'Built the billing service',
      'Shipped the new checkout flow',
      'Owned the ingestion pipeline',
      'Reduced p99 latency by half',
      'Drove adoption across three teams',
    ],
  );
});

test('a truncated skill ref never ends in a dash', () => {
  // The 60-char cap lands exactly on a word boundary here, so slicing after the
  // trim leaves the separator dangling on a persisted ref.
  const skill = 'Real Time Data Streaming and Distributed Systems Design for Large Scale Platforms';
  const [item] = buildCorpus({ skills: [skill] });
  assert.equal(item.kind, 'skill');
  assert.ok(item.ref.startsWith('skill.'));
  const slug = item.ref.slice('skill.'.length);
  assert.ok(slug.length <= 60, `slug exceeded the cap: ${slug.length}`);
  assert.ok(!slug.endsWith('-'), `ref ends in a dash: ${item.ref}`);
  assert.equal(item.meta.slug, slug);
});
