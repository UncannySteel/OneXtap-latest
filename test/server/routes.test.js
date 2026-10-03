/**
 * Where credits can go up.
 *
 * POST /api/credits/refund handed any signed-in account a credit per call, with
 * nothing to show a charge had happened, from the first commit until it was
 * removed on 2026-10-03: unlimited credits for anyone with a token and a
 * loop. These tests read server/index.js off disk (importing it would boot the
 * server; see parses.test.js) and pin the two halves of the fix: no public
 * route gives credits back, and the one place that adds a credit is the
 * server's own refundOneCredit(), called by the route that charged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// \r\n → \n: a Windows checkout (core.autocrlf) would otherwise hide the
// function's closing line from the search below.
const source = readFileSync(fileURLToPath(new URL('../../server/index.js', import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');

/** Every route the app registers, as "METHOD /path". */
function routes() {
  const found = [];
  const pattern = /\bapp\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
  let match;
  while ((match = pattern.exec(source))) found.push(`${match[1].toUpperCase()} ${match[2]}`);
  return found;
}

test('no public route gives credits back', () => {
  const all = routes();
  assert.ok(all.length >= 15, `expected to find the routes, found ${all.length}`);
  assert.deepEqual(all.filter((r) => /refund/i.test(r)), []);
  assert.ok(!all.includes('POST /api/credits/refund'));
});

test('the only code that adds a credit is refundOneCredit()', () => {
  const start = source.indexOf('async function refundOneCredit(');
  assert.ok(start >= 0, 'refundOneCredit() is where the server gives a credit back');
  const end = source.indexOf('\n}\n', start);
  assert.ok(end > start);

  // `<row>.credits + <anything>`, however it is then written: the removed
  // route computed `const newCredits = profile.credits + 1` first.
  const increments = [...source.matchAll(/\.credits\s*\+\s*[\w(]/g)].map((m) => m.index);
  assert.ok(increments.length >= 1, 'refundOneCredit() itself adds one');
  const outside = increments.filter((at) => at < start || at > end);
  assert.deepEqual(
    outside.map((at) => source.slice(0, at).split('\n').length),
    [],
    'a credit is added outside refundOneCredit() (line numbers above)',
  );
});
