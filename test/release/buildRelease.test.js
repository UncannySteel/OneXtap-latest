/**
 * `npm run build:release` (completion plan B3-C): the environment check
 * (step 1), the order of the five steps and where each refuses, and the zip.
 *
 * Nothing here reads the repo's .env or runs a real build: the environment
 * comes from fixtures (the repo's .env.example stands in for today's dev
 * .env), and the build step is replaced by one that copies a fixture output.
 * The real build is the lead's to run.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { checkReleaseEnv, readReleaseEnv, runRelease, releaseZipPath, zipDir, tarPath, tarSupportsZip } from '../../scripts/build-release.mjs';
import { RELEASE_OUT_DIR } from '../../scripts/releaseManifest.js';
import { fake, fakeJwt } from './fakeKeys.js';

// Vite's loadEnv lets VITE_* already in the environment win over the files,
// as a real build does; none from this shell may leak into the fixtures.
for (const name of Object.keys(process.env)) if (name.startsWith('VITE_')) delete process.env[name];

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = path.join(repoRoot, 'scripts', 'build-release.mjs');
const CLEAN = fileURLToPath(new URL('./fixtures/clean-build/', import.meta.url));
const DEV_ENV_TEXT = readFileSync(path.join(repoRoot, '.env.example'), 'utf8');

const tmp = mkdtempSync(path.join(os.tmpdir(), 'onextap-release-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
let dirs = 0;
const freshDir = () => {
  const dir = path.join(tmp, `case-${(dirs += 1)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const PROD = Object.freeze({
  VITE_SUPABASE_URL: 'https://itqaozltgsyvjhlcllic.supabase.co',
  VITE_SUPABASE_ANON_KEY: fake.anonJwt,
  VITE_API_URL: 'https://www.onextap.com',
  VITE_DASHBOARD_URL: 'https://www.onextap.com',
  VITE_ANSWER_STUDIO_MODEL: 'llama-3.3-70b-versatile',
});
const PROD_ENV_TEXT = Object.entries(PROD).map(([k, v]) => `${k}=${v}`).join('\n');

const failing = (results) => results.filter((r) => !r.ok).map((r) => r.name);

/**
 * Every value in an env object, for "was any of these printed?" checks. The
 * production origins are left out: they are the rules' own text.
 */
const PUBLIC = new Set(['https://www.onextap.com', 'https://itqaozltgsyvjhlcllic.supabase.co']);
const valuesOf = (env) => Object.values(env).filter((v) => v && v.length > 3 && !PUBLIC.has(v));

// ---------- step 1: the environment ----------

test('a production environment passes', () => {
  assert.deepEqual(failing(checkReleaseEnv(PROD)), []);
});

test('VITE_API_URL may be unset (the extension then calls www.onextap.com); trailing slashes are fine', () => {
  const { VITE_API_URL: _unset, ...rest } = PROD;
  assert.deepEqual(failing(checkReleaseEnv(rest)), []);
  assert.deepEqual(failing(checkReleaseEnv({ ...PROD, VITE_API_URL: '' })), []);
  assert.deepEqual(
    failing(checkReleaseEnv({
      ...PROD,
      VITE_API_URL: 'https://www.onextap.com/',
      VITE_DASHBOARD_URL: 'https://www.onextap.com/',
      VITE_SUPABASE_URL: 'https://itqaozltgsyvjhlcllic.supabase.co/',
    })),
    [],
  );
});

test("today's dev .env (as .env.example has it) fails on every origin", () => {
  const dev = dotenv.parse(DEV_ENV_TEXT);
  assert.deepEqual(failing(checkReleaseEnv(dev)), [
    'VITE_API_URL',
    'VITE_DASHBOARD_URL',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
  ]);
});

test('the API origin must be exactly https://www.onextap.com', () => {
  for (const value of [
    'http://localhost:3001',
    'http://www.onextap.com',
    'https://onextap.com',
    'https://www.onextap.com/api',
    'https://www.onextap.com?x=1',
    'https://www.onextap.com.example.com',
    'https://www.onextap.com:8443',
    'not a url',
  ]) {
    assert.deepEqual(failing(checkReleaseEnv({ ...PROD, VITE_API_URL: value })), ['VITE_API_URL'], value);
  }
});

