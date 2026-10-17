/**
 * Behavioural harness for the Express app in server/index.js.
 *
 * test/server/parses.test.js can only check the file's syntax, because
 * importing server/index.js used to mean booting a server with whatever keys
 * server/.env held. This imports the real app and serves it on an ephemeral
 * port, under four guarantees, each of which test/rules/harness.test.js checks:
 *
 *   1. No real configuration. Every env var server/ reads is set to a dummy or
 *      deleted (HARNESS_ENV) before the import, and server/.env is never read:
 *      ONEXTAP_SKIP_DOTENV=1 makes server/load-env.js skip it, and a tripwire
 *      on the server's own `dotenv` turns any call that still happens into a
 *      recorded no-op. The main checkout has a server/.env with live keys, so
 *      "there is no .env here" is never what keeps a run clean.
 *   2. No listener but ours. VERCEL=1 stops server/index.js calling
 *      app.listen(); any listen() during the import is recorded and refused.
 *   3. No network. Two layers, because the SDKs do not share an HTTP stack:
 *      globalThis.fetch is wrapped (Supabase, Dodo, Resend, Gemini's raw
 *      fetch, the job adapters), and net.Socket.prototype.connect is wrapped
 *      underneath everything (groq-sdk 0.15 ships its own node-fetch, and
 *      undici, node-fetch and node:http all connect through it). Only loopback
 *      connections to a port this harness is serving get through; everything
 *      else, including the dummy service URLs below, fails fast and lands in
 *      `blocked`. Opik is off (OPIK_API_KEY is empty), so its SDK is never
 *      loaded and nothing is ever flushed.
 *   4. No log noise. The server's JSON log lines are collected into `logs`
 *      instead of the test output. HARNESS_LOGS=1 lets them through.
 *
 * The guards are installed once per process, before the import, and stay for
 * the life of the process: an SDK may have captured the wrapped fetch, and a
 * late call after close() must still be blocked. `node --test` runs each test
 * file in its own process, so nothing leaks into other files.
 *
 * Fake services (optional, startHarness({ fakes })). A test that needs a
 * route to get past Supabase or Groq can serve a fake of either on loopback:
 * the harness listens for it on an ephemeral port, points that service's
 * HARNESS_ENV URL at it before the import, and lets the guard through to that
 * port only. The four guarantees still hold: the URL is a dummy of ours, the
 * listener is ours, the connection never leaves loopback, and the logs are
 * still captured. Without `fakes`, nothing changes.
 */
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const SERVER_DIR = path.join(repoRoot, 'server');
const SERVER_ENTRY = path.join(SERVER_DIR, 'index.js');

/** Resolves packages the way server/ does (server/node_modules first). */
export const serverRequire = createRequire(SERVER_ENTRY);

/**
 * Where every service URL points. Port 9 is "discard", closed on any normal
 * machine, and the socket guard refuses it before a connect is even tried.
 */
export const UNREACHABLE_URL = 'http://127.0.0.1:9';

/**
 * The whole environment the server sees. A string is set; `undefined` is
 * deleted, so the code's own default applies. Credentials, URLs and
 * identities get dummies; tunables are deleted rather than given a value that
 * would only duplicate a default and drift from it.
 *
 * test/rules/harness.test.js fails if server/ reads a name missing from here.
 */
