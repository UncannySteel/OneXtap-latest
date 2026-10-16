/**
 * The server harness is isolated: no real configuration, no listener of the
 * app's own, no network.
 *
 * Every other server test trusts test/server/harness.js, and the main checkout
 * it runs in has a server/.env with live keys. So the isolation is asserted
 * here rather than assumed — including that each SDK with a built-in base URL
 * is actually stopped, whichever HTTP stack it brings.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import path from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';

import { startHarness, HARNESS_ENV, SERVER_DIR, serverRequire } from '../server/harness.js';

const harness = await startHarness();
test.after(() => harness.close());

/** Every .js file under server/, excluding node_modules. */
function serverModules(dir = SERVER_DIR, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) serverModules(full, found);
    else if (entry.endsWith('.js')) found.push(full);
  }
  return found;
}

/**
 * Run `fn` with stderr swallowed. Resend and supabase-js print their own
 * failures straight to the console, which here is expected noise.
 */
async function quietly(fn) {
  const realWrite = process.stderr.write;
  process.stderr.write = (_chunk, ...rest) => {
    const cb = rest.find((arg) => typeof arg === 'function');
    if (cb) process.nextTick(cb);
    return true;
  };
  try {
    return await fn();
  } finally {
    process.stderr.write = realWrite;
  }
}

/** The last `blocked` entry added by `fn`, which must reject or error. */
async function blockedBy(fn) {
  const before = harness.blocked.length;
  await assert.rejects(fn);
  assert.ok(harness.blocked.length > before, 'the attempt failed, but not because the guard stopped it');
  return harness.blocked.at(-1);
}

