/**
 * The prompt library — structure and versioning.
 *
 * Two things are worth pinning here and neither is about prompt wording.
 *
 * First, the version table has to stay in step with the files on disk in BOTH
 * directions. A prompt with no version silently traces as `undefined` and
 * destroys the attribution the versioning exists for; a version with no prompt
 * is a getPrompt() call that throws at runtime in whatever route first needs
 * it. Both are cheap to catch here and expensive to catch in production.
 *
 * Second, suggest_tailoring must refuse to write replacement prose. That is a
 * product boundary pending sign-off, not a style note, and a prompt file is
 * exactly the kind of artefact that gets "improved" by someone who does not
 * know why the constraint is there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getPrompt, PROMPT_VERSIONS, PROMPTS_DIR } from '../../server/jobs/prompts/index.js';

const NAMES = ['rank', 'reformulate', 'explain', 'suggest_tailoring'];

test('every prompt loads with real text and a numeric version', () => {
  for (const name of NAMES) {
    const prompt = getPrompt(name);
    assert.equal(prompt.name, name);
    assert.equal(typeof prompt.version, 'number');
    assert.ok(Number.isInteger(prompt.version) && prompt.version >= 1, `${name} version is not a positive integer`);
    assert.equal(typeof prompt.text, 'string');
    assert.ok(prompt.text.trim().length > 200, `${name} looks like a placeholder (${prompt.text.length} chars)`);
  }
});

test('repeated loads are memoized and identical', () => {
  const a = getPrompt('rank');
  const b = getPrompt('rank');
  assert.equal(a.text, b.text);
  assert.equal(a.version, b.version);
});

test('an unknown prompt name throws — it can only be a programmer error', () => {
  assert.throws(() => getPrompt('does_not_exist'), /Unknown prompt "does_not_exist"/);
  assert.throws(() => getPrompt(''), /Unknown prompt/);
  assert.throws(() => getPrompt(undefined), /Unknown prompt/);
  // Prototype keys must not resolve as prompts.
  assert.throws(() => getPrompt('toString'), /Unknown prompt/);
  assert.throws(() => getPrompt('constructor'), /Unknown prompt/);
});

test('PROMPT_VERSIONS and the .md files on disk agree in both directions', () => {
  const onDisk = readdirSync(PROMPTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .sort();
  const versioned = Object.keys(PROMPT_VERSIONS).sort();

  assert.deepEqual(
    versioned,
    onDisk,
    'a prompt was added or removed without updating PROMPT_VERSIONS in server/jobs/prompts/index.js',
  );
});

test('PROMPT_VERSIONS is frozen — a version must be a reviewed edit, not a runtime assignment', () => {
  assert.ok(Object.isFrozen(PROMPT_VERSIONS));
});

test('every prompt demands strict JSON back', () => {
  // All four are parsed by the caller. A prompt that invites prose produces an
  // exception in a route rather than a bad answer, which is harder to spot.
  for (const name of NAMES) {
    assert.match(getPrompt(name).text, /strict JSON/i, `${name} does not ask for strict JSON`);
  }
});

test('rank.md instructs conservative scoring on truncated descriptions', () => {
  const { text } = getPrompt('rank');
  assert.match(text, /descriptionQuality/);
  assert.match(text, /snippet/);
  assert.match(text.replace(/\*/g, ''), /conservativ/i);
  // The required per-job output shape.
  for (const field of ['jobId', 'score', 'gapSummary', 'matchedSignals', 'missingSignals']) {
    assert.match(text, new RegExp(field), `rank.md never mentions ${field}`);
  }
  assert.match(text.replace(/\*/g, ''), /one sentence/i);
});

test('suggest_tailoring.md forbids generated replacement text', () => {
  // Asserted against the file itself rather than the loader, so the constraint
  // is pinned to the artefact a future editor will open.
  const text = readFileSync(join(PROMPTS_DIR, 'suggest_tailoring.md'), 'utf8');
  const plain = text.replace(/\*/g, '').replace(/`/g, '').toLowerCase();

  assert.match(plain, /must not generate rewritten prose/);
  assert.match(plain, /do not produce a rewritten version/);
  assert.match(plain, /do not produce a replacement bullet/);
  assert.match(plain, /out of scope/);

  // And the shape it must return instead: a diagnosis, not a draft.
  for (const field of ['corpusRef', 'currentText', 'reason', 'suggestedAngle']) {
    assert.match(text, new RegExp(field), `suggest_tailoring.md never mentions ${field}`);
  }
});

test('explain.md defines every severity value it permits', () => {
  // `severity` is a closed vocabulary a caller will switch on, so the literals
  // are as load-bearing as the field names — and each one has to be defined in
  // the prompt, or the model picks the boundary between them itself.
  const { text } = getPrompt('explain');
  for (const severity of ['blocking', 'significant', 'minor']) {
    assert.match(text, new RegExp(`"${severity}"`), `explain.md never names the "${severity}" severity`);
  }
});

test('reformulate.md and explain.md return their documented shapes', () => {
  const reformulate = getPrompt('reformulate').text;
  for (const field of ['query', 'relaxed', 'rationale']) {
    assert.match(reformulate, new RegExp(field), `reformulate.md never mentions ${field}`);
  }

  const explain = getPrompt('explain').text;
  for (const field of ['fitAnalysis', 'gaps', 'strengths', 'tailoringSuggestions']) {
    assert.match(explain, new RegExp(field), `explain.md never mentions ${field}`);
  }
});