test('the dashboard URL must be set, to https://www.onextap.com', () => {
  for (const value of [undefined, '', 'http://localhost:5173', 'https://www.onextap.com/dashboard/', 'https://onextap.com']) {
    assert.deepEqual(failing(checkReleaseEnv({ ...PROD, VITE_DASHBOARD_URL: value })), ['VITE_DASHBOARD_URL'], String(value));
  }
});

test("the Supabase URL must be 1.0.2's project, over https", () => {
  for (const value of [
    undefined,
    'https://devprojectdevproject.supabase.co',
    'http://itqaozltgsyvjhlcllic.supabase.co',
    'https://itqaozltgsyvjhlcllic.supabase.co.example.com',
    'https://itqaozltgsyvjhlcllic.supabase.co/rest/v1',
  ]) {
    assert.deepEqual(failing(checkReleaseEnv({ ...PROD, VITE_SUPABASE_URL: value })), ['VITE_SUPABASE_URL'], String(value));
  }
});

test("the anon key must be an anon or publishable key, of 1.0.2's project when it says", () => {
  assert.deepEqual(failing(checkReleaseEnv({ ...PROD, VITE_SUPABASE_ANON_KEY: fake.supabasePublishable })), []);
  for (const value of [undefined, '', fake.serviceRoleJwt, fake.supabaseSecret, fake.otherProjectAnonJwt, 'eyJ...your-anon-key...']) {
    assert.deepEqual(failing(checkReleaseEnv({ ...PROD, VITE_SUPABASE_ANON_KEY: value })), ['VITE_SUPABASE_ANON_KEY']);
  }
});

test("an anon JWT naming 1.0.2's project passes with no caveat", () => {
  const [anon] = checkReleaseEnv(PROD).filter((r) => r.name === 'VITE_SUPABASE_ANON_KEY');
  assert.equal(anon.ok, true);
  assert.equal(anon.confirm, false);
  assert.doesNotMatch(anon.rule, /confirm/);
});

test('a key that cannot name its project passes, but says to confirm it by hand', () => {
  const noRef = fakeJwt({ iss: 'supabase', role: 'anon', iat: 1, exp: 2 });
  for (const [key, wording] of [
    [fake.supabasePublishable, /^a publishable key: its project can't be read from it; confirm it is itqaozltgsyvjhlcllic's$/],
    [noRef, /^an anon JWT without a project ref: its project can't be read from it; confirm it is itqaozltgsyvjhlcllic's$/],
  ]) {
    const results = checkReleaseEnv({ ...PROD, VITE_SUPABASE_ANON_KEY: key });
    const [anon] = results.filter((r) => r.name === 'VITE_SUPABASE_ANON_KEY');
    assert.equal(anon.ok, true);
    assert.equal(anon.confirm, true);
    assert.match(anon.rule, wording);
    assert.ok(!JSON.stringify(results).includes(key), 'the key is never in the results');
  }
});

test('a confirm-by-hand key is printed as a pass with its caveat, never its value', () => {
  const dir = freshDir();
  writeFileSync(path.join(dir, '.env'), PROD_ENV_TEXT.replace(fake.anonJwt, fake.supabasePublishable));
  const { status, stdout, stderr } = cli(['--check-env', dir]);
  assert.equal(status, 0, stderr);
  assert.match(
    stdout,
    /pass {2}VITE_SUPABASE_ANON_KEY {2}\(a publishable key: its project can't be read from it; confirm it is itqaozltgsyvjhlcllic's\)/,
  );
  assert.match(stdout, /confirm by hand/i);
  assert.ok(!stdout.includes(fake.supabasePublishable));
});

test('a VITE_* variable named like a server secret fails, by name', () => {
  const name = ['VITE', 'GROQ', 'API', 'KEY'].join('_');
  const results = checkReleaseEnv({ ...PROD, [name]: fake.groq });
  assert.deepEqual(failing(results), [name]);
});