export const HARNESS_ENV = Object.freeze({
  // Harness switches
  ONEXTAP_SKIP_DOTENV: '1',
  VERCEL: '1',
  NODE_ENV: 'test',
  PORT: '0',
  LOG_LEVEL: 'warn',
  LOG_FORMAT: 'json',

  // Supabase
  SUPABASE_URL: UNREACHABLE_URL,
  SUPABASE_SERVICE_ROLE_KEY: 'harness-dummy-service-role-key',

  // Dodo Payments. DODO_PAYMENTS_BASE_URL stays unset: with `environment`
  // also passed, the SDK constructor throws "Ambiguous URL". The guards
  // cover Dodo instead.
  DODO_PAYMENTS_API_KEY: 'harness-dummy-dodo-key',
  DODO_PAYMENTS_WEBHOOK_KEY: `whsec_${Buffer.from('harness-dummy-webhook-key').toString('base64')}`,
  DODO_PAYMENTS_ENVIRONMENT: 'test_mode',
  DODO_PRODUCT_ID: 'prod_harness_dummy',
  DODO_PAYMENTS_BASE_URL: undefined,

  // Gemini (raw fetch to a fixed host; the guards cover it)
  GEMINI_API_KEY: 'harness-dummy-gemini-key',
  GEMINI_MODEL: undefined,
  GEMINI_FALLBACK_MODEL: undefined,
  GEMINI_PARSE_MODELS: undefined,
  GEMINI_RANK_MODELS: undefined,

  // Groq (groq-sdk reads GROQ_BASE_URL itself)
  GROQ_API_KEY: 'harness-dummy-groq-key',
  GROQ_BASE_URL: UNREACHABLE_URL,
  GROQ_MODEL: undefined,
  GROQ_FALLBACK_MODEL: undefined,
  GROQ_MAX_TOKENS: undefined,
  GROQ_TIMEOUT_MS: undefined,
  GROQ_MAX_RETRIES: undefined,

  // Resend (the SDK reads RESEND_BASE_URL itself)
  RESEND_API_KEY: 're_harness_dummy',
  RESEND_BASE_URL: UNREACHABLE_URL,
  RESEND_FROM_EMAIL: 'Harness <noreply@harness.invalid>',
  FEEDBACK_TO_EMAIL: 'feedback@harness.invalid',

  // Opik: empty on purpose. Tracing is off, so the SDK (which imports
  // dotenv/config and reads ~/.opik.config on its own) is never loaded.
  OPIK_API_KEY: '',
  OPIK_URL_OVERRIDE: UNREACHABLE_URL,
  OPIK_WORKSPACE: 'harness',
  OPIK_PROJECT_NAME: 'harness',

  // Cron and job ingest
  CRON_SECRET: 'harness-dummy-cron-secret',
  ADZUNA_APP_ID: 'harness-dummy-adzuna-id',
  ADZUNA_APP_KEY: 'harness-dummy-adzuna-key',
  ADZUNA_COUNTRIES: undefined,
  ATS_BOARDS: undefined,
  INGEST_SWEEP_PAGES: undefined,
  ALLOW_CACHE_SOURCE: 'false',

  // Generate rate limit (server/generateLimit.js)
  GENERATE_LIMIT_PER_HOUR: undefined,

  // Ranking tunables
  RANK_PROVIDER: undefined,
  RANK_BROADEN: undefined,
  RANK_BUDGET_MS: undefined,
  RANK_MAX_LOOPS: undefined,
  RANK_MIN_SCORE: undefined,
  RANK_BATCH_SIZE: undefined,
  RANK_CONCURRENCY: undefined,
  RANK_MAX_TOKENS: undefined,

  // Checkout return URL and the CORS allowlist's first entry
  CLIENT_URL: UNREACHABLE_URL,
});

// ------------------------------------------------------------------
// Network guard
// ------------------------------------------------------------------
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);
const servingPorts = new Set();

/** Every outbound attempt the guard refused: { via, target }. */
const blocked = [];

function isAllowed(host, port) {
  const bare = String(host).replace(/^\[|\]$/g, '').toLowerCase();
  return LOOPBACK.has(bare) && servingPorts.has(Number(port));
}

/** { host, port } for a TCP connect, or null for a local IPC pipe. */
function connectTarget(args) {
  // net.connect() hands Socket#connect its already-normalised [options, cb].
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === 'object') {
    if (first.path) return null;
    return { host: first.host || 'localhost', port: first.port };
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return null;
  return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first };
}

