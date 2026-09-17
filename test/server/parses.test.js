/**
 * Every server module must at least parse.
 *
 * This exists because of a real miss: a duplicated `function` declaration left
 * `server/index.js` unable to load at all, and the whole suite still went
 * green — nothing imports `server/index.js`, because importing it calls
 * `app.listen()` and boots a server. So the one file that every route lives in
 * was the one file with no coverage of even its syntax.
 *
 * `node --check` parses a module without executing it, which is exactly the
 * gap: it catches duplicate declarations, unbalanced braces and stray edits
 * without starting a listener or touching the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Every .js file under server/, excluding node_modules. */
function serverModules(dir = path.join(repoRoot, 'server'), found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) serverModules(full, found);
    else if (entry.endsWith('.js')) found.push(full);
  }
  return found;
}

test('every server module parses', async () => {
  const modules = serverModules();
  assert.ok(modules.length >= 8, `expected to find server modules, found ${modules.length}`);

  const failures = [];
  for (const file of modules) {
    try {
      await run(process.execPath, ['--check', file]);
    } catch (error) {
      failures.push(`${path.relative(repoRoot, file)}: ${String(error.stderr || error.message).split('\n')[0]}`);
    }
  }

  assert.deepEqual(failures, [], `server modules failed to parse:\n${failures.join('\n')}`);
});

test('server/index.js declares no function name twice', () => {
  // The specific defect that motivated this file. A duplicate `function` at
  // module scope is a SyntaxError, so `node --check` above already catches it —
  // this names the failure so the next person sees the cause, not just
  // "unexpected identifier" from a 1700-line file.
  const source = readFileSync(path.join(repoRoot, 'server', 'index.js'), 'utf8');

  const names = [...source.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map((m) => m[1]);
  const seen = new Set();
  const duplicates = names.filter((name) => (seen.has(name) ? true : (seen.add(name), false)));

  assert.deepEqual([...new Set(duplicates)], [], 'duplicate top-level function declarations');
});