test('the results never carry a value', () => {
  const dev = dotenv.parse(DEV_ENV_TEXT);
  const name = ['VITE', 'GEMINI', 'API', 'KEY'].join('_');
  for (const env of [PROD, dev, { ...PROD, VITE_SUPABASE_ANON_KEY: fake.serviceRoleJwt, [name]: fake.gemini }]) {
    const text = JSON.stringify(checkReleaseEnv(env));
    for (const value of valuesOf(env)) assert.ok(!text.includes(value), 'a value leaked into the results');
  }
});

test('readReleaseEnv reads the files the way a production Vite build does', () => {
  const dir = freshDir();
  writeFileSync(path.join(dir, '.env'), `${DEV_ENV_TEXT}\nSERVER_ONLY=x\n`);
  writeFileSync(path.join(dir, '.env.production.local'), 'VITE_DASHBOARD_URL=https://www.onextap.com\n');

  const env = readReleaseEnv(dir);
  assert.equal(env.VITE_DASHBOARD_URL, 'https://www.onextap.com', '.env.production.local wins over .env');
  assert.equal(env.VITE_API_URL, 'http://localhost:3001');
  assert.equal(env.SERVER_ONLY, undefined, 'only VITE_* names reach the bundle');
});

// ---------- the five steps ----------

/** A repo-shaped directory with this .env, and a build that copies `output`. */
function release({ envText = PROD_ENV_TEXT, plant } = {}) {
  const root = freshDir();
  writeFileSync(path.join(root, '.env'), envText);
  const lines = [];
  let built = 0;
  const run = () =>
    runRelease({
      root,
      env: readReleaseEnv(root),
      build: () => {
        built += 1;
        const out = path.join(root, RELEASE_OUT_DIR);
        cpSync(CLEAN, out, { recursive: true });
        mkdirSync(path.join(out, '.vite'), { recursive: true });
        writeFileSync(path.join(out, '.vite', 'manifest.json'), '{}');
        plant?.(out);
        return true;
      },
      print: (line = '') => lines.push(line),
    });
  return { root, lines, run, built: () => built };
}

const zipCheck = tarSupportsZip() ? false : "this machine's tar cannot write zip (needs bsdtar)";

test('the dev .env refuses at step 1: nothing is built, and no value is printed', async () => {
  const r = release({ envText: DEV_ENV_TEXT });
  const result = await r.run();
  assert.equal(result.ok, false);
  assert.equal(result.step, 1);
  assert.equal(r.built(), 0);
  assert.ok(!existsSync(path.join(r.root, 'release')));
  const out = r.lines.join('\n');
  assert.match(out, /FAIL\s+VITE_API_URL/);
  assert.match(out, /FAIL\s+VITE_SUPABASE_URL/);
  for (const value of valuesOf(dotenv.parse(DEV_ENV_TEXT))) assert.ok(!out.includes(value), `printed ${value}`);
});

test('a planted secret refuses at step 3, before the manifest check and the zip', async () => {
  const r = release({ plant: (out) => appendFileSync(path.join(out, 'content.js'), `\nconst k="${fake.groq}";\n`) });
  const result = await r.run();
  assert.equal(result.ok, false);
  assert.equal(result.step, 3);
  assert.equal(r.built(), 1);
  assert.ok(!existsSync(path.join(r.root, 'release')));
  const out = r.lines.join('\n');
  assert.match(out, /groq-key/);
  assert.ok(!out.includes(fake.groq), 'the key is never printed');
});

test('localhost in the built output refuses at step 3', async () => {
  const r = release({ plant: (out) => appendFileSync(path.join(out, 'content.js'), '\nconst API="http://localhost:3001";\n') });
  const result = await r.run();
  assert.equal(result.step, 3);
  assert.match(r.lines.join('\n'), /localhost:3001/);
});

test('a widened manifest refuses at step 4', async () => {
  const r = release({
    plant: (out) => {
      const file = path.join(out, 'manifest.json');
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      manifest.permissions.push('tabs');
      writeFileSync(file, JSON.stringify(manifest));
    },
  });
  const result = await r.run();
  assert.equal(result.ok, false);
  assert.equal(result.step, 4);
  assert.match(r.lines.join('\n'), /permissions.*tabs/);
  assert.ok(!existsSync(path.join(r.root, 'release')));
});

