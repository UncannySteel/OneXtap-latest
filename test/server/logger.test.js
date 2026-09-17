/**
 * Redaction-key conventions for the backend logger.
 *
 * `PII_KEY` matches a bare `name`, deliberately: profile labels, cover-letter
 * template names and certificate names are all stored under that key, and rule
 * 8 keeps that data off the server. The cost is a trap — the obvious
 * `log.warn(msg, { name: err.name })` prints "[redacted]" and the diagnostic is
 * silently lost. These tests pin both halves so neither can regress: the PII
 * stays hidden, and the `errName` escape hatch keeps working.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { log } = await import('../../server/logger.js');
const repoFile = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));

/** Capture one log line without letting it reach the real console. */
function capture(fn) {
  const lines = [];
  const originals = { warn: console.warn, error: console.error, info: console.info, log: console.log };
  for (const key of Object.keys(originals)) {
    console[key] = (...args) => lines.push(args.join(' '));
  }
  try {
    fn();
  } finally {
    Object.assign(console, originals);
  }
  return lines.join('\n');
}

test('a bare name key is still redacted — profile labels must not reach logs', () => {
  const output = capture(() => log.warn('probe', { name: 'Azzah Main Profile' }));
  assert.match(output, /\[redacted\]/);
  assert.doesNotMatch(output, /Azzah Main Profile/);
});

test('errName is NOT redacted, so error classes stay debuggable', () => {
  const output = capture(() => log.warn('probe', { errName: 'TypeError', source: 'adzuna' }));
  assert.match(output, /TypeError/);
  assert.match(output, /adzuna/);
});

test('backend call sites use errName, never a bare name, for error classes', () => {
  // A bare `name:` here is not a style preference — it silently blanks the only
  // field that says what went wrong.
  for (const rel of [
    'server/jobs/ingest.js',
    'server/jobs/adapters/cache.js',
    'server/observability/opik.js',
    'server/jobs/rank.js',
    'server/jobs/graph.js',
    'server/jobs/rankCache.js',
    'server/index.js',
  ]) {
    const source = readFileSync(repoFile(rel), 'utf8');
    const offenders = source
      .split('\n')
      // Strip comments before matching. A comment that documents this
      // convention — or warns about this very trap — is not a call site, and
      // flagging it would push people toward deleting the explanation.
      .map((line, index) => ({
        code: line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''),
        number: index + 1,
      }))
      .filter(({ code }) => /Log\.(error|warn|info|debug)\(/.test(code) && /\bname:/.test(code));
    assert.deepEqual(
      offenders.map((o) => `${rel}:${o.number}`),
      [],
      `${rel} logs a bare \`name\` key, which redact() blanks`,
    );
  }
});
