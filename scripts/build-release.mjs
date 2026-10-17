/**
 * `npm run build:release`: the zip uploaded to the Chrome Web Store
 * (completion plan B3-C, item 13). Five steps; the first that fails stops the
 * run with exit code 1, and nothing is zipped.
 *
 *   1. Environment. The VITE_* values the build will inline, read the way a
 *      production Vite build reads them (`loadEnv`: .env, .env.local,
 *      .env.production, .env.production.local, then any VITE_* already in the
 *      shell; dotenv underneath), checked against production: the API and
 *      the site on https://www.onextap.com, Supabase on 1.0.2's project, an
 *      anon key that is not a service-role key, and no VITE_* name that looks
 *      like a server secret (CLAUDE.md rule 7). Pass/fail per variable: no
 *      value is ever printed. A key that cannot name its project (a
 *      publishable key) passes with a line saying to confirm it by hand.
 *      Today's dev .env refuses here.
 *   2. Build. `vite build` with ONEXTAP_RELEASE=1, which vite.config.js turns
 *      into dist-release/ and a manifest without its localhost entries
 *      (scripts/releaseManifest.js).
 *   3. Scan every file in dist-release/: no localhost, 127.0.0.1 or [::1]; no
 *      service-role JWT (each JWT-shaped string is decoded and its `role`
 *      read; the anon JWT the bundle carries is fine); no Groq, Gemini,
 *      Resend, Dodo webhook or Supabase secret key shape; no server secret
 *      variable name. Keys are reported by rule and offset, never quoted.
 *      Dodo's API keys have no prefix to match, so the name is what catches
 *      them (and step 1 keeps them out of VITE_*).
 *   4. The built manifest against the pinned release (checkReleaseManifest):
 *      the version, permissions exactly storage/activeTab/scripting/identity,
 *      host permissions and externally_connectable equal to 1.0.2's minus
 *      localhost.
 *   5. Zip dist-release/ (without .vite/, Vite's build metadata) with the
 *      platform's tar, which must be bsdtar (Windows and macOS ship it), to
 *      release/onextap-<version>.zip, and print its SHA-256.
 *
 * Two localhost strings a real build carries are allowed, and listed when
 * the scan runs: a bare hostname in quotes (a comparison, like
 * src/extensionClient.js's LOCAL_HOSTS and @supabase/auth-js's WebAuthn host
 * check; it cannot be called), and supabase-js's default auth URL, which
 * src/supabaseClient.js never uses because it passes VITE_SUPABASE_URL.
 * Anything else with localhost in it fails.
 *
 *   node scripts/build-release.mjs                    the five steps
 *   node scripts/build-release.mjs --check-env <dir>  step 1 only, against
 *                                                     <dir>'s env files
 *
 * The exports are for test/release/.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

import { RELEASE_OUT_DIR, checkReleaseManifest } from './releaseManifest.js';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

const SITE = 'https://www.onextap.com';
/** 1.0.2's Supabase project (plan §2). B6 confirms it is production. */
const SUPABASE_REF = 'itqaozltgsyvjhlcllic';
const SUPABASE_ORIGIN = `https://${SUPABASE_REF}.supabase.co`;

// ---------- step 1: the environment ----------

/** Rule 7's list (test/rules/rule7-vite-secrets.test.js): server secret names. */
const SECRETISH = /SERVICE_ROLE|SECRET|GROQ|GEMINI|DODO|OPIK|CRON|RESEND|ADZUNA/;

/**
 * The VITE_* values a production build of `dir` inlines.
 * @param {string} dir where the .env files are (the repo root)
 * @returns {Record<string, string>}
 */
export function readReleaseEnv(dir) {
  return loadEnv('production', dir, 'VITE_');
}

/** A JWT's claims, or null when the string is not one. */
function jwtClaims(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' ? claims : null;
  } catch {
    return null;
  }
}

/** Exactly this origin: nothing after it but an optional slash. */
function isOrigin(value, origin) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.origin === origin && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
}

const ANON_KEY_RULE = `${SUPABASE_REF}'s anon or publishable key, never a service-role or secret key`;
const CANNOT_TELL = `its project can't be read from it; confirm it is ${SUPABASE_REF}'s`;

/**
 * The anon key's result. An anon JWT names its project in `ref`, so a wrong
 * one fails. A publishable key (and a JWT without `ref`) names none: it
 * passes, since VITE_SUPABASE_URL pins the project, but its result says it
 * has to be confirmed by hand as production's (B6), or a dev project's key
 * could ship next to the production URL.
 */