test('the harness sets or deletes every env var server/ reads', () => {
  const read = new Set();
  const dynamic = [];
  for (const file of serverModules()) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) read.add(m[1]);
    for (const m of source.matchAll(/process\.env\[\s*['"]([A-Z0-9_]+)['"]\s*\]/g)) read.add(m[1]);
    for (const m of source.matchAll(/envInt\(\s*['"]([A-Z0-9_]+)['"]/g)) read.add(m[1]);
    // Reads through an alias, e.g. generateLimit.js's `(env = process.env)`
    // and then `env?.GENERATE_LIMIT_PER_HOUR`.
    for (const [, alias] of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*process\.env\b(?!\s*\.|\s*\[)/g)) {
      const reads = new RegExp(`\\b${alias.replace(/\$/g, '\\$')}\\??\\.([A-Z][A-Z0-9_]+)`, 'g');
      for (const m of source.matchAll(reads)) read.add(m[1]);
    }
    for (const m of source.matchAll(/process\.env\[(?!\s*['"])/g)) {
      dynamic.push(`${path.relative(SERVER_DIR, file)}@${m.index}`);
    }
  }

  // The one dynamic read is rank.js's envInt(name), whose names are collected
  // above. A new one would hide its names from this test.
  assert.deepEqual(
    dynamic.map((d) => d.split('@')[0]),
    [path.join('jobs', 'rank.js')],
    `unexpected dynamic process.env[...] reads: ${dynamic.join(', ')}`,
  );

  assert.ok(read.size >= 30, `expected to find server env reads, found ${read.size}`);
  const uncovered = [...read].filter((name) => !Object.hasOwn(HARNESS_ENV, name)).sort();
  assert.deepEqual(uncovered, [], `add these to HARNESS_ENV in test/server/harness.js: ${uncovered.join(', ')}`);

  // Read by the SDKs themselves, not by server/ code.
  for (const name of ['GROQ_BASE_URL', 'RESEND_BASE_URL', 'DODO_PAYMENTS_BASE_URL']) {
    assert.ok(Object.hasOwn(HARNESS_ENV, name), `${name} must be controlled by the harness`);
  }
});

test('importing the app reads no .env, changes no env var and opens no listener', () => {
  assert.deepEqual(harness.dotenvCalls, [], 'dotenv was called during the import: server/.env would have been read');
  assert.deepEqual(harness.envChangedByImport, [], 'the import changed these env vars');
  assert.deepEqual(harness.listensDuringImport, [], 'server/index.js tried to listen: is VERCEL set?');

  const drifted = Object.entries(HARNESS_ENV)
    .filter(([key, value]) => process.env[key] !== value)
    .map(([key]) => key);
  assert.deepEqual(drifted, [], 'these env vars do not hold the harness value');
  assert.equal(process.env.VERCEL, '1');
  assert.equal(process.env.ONEXTAP_SKIP_DOTENV, '1');
});

test('the harness serves the app on an ephemeral loopback port', async () => {
  assert.ok(Number.isInteger(harness.port) && harness.port > 0 && harness.port !== 3001);
  const res = await harness.request('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).status, 'ok');
});

test('fetch to any outside host is refused, as is a loopback port the harness is not serving', async () => {
  const outside = await blockedBy(() => fetch('https://generativelanguage.googleapis.com/v1beta/models'));
  assert.deepEqual(outside, { via: 'fetch', target: 'https://generativelanguage.googleapis.com' });

  const dummyService = await blockedBy(() => fetch('http://127.0.0.1:9/'));
  assert.deepEqual(dummyService, { via: 'fetch', target: 'http://127.0.0.1:9' });
});

test('a raw socket to an outside host is refused (node:http, node-fetch, undici)', async () => {
  const hit = await blockedBy(
    () =>
      new Promise((resolve, reject) => {
        https.get('https://api.groq.com/openai/v1/models', resolve).on('error', reject);
      }),
  );
  assert.deepEqual(hit, { via: 'socket', target: 'api.groq.com:443' });
});

test('groq-sdk (own node-fetch) is stopped, at its default host and at the dummy one', async () => {
  const { getGroq } = await import('../../server/groqClient.js');
  const serverGroq = getGroq();

  const dummy = await blockedBy(() => serverGroq.models.list());
  assert.deepEqual(dummy, { via: 'socket', target: '127.0.0.1:9' });

  // Same SDK copy the server uses, pointed at its real host.
  const Groq = serverGroq.constructor;
  const real = new Groq({ apiKey: 'harness-dummy', baseURL: 'https://api.groq.com', maxRetries: 0 });
  const hit = await blockedBy(() => real.models.list());
  assert.deepEqual(hit, { via: 'socket', target: 'api.groq.com:443' });
});

test('dodopayments is stopped at its built-in test-mode host', async () => {
  const DodoPayments = serverRequire('dodopayments').default ?? serverRequire('dodopayments');
  const dodo = new DodoPayments({ bearerToken: 'harness-dummy', environment: 'test_mode', maxRetries: 0 });
  const hit = await blockedBy(() => dodo.products.list());
  assert.equal(hit.target.replace(/^https?:\/\//, '').split(/[:/]/)[0], 'test.dodopayments.com');
});

test('resend and supabase go to the dummy URL and are stopped there', async () => {
  const { Resend } = serverRequire('resend');
  const before = harness.blocked.length;
  // Resend resolves to { error } rather than rejecting.
  const { error } = await quietly(() =>
    new Resend('re_harness_dummy').emails.send({
      from: 'a@harness.invalid',
      to: 'b@harness.invalid',
      subject: 'x',
      text: 'x',
    }),
  );
  assert.ok(error, 'expected Resend to report a failure');
  assert.deepEqual(harness.blocked.slice(before), [{ via: 'fetch', target: 'http://127.0.0.1:9' }]);

  // The server's own client instance.
  const { supabaseAdmin } = await import('../../server/supabase.js');
  const before2 = harness.blocked.length;
  const { error: authError } = await quietly(() => supabaseAdmin.auth.getUser('harness-dummy-token'));
  assert.ok(authError, 'expected supabase to report a failure');
  assert.ok(
    harness.blocked.slice(before2).some((b) => b.target === 'http://127.0.0.1:9'),
    'supabase did not hit the guard',
  );
});

test('opik stays off: no client, and its SDK is never loaded', async () => {
  const { isTracingEnabled, getOpikClient, startTrace } = await import('../../server/observability/opik.js');
  assert.equal(isTracingEnabled(), false);
  assert.equal(getOpikClient(), null);
  assert.equal(startTrace({ name: 'harness' }).id, null);

  const marker = `${path.sep}node_modules${path.sep}opik${path.sep}`;
  const opikLoaded = Object.keys(serverRequire.cache).filter((k) => k.includes(marker));
  assert.deepEqual(opikLoaded, []);
});
