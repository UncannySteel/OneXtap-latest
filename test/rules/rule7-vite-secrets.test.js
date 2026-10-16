/**
 * CLAUDE.md rule 7: no server secret behind a VITE_* name.
 *
 * Vite inlines every VITE_* value into the shipped bundle, so a secret with
 * that prefix is published with the extension and the website. This scans
 * every tracked code file and both .env.example files for VITE_* names that
 * look like a server credential.
 *
 * Code is read token by token, so comments are skipped: server/groqClient.js
 * and server/observability/opik.js name the forbidden spellings in comments
 * on purpose, as warnings.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// The plan's list plus ADZUNA: every secret server/ reads (ADZUNA_APP_KEY
// included) has one of these in its name.
const SECRETISH = /SERVICE_ROLE|SECRET|GROQ|GEMINI|DODO|OPIK|CRON|RESEND|ADZUNA/;
const VITE_NAME = /\bVITE_[A-Z0-9_]+/g;
const CODE = /\.(js|jsx|mjs|cjs|ts|tsx)$/;

/** Tracked files, plus new ones not added yet (ignored ones stay out). */
function tracked() {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

/**
 * Every VITE_* name in a JS source's tokens (identifiers, strings, template
 * chunks, JSX text): not its comments.
 *
 * @returns {string[] | null} null when the source parses under no option set.
 */
function viteNamesInCode(source, file = '') {
  const jsxFirst = file.endsWith('x');
  const attempts = [];
  for (const jsx of jsxFirst ? [true, false] : [false, true]) {
    for (const sourceType of ['module', 'script']) attempts.push({ jsx, sourceType });
  }
  for (const { jsx, sourceType } of attempts) {
    let tokens;
    try {
      tokens = espree.tokenize(source, { ecmaVersion: 'latest', sourceType, ecmaFeatures: { jsx } });
    } catch {
      continue;
    }
    return tokens.filter((t) => t.type !== 'Punctuator').flatMap((t) => String(t.value).match(VITE_NAME) || []);
  }
  return null;
}

function viteNamesInText(text) {
  return text.match(VITE_NAME) || [];
}

test('the scanner sees names in code and skips comments', () => {
  // Built at runtime so this file's own tokens hold no such name.
  const name = ['VITE', 'GROQ', 'API', 'KEY'].join('_');
  const source = [
    `// ${name} in a line comment`,
    `/* ${name} in a block comment */`,
    `const a = import.meta.env.${name};`,
    `const b = '${name}';`,
    'const c = `${x}' + name + '`;',
  ].join('\n');
  assert.deepEqual(viteNamesInCode(source, 'x.js'), [name, name, name]);
});

test('no VITE_* name in code or .env.example looks like a server secret', () => {
  const offenders = [];
  const unparsed = [];
  let scanned = 0;

  for (const file of tracked()) {
    const base = path.posix.basename(file);
    const isCode = CODE.test(file);
    const isHtml = file.endsWith('.html');
    const isEnvExample = base.startsWith('.env') && base.endsWith('.example');
    if (!isCode && !isHtml && !isEnvExample) continue;

    let text;
    try {
      text = readFileSync(path.join(repoRoot, file), 'utf8');
    } catch {
      continue; // deleted in the working tree
    }
    scanned += 1;

    let names;
    if (isCode) {
      names = viteNamesInCode(text, file);
      if (names === null) {
        unparsed.push(file);
        continue;
      }
    } else if (isHtml) {
      names = viteNamesInText(text.replace(/<!--[\s\S]*?-->/g, ''));
    } else {
      names = viteNamesInText(text);
    }

    for (const name of new Set(names)) {
      if (SECRETISH.test(name)) offenders.push(`${file}: ${name}`);
    }
  }

  assert.ok(scanned >= 100, `expected to scan the repo's code, scanned ${scanned} files`);
  assert.deepEqual(unparsed, [], 'these files could not be tokenized, so were not checked');
  assert.deepEqual(offenders, [], 'a server secret behind VITE_* is inlined into the shipped bundle');
});