function anonKeyResult(value) {
  const name = 'VITE_SUPABASE_ANON_KEY';
  const fail = { name, ok: false, confirm: false, rule: ANON_KEY_RULE };
  if (!value) return fail;
  if (value.startsWith('sb_publishable_')) {
    return { name, ok: true, confirm: true, rule: `a publishable key: ${CANNOT_TELL}` };
  }
  const claims = jwtClaims(value);
  if (claims?.role !== 'anon') return fail;
  if (claims.ref === undefined) {
    return { name, ok: true, confirm: true, rule: `an anon JWT without a project ref: ${CANNOT_TELL}` };
  }
  return claims.ref === SUPABASE_REF ? { ...fail, ok: true } : fail;
}

/**
 * Step 1, on data: a parsed environment in, one result per variable out.
 * A result holds the variable's name and the rule it was held to, never its
 * value, so the results can be printed as they are. `confirm` marks a pass
 * the check cannot settle, which a person has to confirm by hand.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{ name: string, ok: boolean, confirm: boolean, rule: string }[]}
 */
export function checkReleaseEnv(env) {
  const get = (name) => (typeof env?.[name] === 'string' ? env[name] : '');
  const results = [
    {
      name: 'VITE_API_URL',
      rule: `unset, or exactly ${SITE}`,
      ok: get('VITE_API_URL') === '' || isOrigin(get('VITE_API_URL'), SITE),
    },
    {
      name: 'VITE_DASHBOARD_URL',
      rule: `exactly ${SITE}`,
      ok: isOrigin(get('VITE_DASHBOARD_URL'), SITE),
    },
    {
      name: 'VITE_SUPABASE_URL',
      rule: `exactly ${SUPABASE_ORIGIN}, 1.0.2's project`,
      ok: isOrigin(get('VITE_SUPABASE_URL'), SUPABASE_ORIGIN),
    },
  ].map((result) => ({ ...result, confirm: false }));
  results.push(anonKeyResult(get('VITE_SUPABASE_ANON_KEY')));
  const secretish = Object.keys(env ?? {})
    .filter((name) => name.startsWith('VITE_') && SECRETISH.test(name))
    .sort();
  for (const name of secretish) {
    results.push({
      name,
      ok: false,
      confirm: false,
      rule: 'named like a server secret; every VITE_* value ships in the bundle (rule 7)',
    });
  }
  return results;
}

/** Step 1, printed. @returns {boolean} whether every variable passes */
function envStep(env, print) {
  const results = checkReleaseEnv(env);
  for (const { name, ok, rule } of results) print(`  ${ok ? 'pass' : 'FAIL'}  ${name}  (${rule})`);
  const failed = results.filter((r) => !r.ok).length;
  if (failed) {
    print(`Refusing to build: ${failed} variable${failed === 1 ? '' : 's'} not set for production. Values are not printed.`);
  }
  const confirm = results.filter((r) => r.ok && r.confirm).map((r) => r.name);
  if (!failed && confirm.length) print(`  Confirm by hand before uploading: ${confirm.join(', ')} (see above).`);
  return failed === 0;
}

// ---------- step 3: the output scan ----------

const LOCAL = /localhost|127\.0\.0\.1|\[::1\]/gi;
const BARE_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])$/i;
/** Characters a URL or host:port is made of, to show the whole one found. */
const URLISH = /[\w.:/\-[\]%@?&=#*+~]/;
const QUOTES = new Set(['"', "'", '`']);

/** Library defaults a release build carries and never calls. */
const ALLOWED_LOCAL_LITERALS = new Map([
  [
    'http://localhost:9999',
    "@supabase/auth-js's default auth URL; unused, src/supabaseClient.js passes VITE_SUPABASE_URL",
  ],
]);

const JWT = /eyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]*/g;

const KEY_SHAPES = [
  { rule: 'groq-key', re: /gsk_[A-Za-z0-9]{20,}/g },
  { rule: 'gemini-key', re: /AIza[0-9A-Za-z_-]{35}/g },
  { rule: 'resend-key', re: /\bre_[A-Za-z0-9_]{20,}/g },
  // Dodo's webhook key: Standard Webhooks secrets are whsec_ + base64.
  { rule: 'webhook-secret', re: /whsec_[A-Za-z0-9+/=]{16,}/g },
  { rule: 'supabase-secret-key', re: /sb_secret_[A-Za-z0-9_-]{10,}/g },
];

/** GROQ_API_KEY, DODO_PAYMENTS_API_KEY and the like; bare words are not names. */
const SECRET_NAME = /[A-Z0-9_]*(?:GROQ|GEMINI|DODO|RESEND|SERVICE_ROLE|OPIK|CRON_SECRET|ADZUNA)[A-Z0-9_]*/g;

