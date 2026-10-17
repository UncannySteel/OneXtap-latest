/**
 * build:release step 3: the output scan (completion plan B3-C).
 *
 * A release build must carry no local dev origin, no service-role JWT, and no
 * Groq, Gemini, Dodo or Resend key or variable name. The clean fixture is
 * shaped like the real output, including the localhost strings a real build
 * does carry and may (a bare hostname compared against, and supabase-js's
 * default auth URL); every planted case below must fail. Planted keys are
 * fake and built at run time (fakeKeys.js).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanText, scanDir } from '../../scripts/build-release.mjs';
import { fake, secretNames } from './fakeKeys.js';

const CLEAN = fileURLToPath(new URL('./fixtures/clean-build/', import.meta.url));
const BUNDLE = 'assets/index.html-fixture.js';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'onextap-scan-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

let copies = 0;
/** A fresh copy of the clean fixture to plant something in. */
function cleanCopy() {
  const dir = path.join(tmp, `build-${(copies += 1)}`);
  cpSync(CLEAN, dir, { recursive: true });
  return dir;
}

const rules = (findings) => findings.map((f) => f.rule);

test('the clean fixture passes, and the allowed localhost strings are reported', () => {
  const result = scanDir(CLEAN);
  assert.deepEqual(result.findings, []);
  assert.equal(result.files, 4);
  const allowed = result.allowed.map((a) => a.match);
  assert.ok(allowed.includes('http://localhost:9999'), JSON.stringify(result.allowed));
  assert.ok(allowed.filter((m) => m === 'localhost').length >= 2, JSON.stringify(result.allowed));
  assert.ok(allowed.includes('127.0.0.1'));
});

test('an anon JWT is allowed: the shipped bundle carries one', () => {
  const dir = cleanCopy();
  appendFileSync(path.join(dir, BUNDLE), `\nexport const anon = "${fake.anonJwt}";\n`);
  assert.deepEqual(scanDir(dir).findings, []);
});

test('localhost as a URL or host:port fails, wherever it is', () => {
  for (const planted of [
    'const a="http://localhost:3001";',
    "fetch('http://localhost:3001/api/me')",
    'const b="localhost:5173";',
    'const c=`http://127.0.0.1:3001`;',
    "const d='http://[::1]:3001/api';",
    'const e="https://LOCALHOST/x";',
    'const f="localhost ";',
    '// the local API is on localhost',
  ]) {
    const { findings } = scanText(planted);
    assert.deepEqual(rules(findings), ['localhost'], planted);
  }
});

test('a bare hostname literal is allowed in any quote style', () => {
  for (const planted of ['h==="localhost"', "h==='localhost'", 'h===`localhost`', 'new Set(["127.0.0.1"])', 'h=="[::1]"']) {
    const { findings, allowed } = scanText(planted);
    assert.deepEqual(findings, [], planted);
    assert.equal(allowed.length, 1, planted);
  }
});

test("supabase-js's default auth URL is allowed only as that exact literal", () => {
  assert.deepEqual(scanText('const X="http://localhost:9999";').findings, []);
  assert.deepEqual(rules(scanText('const X="http://localhost:9999/auth/v1";').findings), ['localhost']);
  assert.deepEqual(rules(scanText('const X="http://localhost:99999";').findings), ['localhost']);
});

test('a planted localhost fails the directory scan: bundle, nested file, content script, manifest', () => {
  const plants = [
    [BUNDLE, '\nconst API="http://localhost:3001";\n'],
    ['assets/deep/chunk.js', 'export const x = "http://localhost:5173/dashboard/";\n'],
    ['content.js', '\n// talks to http://localhost:3001 in dev\n'],
  ];
  for (const [file, text] of plants) {
    const dir = cleanCopy();
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    appendFileSync(path.join(dir, file), text);
    const { findings } = scanDir(dir);
    assert.deepEqual(rules(findings), ['localhost'], file);
    assert.equal(findings[0].file, file);
  }

  const dir = cleanCopy();
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('http://localhost:3001/*');
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  assert.deepEqual(rules(scanDir(dir).findings), ['localhost']);
});

test('a service-role JWT fails; so does a Supabase secret key', () => {
  for (const [secret, rule] of [
    [fake.serviceRoleJwt, 'service-role-jwt'],
    [fake.supabaseSecret, 'supabase-secret-key'],
  ]) {
    const dir = cleanCopy();
    appendFileSync(path.join(dir, BUNDLE), `\nexport const k = "${secret}";\n`);
    const { findings } = scanDir(dir);
    assert.deepEqual(rules(findings), [rule]);
    assert.ok(!JSON.stringify(findings).includes(secret), 'the finding never repeats the key');
  }
});

test('Groq, Gemini, Resend and Dodo key shapes fail, without printing the key', () => {
  for (const [secret, rule] of [
    [fake.groq, 'groq-key'],
    [fake.gemini, 'gemini-key'],
    [fake.resend, 'resend-key'],
    [fake.dodoWebhook, 'webhook-secret'],
  ]) {
    const { findings } = scanText(`const k="${secret}";`);
    assert.deepEqual(rules(findings), [rule], rule);
    assert.ok(!JSON.stringify(findings).includes(secret), rule);
  }
});

test('server secret variable names fail, in code or in an HTML page', () => {
  for (const name of secretNames) {
    assert.deepEqual(rules(scanText(`a.${name}`).findings), ['secret-name'], name);
    const dir = cleanCopy();
    appendFileSync(path.join(dir, 'index.html'), `<!-- ${name} -->\n`);
    const { findings } = scanDir(dir);
    assert.deepEqual(rules(findings), ['secret-name'], name);
    assert.equal(findings[0].match, name, 'a name is not a secret, so it is shown');
  }
});

test('the words Groq and Gemini, and other JWTs, are not findings', () => {
  for (const text of [
    'const x="Drafts by Groq, resumes by Gemini";',
    'const GROQ=1, GEMINI=2;',
    `const t="${fake.otherProjectAnonJwt}";`,
    // JWT-shaped, but the payload is "not json".
    'const notJwt="eyJhbGciOi.bm90IGpzb24.x";',
  ]) {
    assert.deepEqual(scanText(text).findings, [], text);
  }
});

test('a key hidden in a binary file is still found', () => {
  const dir = cleanCopy();
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0xff]), Buffer.from(fake.groq)]);
  writeFileSync(path.join(dir, 'icon.png'), png);
  const { findings, files } = scanDir(dir);
  assert.equal(files, 5);
  assert.deepEqual(rules(findings), ['groq-key']);
  assert.equal(findings[0].file, 'icon.png');
});
