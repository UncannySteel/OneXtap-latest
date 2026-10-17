/**
 * Where credits can go up, and how they go down.
 *
 * POST /api/credits/refund handed any signed-in account a credit per call, with
 * nothing to show a charge had happened, from the first commit until it was
 * removed on 2026-10-03: unlimited credits for anyone with a token and a
 * loop. These tests read every server module off disk (server/index.js is the
 * entry; the routes live in server/routes/ and the credit helpers in
 * server/lib/) and the SQL in supabase/, and pin the two halves of the fix:
 * no public route gives credits back, and the one place that adds a credit is
 * the database's undo_generation(), reached only through the server's own
 * refund helpers, called by the routes that charged.
 *
 * And since migration 007, the other direction: a balance is never read and
 * then written back. Spends and refunds are the database functions' single
 * conditional statements (test/server/generationSpend.test.js holds the SQL
 * to that).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERVER_DIR = fileURLToPath(new URL('../../server/', import.meta.url));
const SUPABASE_DIR = fileURLToPath(new URL('../../supabase/', import.meta.url));

/** Every file under `dir` with this extension, excluding node_modules. */
function filesUnder(dir, ext, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) filesUnder(full, ext, found);
    else if (entry.endsWith(ext)) found.push(full);
  }
  return found;
}

// \r\n → \n: a Windows checkout (core.autocrlf) would otherwise hide a
// function's closing line from the searches below.
const read = (file, base) => ({
  rel: path.relative(base, file).split(path.sep).join('/'),
  text: readFileSync(file, 'utf8').replace(/\r\n/g, '\n'),
});
const files = filesUnder(SERVER_DIR, '.js').map((f) => read(f, SERVER_DIR));
const sqlFiles = filesUnder(SUPABASE_DIR, '.sql').map((f) => read(f, SUPABASE_DIR));

const file = (rel) => {
  const found = files.find((f) => f.rel === rel);
  assert.ok(found, `server/${rel} exists`);
  return found.text;
};

/** All of them, one after another; `where()` maps an offset back to a file. */
const source = files.map((f) => f.text).join('\n');

/** "server/<file>:<line>" for an offset into `source`. */
function where(at) {
  let start = 0;
  for (const { rel, text } of files) {
    if (at < start + text.length) return `server/${rel}:${text.slice(0, at - start).split('\n').length}`;
    start += text.length + 1;
  }
  return `offset ${at}`;
}