/**
 * Step 3 on one file's text.
 *
 * @param {string} text
 * @returns {{
 *   findings: { rule: string, at: number, match?: string }[],
 *   allowed: { match: string, why: string, at: number }[],
 * }} `match` is set only where it is not a secret (localhost, a name).
 */
export function scanText(text) {
  const findings = [];
  const allowed = [];

  // JWTs first, decoded; then masked, so a JWT's base64 can never be read
  // as some other key's shape.
  const masked = text.replace(JWT, (token, at) => {
    if (jwtClaims(token)?.role === 'service_role') findings.push({ rule: 'service-role-jwt', at });
    return ' '.repeat(token.length);
  });
  for (const { rule, re } of KEY_SHAPES) {
    for (const m of masked.matchAll(re)) findings.push({ rule, at: m.index });
  }
  for (const m of masked.matchAll(SECRET_NAME)) {
    if (m[0].includes('_')) findings.push({ rule: 'secret-name', at: m.index, match: m[0] });
  }

  let end = -1;
  for (const m of text.matchAll(LOCAL)) {
    if (m.index < end) continue; // inside the URL already reported
    let start = m.index;
    while (start > 0 && m.index - start < 100 && URLISH.test(text[start - 1])) start -= 1;
    end = m.index + m[0].length;
    while (end < text.length && end - m.index < 200 && URLISH.test(text[end])) end += 1;
    const token = text.slice(start, end);
    const quoted = QUOTES.has(text[start - 1]) && text[end] === text[start - 1];
    if (quoted && BARE_HOST.test(token)) {
      allowed.push({ match: token, why: 'a bare hostname in quotes: compared against, never called', at: start });
    } else if (quoted && ALLOWED_LOCAL_LITERALS.has(token)) {
      allowed.push({ match: token, why: ALLOWED_LOCAL_LITERALS.get(token), at: start });
    } else {
      findings.push({ rule: 'localhost', at: start, match: token });
    }
  }

  findings.sort((a, b) => a.at - b.at);
  return { findings, allowed };
}

/** Every path under `dir`, relative and with forward slashes, sorted. */
function listEntries(dir, prefix = '') {
  return readdirSync(path.join(dir, prefix), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return listEntries(dir, rel);
      return [{ rel, file: entry.isFile() }];
    });
}

/**
 * Step 3 on a build output: every file, binary ones included (read as
 * latin1, which keeps ASCII intact).
 *
 * @param {string} dir
 * @returns {{ files: number, findings: object[], allowed: object[] }}
 */
export function scanDir(dir) {
  const findings = [];
  const allowed = [];
  let files = 0;
  for (const { rel, file } of listEntries(dir)) {
    if (!file) {
      findings.push({ file: rel, rule: 'not-a-file', at: 0 });
      continue;
    }
    files += 1;
    const result = scanText(readFileSync(path.join(dir, rel)).toString('latin1'));
    findings.push(...result.findings.map((f) => ({ file: rel, ...f })));
    allowed.push(...result.allowed.map((a) => ({ file: rel, ...a })));
  }
  return { files, findings, allowed };
}

function scanStep(outDir, print) {
  const { files, findings, allowed } = scanDir(outDir);
  const groups = new Map();
  for (const a of allowed) {
    const key = `${a.file}\0${a.match}`;
    groups.set(key, { ...a, count: (groups.get(key)?.count ?? 0) + 1 });
  }
  for (const a of groups.values()) {
    print(`  allowed  ${a.file}  "${a.match}"${a.count > 1 ? ` x${a.count}` : ''}  (${a.why})`);
  }
  for (const f of findings) {
    print(`  FAIL  ${f.file} @${f.at}  ${f.rule}${f.match ? `  ${f.match}` : ''}`);
  }
  print(`  ${files} files scanned, ${findings.length} finding${findings.length === 1 ? '' : 's'}`);
  if (findings.length) print(`Refusing: the build output carries what a release must not.`);
  return findings.length === 0;
}

// ---------- step 5: the zip ----------

/** Not shipped: Vite's build manifest, which Chrome never reads. */
const ZIP_EXCLUDE = new Set(['.vite']);
const VERSION = /^\d+(\.\d+){2,3}$/;

/** release/onextap-<version>.zip under `root`. */
export function releaseZipPath(root, version) {
  if (!VERSION.test(String(version ?? ''))) throw new Error(`not a release version: ${version}`);
  return path.join(root, 'release', `onextap-${version}.zip`);
}

/** The platform's tar: on Windows, System32's bsdtar, not a Unix tar earlier in PATH. */
export function tarPath() {
  if (process.platform === 'win32') {
    const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (existsSync(system)) return system;
  }
  return 'tar';
}

