/**
 * docs/repo-structure.md, rule 2: the service worker and the content script
 * keep out of src/. The worker has one exception, the wipe's key names
 * (ONEXTAP_WIPE_LOCAL): it may reach src/localKeys.js and
 * src/supabaseSessionKey.js, two leaves with no load-time behaviour, and
 * nothing else in src/. The content script imports nothing at all.
 *
 * Read from the source, following relative imports from
 * extension/background.js, so a new import anywhere on that path is seen
 * without building anything.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const rel = (url) => url.href.slice(ROOT.href.length);

/** The source without comments, so a specifier quoted in prose is not read as an import. */
function code(url) {
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** Every module specifier a file names: static imports, re-exports, dynamic import(). */
function specifiers(url) {
  const source = code(url);
  const found = [];
  for (const m of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)) found.push(m[1]);
  for (const m of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(m[1]);
  return found;
}

/** A relative specifier as the bundler resolves it: as written, else with '.js'. */
function resolve(specifier, from) {
  const url = new URL(specifier, from);
  if (existsSync(url)) return url;
  const withJs = new URL(`${specifier}.js`, from);
  if (existsSync(withJs)) return withJs;
  throw new Error(`${rel(from)} imports ${specifier}, which does not resolve`);
}

/** Every file reachable from `entry` through relative imports. */
function reachable(entry) {
  const seen = new Map();
  const visit = (url) => {
    if (seen.has(url.href)) return;
    seen.set(url.href, url);
    for (const specifier of specifiers(url)) {
      if (specifier.startsWith('.')) visit(resolve(specifier, url));
    }
  };
  visit(entry);
  return [...seen.values()].map(rel).sort();
}

const LEAVES = ['src/localKeys.js', 'src/supabaseSessionKey.js'];

test('from extension/background.js, the worker reaches into src/ for the two key-name leaves only', () => {
  const files = reachable(new URL('extension/background.js', ROOT));
  assert.ok(files.includes('extension/messages/registry.js'), 'the walk follows the worker\'s imports');
  assert.deepEqual(files.filter((f) => f.startsWith('src/')), LEAVES);
  // And nothing outside the extension's own folder and those two.
  assert.deepEqual(files.filter((f) => !f.startsWith('extension/') && !LEAVES.includes(f)), []);
});

test('the leaves stay leaves: localKeys.js imports only supabaseSessionKey.js, which imports nothing', () => {
  assert.deepEqual(specifiers(new URL('src/localKeys.js', ROOT)), ['./supabaseSessionKey.js']);
  assert.deepEqual(specifiers(new URL('src/supabaseSessionKey.js', ROOT)), []);
});

test('the worker imports no package either: everything it names is a relative path', () => {
  for (const file of reachable(new URL('extension/background.js', ROOT))) {
    for (const specifier of specifiers(new URL(file, ROOT))) {
      assert.ok(specifier.startsWith('.'), `${file} imports ${specifier}`);
    }
  }
});

test('public/content.js imports nothing at all', () => {
  const source = code(new URL('public/content.js', ROOT));
  assert.deepEqual(specifiers(new URL('public/content.js', ROOT)), []);
  assert.doesNotMatch(source, /\bimportScripts\s*\(|\brequire\s*\(/);
});