/** [start, end) of a top-level function `name` in `text` (it ends at "\n}\n"). */
function functionSpan(text, name) {
  const start = text.search(new RegExp(`(?:^|\\n)(?:export )?(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `function ${name}() exists`);
  const end = text.indexOf('\n}\n', start);
  assert.ok(end > start, `function ${name}() ends`);
  return [start, end + 2];
}

/** Every route the app registers, as "METHOD /path". */
function routes() {
  const found = [];
  const pattern = /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
  let match;
  while ((match = pattern.exec(source))) found.push(`${match[1].toUpperCase()} ${match[2]}`);
  return found;
}

/** Source without its comments, which name these functions freely. */
const withoutComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/** The files (relative to server/) whose code, comments aside, matches `pattern`. */
const filesMatching = (pattern) => files.filter((f) => pattern.test(withoutComments(f.text))).map((f) => f.rel).sort();

test('no public route gives credits back', () => {
  const all = routes();
  assert.ok(all.length >= 15, `expected to find the routes, found ${all.length}`);
  assert.deepEqual(all.filter((r) => /refund/i.test(r)), []);
  assert.ok(!all.includes('POST /api/credits/refund'));
});

test('in the database, only undo_generation() adds a credit', () => {
  let undoBodies = 0;
  for (const { rel, text } of sqlFiles) {
    const sql = text.replace(/--[^\n]*/g, '');
    const increments = [...sql.matchAll(/\bcredits\s*=\s*credits\s*\+/g)].map((m) => m.index);
    // Each copy of undo_generation(): migration 007, and the block at the end of schema.sql.
    const bodies = [];
    for (const m of sql.matchAll(/create or replace function public\.undo_generation\(/g)) {
      const open = sql.indexOf('$$', m.index);
      bodies.push([open, sql.indexOf('$$;', open + 2)]);
    }
    undoBodies += bodies.length;
    const outside = increments.filter((at) => !bodies.some(([a, b]) => at > a && at < b));
    assert.deepEqual(outside, [], `supabase/${rel} adds a credit outside undo_generation()`);
    assert.ok(increments.length <= bodies.length, `supabase/${rel}: one increment per undo_generation()`);
  }
  assert.equal(undoBodies, 2, 'undo_generation() is defined in migration 007 and in schema.sql');
});

test('in server/, only the in-process mirror of the database adds a credit', () => {
  // `<row>.credits + <anything>`, however it is then written: the removed
  // route computed `const newCredits = profile.credits + 1` first.
  const text = file('lib/generationSpend.js');
  const [start, end] = functionSpan(text, 'memorySpendStore');
  const offset = source.indexOf(text);
  const increments = [...source.matchAll(/\.credits\s*(?:\+\s*[\w(]|\+=)|\bcredits\s*:\s*[^,}\n]*\+/g)].map((m) => m.index);
  const outside = increments.filter((at) => at < offset + start || at > offset + end);
  assert.deepEqual(outside.map(where), [], 'a credit is added outside memorySpendStore() (locations above)');
});

test('the refund chain: undo_generation() ← the store ← undoGeneration() ← the routes that charged', () => {
  // The RPC is called in one file, by the Supabase store's undo().
  assert.deepEqual(filesMatching(/['"]undo_generation['"]/), ['lib/generationSpend.js']);
  const spendFile = file('lib/generationSpend.js');
  const [s, e] = functionSpan(spendFile, 'supabaseSpendStore');
  assert.equal(spendFile.indexOf("'undo_generation'") > s && spendFile.indexOf("'undo_generation'") < e, true);

  // The store's undo() is called by undoGeneration() and nothing else.
  const creditsFile = file('lib/credits.js');
  const undoCalls = [...source.matchAll(/\.undo\(/g)].map((m) => where(m.index));
  const [us, ue] = functionSpan(creditsFile, 'undoGeneration');
  const creditsOffset = source.indexOf(creditsFile);
  assert.deepEqual(
    [...source.matchAll(/\.undo\(/g)].filter((m) => m.index < creditsOffset + us || m.index > creditsOffset + ue).map((m) => where(m.index)),
    [],
    `store.undo() is called outside undoGeneration(): ${undoCalls.join(', ')}`,
  );

  // undoGeneration() and refundOneCredit() are called only by the routes that
  // charge, and each of those spends too.
  const callers = filesMatching(/\b(?:undoGeneration|refundOneCredit)\(/).filter((rel) => rel !== 'lib/credits.js');
  assert.deepEqual(callers, ['routes/generate.js', 'routes/jobExplain.js']);
  assert.match(file('routes/generate.js'), /\bspendGeneration\(/);
  assert.match(file('routes/jobExplain.js'), /\bchargeOneCredit\(/);
  // And jobExplain hands each refund the charge it is giving back.
  for (const call of file('routes/jobExplain.js').match(/refundOneCredit\([^;]*\);/g) || []) {
    assert.match(call, /,\s*charge\);$/, `a refund without its charge: ${call}`);
  }
});

test('no balance is read and then written back', () => {
  const writes = [
    ...source.matchAll(/updateProfile\([^)]*\bcredits\b/g),
    ...source.matchAll(/\.update\(\s*\{[^}]*\bcredits\b/g),
    ...source.matchAll(/\bcredits\s*:\s*[\w.]*credits\s*[-+]/g),
  ].map((m) => where(m.index));
  assert.deepEqual(writes, [], 'a balance is written from JS (locations above): spend through spendGeneration()');
  // The one way a credit is spent is the database function, called in one place.
  assert.deepEqual(filesMatching(/['"]spend_generation['"]/), ['lib/generationSpend.js']);
  // And the deduct route no longer spends at all.
  assert.doesNotMatch(file('routes/credits.js'), /spendGeneration|chargeOneCredit|credit_transactions/);
});
