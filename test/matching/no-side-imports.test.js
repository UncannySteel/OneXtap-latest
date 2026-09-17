import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The guard that keeps the whole zero-import strategy from rotting the first
 * time someone adds a `log.debug` to the matcher.
 *
 * Suite-wide note: `npm test` points `node --test` at a QUOTED GLOB rather
 * than at the test directory. Handing it the directory (`node --test test/`)
 * fails outright on Node 23, and an unquoted glob is expanded by the shell,
 * which then misses the nested directories.
 *
 * `src/matching/**` and `src/corpus.js` must be importable by the Vite bundle,
 * by bare Node, and by the Express server. `src/config.js` reads
 * `import.meta.env` at module scope (a TypeError in Node) and
 * `src/logger.js` / `src/storage.js` touch `chrome`/`localStorage` at module
 * load, so a single innocuous import from outside would break `npm test` and
 * the server at once.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const matchingDir = path.join(repoRoot, 'src/matching');
const corpusFile = path.join(repoRoot, 'src/corpus.js');

/** `import x from 'spec'`, `export * from 'spec'`, and dynamic `import('spec')`. */
const SPECIFIER_RE = /(?:^|[\s;}])(?:import|export)\s*(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * @param {string} file
 * @returns {string[]} Every module specifier in the file.
 */
function specifiersOf(file) {
  const source = fs.readFileSync(file, 'utf8');
  const found = [];
  SPECIFIER_RE.lastIndex = 0;
  let match = SPECIFIER_RE.exec(source);
  while (match) {
    found.push(match[1] ?? match[2]);
    match = SPECIFIER_RE.exec(source);
  }
  return found;
}

/** @returns {string[]} Absolute paths of every guarded file. */
function guardedFiles() {
  const files = fs
    .readdirSync(matchingDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(matchingDir, name));
  files.push(corpusFile);
  return files;
}

test('the guarded file set is non-empty and includes the barrel', () => {
  const files = guardedFiles();
  assert.ok(files.length >= 8, `expected the matching modules, found ${files.length}`);
  assert.ok(files.some((f) => f.endsWith('index.js')));
  assert.ok(files.some((f) => f.endsWith('corpus.js')));
});

test('no module under src/matching or src/corpus.js imports outside the sandbox', () => {
  for (const file of guardedFiles()) {
    for (const spec of specifiersOf(file)) {
      assert.ok(
        spec.startsWith('./') || spec.startsWith('../matching/'),
        `${path.relative(repoRoot, file)} imports "${spec}" — bare/package/parent specifiers are forbidden`,
      );
      const resolved = path.resolve(path.dirname(file), spec);
      const inMatching = resolved === matchingDir || resolved.startsWith(`${matchingDir}${path.sep}`);
      assert.ok(
        inMatching || resolved === corpusFile,
        `${path.relative(repoRoot, file)} resolves "${spec}" to ${path.relative(repoRoot, resolved)}, outside src/matching/`,
      );
      assert.ok(spec.endsWith('.js'), `${path.relative(repoRoot, file)} imports "${spec}" without a .js extension`);
    }
  }
});

test('the guarded modules import cleanly in bare Node with no side effects', async () => {
  const barrel = await import('../../src/matching/index.js');
  assert.equal(typeof barrel.extractKeywords, 'function');
  assert.equal(barrel.MATCHER_VERSION, 1);
  assert.equal(barrel.SNIPPET_CONFIDENCE, 0.9);
  const corpus = await import('../../src/corpus.js');
  assert.equal(typeof corpus.buildCorpus, 'function');
});

test('the specifier regex actually finds the imports it is guarding', () => {
  // Self-check: a false-negative regex would make this whole file a no-op.
  const specs = specifiersOf(path.join(matchingDir, 'index.js'));
  assert.ok(specs.includes('./normalize.js'));
  assert.ok(specs.includes('./fabrication.js'));
  assert.ok(specs.length >= 6);
  assert.deepEqual(specifiersOf(corpusFile), ['./matching/normalize.js']);
});