/** True when tarPath() is bsdtar, which writes zip (GNU tar cannot). */
export function tarSupportsZip() {
  const { status, stdout } = spawnSync(tarPath(), ['--version'], { encoding: 'utf8' });
  return status === 0 && /bsdtar|libarchive/i.test(stdout || '');
}

/**
 * Zip the contents of `dir` (manifest.json at the zip's root, .vite/ left
 * out) to `zipFile`.
 *
 * @returns {{ bytes: number, sha256: string }}
 */
export function zipDir(dir, zipFile) {
  // Members named one by one, not `.`, so no entry starts with "./".
  const members = readdirSync(dir).filter((name) => !ZIP_EXCLUDE.has(name)).sort();
  if (!members.includes('manifest.json')) throw new Error(`no manifest.json in ${dir}`);
  const target = path.resolve(zipFile);
  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { force: true });

  const tar = spawnSync(tarPath(), ['-c', '--format', 'zip', '-f', target, '-C', dir, ...members], { encoding: 'utf8' });
  if (tar.error || tar.status !== 0) {
    throw new Error(`tar failed: ${tar.error?.message || (tar.stderr || '').trim() || `exit ${tar.status}`}`);
  }
  const data = readFileSync(target);
  if (data.subarray(0, 4).toString('latin1') !== 'PK\x03\x04') {
    throw new Error(`${tarPath()} did not write a zip; build:release needs bsdtar (Windows and macOS ship it)`);
  }
  return { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}

// ---------- the five steps ----------

/** Step 2: the real build. @returns {boolean} */
function viteBuild(root) {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const { status, error } = spawnSync(process.execPath, [vite, 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ONEXTAP_RELEASE: '1' },
  });
  return !error && status === 0;
}

/**
 * The five steps, in order; the first failure stops the run.
 *
 * @param {object} options
 * @param {string} options.root the repo (dist-release/ and release/ are under it)
 * @param {Record<string, string>} options.env what readReleaseEnv(root) returns
 * @param {(root: string) => boolean} [options.build] step 2; the tests swap it
 * @param {(line?: string) => void} [options.print]
 * @returns {{ ok: true, zip: string, sha256: string } | { ok: false, step: number }}
 */
export function runRelease({ root, env, build = viteBuild, print = console.log }) {
  const refuse = (step) => {
    print('Nothing was zipped. A zip already in release/ is from an earlier run.');
    return { ok: false, step };
  };
  const outDir = path.join(root, RELEASE_OUT_DIR);

  print('Step 1/5  environment (the VITE_* values a production build inlines)');
  if (!envStep(env, print)) return refuse(1);

  print(`Step 2/5  build: vite build, ONEXTAP_RELEASE=1 -> ${RELEASE_OUT_DIR}/`);
  if (!build(root)) {
    print('Refusing: the build failed.');
    return refuse(2);
  }

  print(`Step 3/5  scan ${RELEASE_OUT_DIR}/`);
  if (!scanStep(outDir, print)) return refuse(3);

  print('Step 4/5  manifest');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  } catch (err) {
    print(`  FAIL  ${RELEASE_OUT_DIR}/manifest.json: ${err.message}`);
    return refuse(4);
  }
  const problems = checkReleaseManifest(manifest);
  for (const problem of problems) print(`  FAIL  ${problem}`);
  if (problems.length) {
    print('Refusing: the manifest is not the release manifest.');
    return refuse(4);
  }
  print(`  pass  version ${manifest.version}; permissions, host permissions and externally_connectable as pinned`);

  print('Step 5/5  zip');
  let zip;
  let result;
  try {
    zip = releaseZipPath(root, manifest.version);
    result = zipDir(outDir, zip);
  } catch (err) {
    print(`  FAIL  ${err.message}`);
    return refuse(5);
  }
  print(`  ${path.relative(root, zip)}  (${result.bytes} bytes)`);
  print(`  SHA-256  ${result.sha256}`);
  return { ok: true, zip, sha256: result.sha256 };
}

function main(args) {
  if (args.length === 0) {
    return runRelease({ root: repoRoot, env: readReleaseEnv(repoRoot) }).ok ? 0 : 1;
  }
  if (args[0] === '--check-env' && args.length === 2) {
    const dir = path.resolve(args[1]);
    console.log(`Step 1/5  environment, from the env files in ${dir} (check only, nothing is built)`);
    return envStep(readReleaseEnv(dir), console.log) ? 0 : 1;
  }
  console.error(`build-release: unknown arguments: ${args.join(' ')}`);
  console.error('usage: node scripts/build-release.mjs [--check-env <dir>]');
  return 2;
}

/** Run as a script, not imported by a test. Compared by real path (Windows casing). */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) process.exitCode = main(process.argv.slice(2));
