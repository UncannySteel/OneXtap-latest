/**
 * Route inventory: every [method, path] the app serves is listed in
 * routes.snapshot.json, and each one still answers through the real app.
 *
 * Guards a split of server/index.js. Moving routes into routers is fine; losing
 * one is not, and neither is adding one without saying so. The probes send no
 * body and no credentials, so every handler stops at its own validation or
 * auth check (400/401/405/500 all count) and none reaches an outside service,
 * which the last assertion of the probe test checks.
 *
 * Deliberate change: UPDATE_ROUTE_SNAPSHOT=1 node --test test/rules/routes.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { startHarness, serverRequire } from '../server/harness.js';

const SNAPSHOT = fileURLToPath(new URL('./routes.snapshot.json', import.meta.url));

/** The static path a router layer is mounted at, read back from its regexp. */
function mountPath(layer) {
  if (layer.regexp.fast_slash) return '';
  // path-to-regexp 0.1 (Express 4) compiles app.use('/a/b', r) to ^\/a\/b\/?(?=\/|$)
  const m = /^\^((?:\\\/[\w.-]+)+)\\\/\?\(\?=\\\/\|\$\)$/.exec(layer.regexp.source);
  if (!m) throw new Error(`cannot read the mount path of a router layer: /${layer.regexp.source}/`);
  return m[1].replace(/\\\//g, '/');
}

/** Every [METHOD, path] in an Express 4 router stack, nested routers included, sorted. */
function listRoutes(stack, prefix = '') {
  const out = [];
  for (const layer of stack) {
    if (layer.route) {
      const routePath = layer.route.path;
      if (typeof routePath !== 'string') throw new Error(`non-string route path under ${prefix || '/'}`);
      for (const method of Object.keys(layer.route.methods)) {
        out.push([method === '_all' ? 'ALL' : method.toUpperCase(), prefix + routePath]);
      }
    } else if (layer.name === 'router' && Array.isArray(layer.handle?.stack)) {
      out.push(...listRoutes(layer.handle.stack, prefix + mountPath(layer)));
    }
  }
  // Code-unit order, not localeCompare: the snapshot must sort the same on
  // every machine and ICU build.
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  return out.sort((a, b) => cmp(a[1], b[1]) || cmp(a[0], b[0]));
}

const harness = await startHarness();
test.after(() => harness.close());

const live = listRoutes(harness.app._router.stack);

if (process.env.UPDATE_ROUTE_SNAPSHOT === '1') {
  // One route per line, so a diff of this file reads as a list of routes.
  const note = 'Every [method, path] server/index.js serves. Checked by test/rules/routes.test.js; regenerate with UPDATE_ROUTE_SNAPSHOT=1.';
  const rows = live.map((route) => `    ${JSON.stringify(route)}`).join(',\n');
  writeFileSync(SNAPSHOT, `{\n  "note": ${JSON.stringify(note)},\n  "routes": [\n${rows}\n  ]\n}\n`);
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')).routes;

test('listRoutes reads nested routers back to their full path', () => {
  const express = serverRequire('express');
  const app = express();
  const inner = express.Router();
  inner.get('/deep', (_req, res) => res.end());
  const outer = express.Router();
  outer.post('/x', (_req, res) => res.end());
  outer.use('/inner', inner);
  app.use('/api/outer', outer);
  app.get('/api/top', (_req, res) => res.end());
  app.use(express.json());

  assert.deepEqual(listRoutes(app._router.stack), [
    ['GET', '/api/outer/inner/deep'],
    ['POST', '/api/outer/x'],
    ['GET', '/api/top'],
  ]);
});

test('the router stack matches routes.snapshot.json', () => {
  assert.ok(live.length >= 15, `expected the app's routes, found ${live.length}`);
  assert.deepEqual(
    live,
    snapshot,
    'the served routes changed; if that is deliberate, regenerate with UPDATE_ROUTE_SNAPSHOT=1',
  );
});

test('every snapshot route answers something other than 404, without reaching outside', async () => {
  harness.resetBlocked();
  const missing = [];
  for (const [method, routePath] of snapshot) {
    const res = await harness.request(method === 'ALL' ? 'GET' : method, routePath);
    if (res.status === 404) missing.push(`${method} ${routePath}`);
  }
  assert.deepEqual(missing, [], 'these routes answered 404');
  assert.deepEqual(harness.blocked, [], 'a probe got as far as an outside call');
});

test('an unknown /api path answers 404', async () => {
  for (const method of ['GET', 'POST']) {
    const res = await harness.request(method, '/api/__no_such_route__');
    assert.equal(res.status, 404, `${method} /api/__no_such_route__`);
  }
});
