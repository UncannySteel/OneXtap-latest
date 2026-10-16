/**
 * Completion plan item 31: a resume is parsed through the API on every
 * surface, never through the extension. Store 1.0.2's worker drops the
 * transcription (`text`) from its PARSE_RESUME reply, so every upload routed
 * through it lost it. The worker still answers PARSE_RESUME for websites
 * already deployed (workerCompat.test.js); nothing in src/ or web/ sends it.
 *
 * src/resumeParse.js is loaded through viteModules.js, with src/auth.js
 * replaced by test/extension/stubs/auth.js so there is a token without a
 * Supabase client.
 */
import test, { before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canLoadViteModules, registerViteModules, stubModule, TEST_ENV } from './viteModules.js';

const skip = canLoadViteModules ? false : 'needs module.registerHooks (Node 22.15+)';
const API = TEST_ENV.VITE_API_URL;
const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

let parseResumeFile;
let fetches;
let parseReply;

before(async () => {
  if (skip) return;
  registerViteModules();
  stubModule('src/auth.js', 'test/extension/stubs/auth.js');
  ({ parseResumeFile } = await import('../../src/resumeParse.js'));
  // Node has File but no FileReader; the module reads the file as a data URL.
  globalThis.FileReader = class {
    readAsDataURL(file) {
      file.arrayBuffer().then((buffer) => {
        this.result = `data:${file.type};base64,${Buffer.from(buffer).toString('base64')}`;
        this.onload();
      }, (error) => this.onerror(error));
    }
  };
});

beforeEach(() => {
  globalThis.__ONEXTAP_TEST_TOKEN__ = 'jwt-test';
  fetches = [];
  parseReply = () => Response.json({ data: { firstName: 'Ada' }, text: 'Ada Lovelace, engineer' });
  mock.method(globalThis, 'fetch', async (url, init) => {
    fetches.push({ url: String(url), init });
    if (String(url).endsWith('/api/me')) return Response.json({ id: 'u1' });
    return parseReply();
  });
});

afterEach(() => {
  mock.restoreAll();
  delete globalThis.chrome;
  delete globalThis.window;
});

const pdf = () => new File(['%PDF-1.4 test'], 'cv.pdf', { type: 'application/pdf' });

/** A chrome.runtime that records anything sent through it. */
function installChrome({ runtimeId } = {}) {
  const sent = [];
  globalThis.chrome = {
    runtime: {
      ...(runtimeId ? { id: runtimeId } : {}),
      sendMessage: (...args) => { sent.push(args); },
    },
  };
  return sent;
}

const surfaces = [
  ['the website without the extension', () => null],
  ['the website with the extension installed', () => installChrome()],
  ['the popup', () => installChrome({ runtimeId: EXTENSION_ID })],
];

for (const [label, setUp] of surfaces) {
  test(`${label}: parsed through the API, and the transcription kept`, { skip }, async () => {
    const sent = setUp();
    const result = await parseResumeFile(pdf());

    assert.equal(result.ok, true, result.error?.message);
    assert.deepEqual(result.parsed, { firstName: 'Ada' });
    assert.equal(result.cvText, 'Ada Lovelace, engineer');
    assert.equal(result.fileName, 'cv.pdf');
    assert.match(result.sourceHash, /^[0-9a-f]{64}$/);

    if (sent) assert.deepEqual(sent, [], 'nothing goes to the extension');
    assert.deepEqual(fetches.map((f) => f.url), [`${API}/api/me`, `${API}/api/parse-resume`]);
    const { init } = fetches[1];
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer jwt-test');
    assert.deepEqual(JSON.parse(init.body), {
      fileData: Buffer.from('%PDF-1.4 test').toString('base64'),
      fileName: 'cv.pdf',
      fileType: 'application/pdf',
    });
  });
}

test('a server reply without `text` still parses, with an empty transcription', { skip }, async () => {
  parseReply = () => Response.json({ data: { firstName: 'Ada' } });
  const result = await parseResumeFile(pdf());
  assert.equal(result.ok, true);
  assert.equal(result.cvText, '');
});

test('a refusal from the server is a parse-failed result, in its words', { skip }, async () => {
  mock.method(console, 'error', () => {});
  parseReply = () => Response.json({ error: 'Could not read that file.' }, { status: 422 });
  const result = await parseResumeFile(pdf());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'parse-failed');
  assert.equal(result.error.message, 'Could not read that file. [debug: {"status":422}]');
});

test('signed out: no request at all', { skip }, async () => {
  globalThis.__ONEXTAP_TEST_TOKEN__ = null;
  const result = await parseResumeFile(pdf());
  assert.equal(result.error.code, 'not-authenticated');
  assert.deepEqual(fetches, []);
});

// ---------- Nothing sends PARSE_RESUME any more ----------

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'tests' || name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(js|jsx|mjs)$/.test(name) ? [full] : [];
  });
}

// Sending it takes the name as a string; comments name it bare.
test('no code in src/ or web/ sends PARSE_RESUME', () => {
  const offenders = [...sourceFiles(path.join(repoRoot, 'src')), ...sourceFiles(path.join(repoRoot, 'web'))]
    .filter((file) => /['"`]PARSE_RESUME/.test(readFileSync(file, 'utf8')))
    .map((file) => path.relative(repoRoot, file));
  assert.deepEqual(offenders, []);
});