function installNetworkGuard() {
  const realConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function harnessGuardedConnect(...args) {
    const target = connectTarget(args);
    if (target && !isAllowed(target.host, target.port)) {
      const where = `${target.host}:${target.port}`;
      blocked.push({ via: 'socket', target: where });
      const err = new Error(`test harness blocked an outbound connection to ${where}`);
      err.code = 'EHARNESSBLOCKED';
      process.nextTick(() => this.destroy(err));
      return this;
    }
    return realConnect.apply(this, args);
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = function harnessGuardedFetch(input, init) {
    let url;
    try {
      url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    } catch {
      return realFetch(input, init);
    }
    const port = url.port || (url.protocol === 'https:' ? 443 : 80);
    if (!isAllowed(url.hostname, port)) {
      blocked.push({ via: 'fetch', target: url.origin });
      return Promise.reject(new TypeError(`test harness blocked fetch to ${url.origin}`));
    }
    return realFetch(input, init);
  };
}

// ------------------------------------------------------------------
// dotenv tripwire
// ------------------------------------------------------------------
/** Every call into the server's dotenv: { fn, path }. Should stay empty. */
const dotenvCalls = [];

function installDotenvTripwire() {
  // The same module instance server/load-env.js imports (CJS, cached).
  const dotenv = serverRequire('dotenv');
  for (const fn of ['config', 'configDotenv']) {
    dotenv[fn] = function harnessDotenvTripwire(options) {
      dotenvCalls.push({ fn, path: options?.path ? String(options.path) : '(default)' });
      return { parsed: {} };
    };
  }
}

// ------------------------------------------------------------------
// Log capture
// ------------------------------------------------------------------
/** The server's log records, parsed. */
const logs = [];

function captureServerLogs() {
  if (process.env.HARNESS_LOGS === '1') return;
  // At LOG_LEVEL=warn the server logger only writes console.warn/error, i.e.
  // stderr. stdout is left alone: the test runner reports through it.
  const realWrite = process.stderr.write;
  process.stderr.write = function harnessStderr(chunk, ...rest) {
    if (typeof chunk === 'string' && chunk.startsWith('{"ts":')) {
      for (const line of chunk.split('\n')) {
        if (!line) continue;
        try {
          logs.push(JSON.parse(line));
        } catch {
          logs.push({ raw: line });
        }
      }
      const cb = rest.find((arg) => typeof arg === 'function');
      if (cb) process.nextTick(cb);
      return true;
    }
    return realWrite.call(this, chunk, ...rest);
  };
}

// ------------------------------------------------------------------
// Import
// ------------------------------------------------------------------
function applyEnv() {
  for (const [key, value] of Object.entries(HARNESS_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** Names (never values) of env vars the import added, changed or removed. */
function envDiff(before, after) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter((k) => before[k] !== after[k]).sort();
}

/** The env vars a fake may stand in for: the service URLs, all unreachable by default. */
const FAKEABLE = Object.keys(HARNESS_ENV).filter((key) => HARNESS_ENV[key] === UNREACHABLE_URL);

function listenOnLoopback(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

/**
 * Serve each fake on its own loopback port and point its env var there.
 * @param {Record<string, http.RequestListener>|undefined} fakes Keyed by a
 *   HARNESS_ENV service URL name (SUPABASE_URL, GROQ_BASE_URL, …).
 * @returns {Promise<Array<{name: string, server: http.Server, port: number}>>}
 */
async function serveFakes(fakes) {
  const served = [];
  for (const [name, handler] of Object.entries(fakes || {})) {
    if (!FAKEABLE.includes(name)) throw new Error(`the harness has no service URL called ${name}`);
    if (typeof handler !== 'function') throw new Error(`the fake for ${name} is not a request handler`);
    const server = http.createServer(handler);
    const port = await listenOnLoopback(server);
    servingPorts.add(port);
    process.env[name] = `http://127.0.0.1:${port}`;
    served.push({ name, server, port });
  }
  return served;
}

let loaded = null;

async function loadApp({ fakes } = {}) {
  applyEnv();
  installNetworkGuard();
  installDotenvTripwire();
  captureServerLogs();
  const fakeServers = await serveFakes(fakes);

  const listensDuringImport = [];
  const realListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function harnessRefusedListen(...args) {
    listensDuringImport.push(typeof args[0] === 'object' ? JSON.stringify(args[0]) : String(args[0]));
    return this;
  };

  const before = { ...process.env };
  let mod;
  try {
    mod = await import(pathToFileURL(SERVER_ENTRY).href);
  } finally {
    net.Server.prototype.listen = realListen;
  }
  const envChangedByImport = envDiff(before, { ...process.env });

  return { app: mod.default, envChangedByImport, listensDuringImport, fakeServers };
}

function request(port, method, urlPath, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        agent: false,
        headers: { 'content-length': Buffer.byteLength(payload), ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

/**
 * Import the app (once per process) and serve it on an ephemeral loopback
 * port. Call close() when done.
 * @param {{ fakes?: Record<string, http.RequestListener> }} [options] Fake
 *   services, by the env var that points at them (see the header). Only the
 *   first call in a process imports the app, so only its fakes count; close()
 *   stops them.
 */
export async function startHarness(options = {}) {
  if (!loaded) loaded = loadApp(options);
  const { app, envChangedByImport, listensDuringImport, fakeServers } = await loaded;

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  servingPorts.add(port);

  return {
    app,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    /** @returns {Promise<{status: number, headers: object, body: string}>} */
    request: (method, urlPath, { headers, body } = {}) => request(port, method, urlPath, headers, body),
    blocked,
    dotenvCalls,
    logs,
    envChangedByImport,
    listensDuringImport,
    resetBlocked() {
      blocked.length = 0;
    },
    async close() {
      servingPorts.delete(port);
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      for (const fake of fakeServers.splice(0)) {
        servingPorts.delete(fake.port);
        fake.server.closeAllConnections?.();
        await new Promise((resolve) => fake.server.close(resolve));
      }
    },
  };
}