test('a failed build stops at step 2', async () => {
  const root = freshDir();
  writeFileSync(path.join(root, '.env'), PROD_ENV_TEXT);
  const result = await runRelease({ root, env: readReleaseEnv(root), build: () => false, print: () => {} });
  assert.deepEqual({ ok: result.ok, step: result.step }, { ok: false, step: 2 });
});

test('all five steps: the zip, named by version, with its SHA-256', { skip: zipCheck }, async () => {
  const r = release();
  const result = await r.run();
  assert.equal(result.ok, true, r.lines.join('\n'));
  assert.equal(result.zip, path.join(r.root, 'release', 'onextap-1.0.4.zip'));
  const bytes = readFileSync(result.zip);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  const out = r.lines.join('\n');
  assert.match(out, new RegExp(`SHA-256\\s+${result.sha256}`));
  assert.match(out, /release[\\/]onextap-1\.0\.4\.zip/);
});

// ---------- the zip ----------

test('releaseZipPath: release/onextap-<version>.zip, and only for a version', () => {
  assert.equal(releaseZipPath('/repo', '1.0.4'), path.join('/repo', 'release', 'onextap-1.0.4.zip'));
  for (const bad of ['', undefined, '1.0.4/../../x', '1.0', 'v1.0.4', '1.0.4 ']) {
    assert.throws(() => releaseZipPath('/repo', bad), /version/, String(bad));
  }
});

test('zipDir: a real zip, manifest.json at its root, no ./ prefix and no .vite/', { skip: zipCheck }, () => {
  const dir = freshDir();
  cpSync(CLEAN, dir, { recursive: true });
  mkdirSync(path.join(dir, '.vite'));
  writeFileSync(path.join(dir, '.vite', 'manifest.json'), '{}');
  const zip = path.join(freshDir(), 'out', 'x.zip');

  const { sha256, bytes } = zipDir(dir, zip);
  const data = readFileSync(zip);
  assert.equal(data.subarray(0, 4).toString('latin1'), 'PK\x03\x04');
  assert.equal(bytes, data.length);
  assert.equal(sha256, createHash('sha256').update(data).digest('hex'));

  const listing = spawnSync(tarPath(), ['-t', '-f', zip], { encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean);
  assert.ok(listing.includes('manifest.json'), listing.join(', '));
  assert.ok(listing.includes('assets/index.html-fixture.js'), listing.join(', '));
  assert.ok(!listing.some((entry) => entry.startsWith('./') || entry.startsWith('.vite')), listing.join(', '));
});

// ---------- the command line ----------

/** The script, with no VITE_* inherited from this shell. */
function cli(args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITE_') && k !== 'ONEXTAP_RELEASE'));
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repoRoot, env, encoding: 'utf8' });
}

test('--check-env with the dev .env: exit 1, FAIL lines, no values, nothing built', () => {
  const dir = freshDir();
  writeFileSync(path.join(dir, '.env'), DEV_ENV_TEXT);
  const { status, stdout, stderr } = cli(['--check-env', dir]);
  assert.equal(status, 1, stderr);
  assert.match(stdout, /FAIL\s+VITE_API_URL/);
  assert.match(stdout, /refus/i);
  assert.doesNotMatch(stdout, /Step 2/);
  for (const value of valuesOf(dotenv.parse(DEV_ENV_TEXT))) assert.ok(!`${stdout}${stderr}`.includes(value), `printed ${value}`);
});

test('--check-env with a production .env: exit 0, every line a pass', () => {
  const dir = freshDir();
  writeFileSync(path.join(dir, '.env'), PROD_ENV_TEXT);
  const { status, stdout, stderr } = cli(['--check-env', dir]);
  assert.equal(status, 0, stderr);
  assert.doesNotMatch(stdout, /FAIL/);
  assert.match(stdout, /pass\s+VITE_SUPABASE_URL/);
  assert.ok(!stdout.includes(fake.anonJwt));
});

test('an unknown argument is refused', () => {
  const { status, stderr } = cli(['--force']);
  assert.equal(status, 2);
  assert.match(stderr, /--force/);
});
