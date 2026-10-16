/**
 * CLAUDE.md rule 4: the Dodo webhook is registered before express.json().
 *
 * Signature verification needs the exact bytes Dodo signed. body-parser marks
 * a request parsed and skips it thereafter, so if a JSON parser that matches
 * /api/webhook runs first, the raw parser gets nothing and every real webhook
 * fails verification. That only shows in production, where real webhooks
 * arrive, so the order is checked here in the app's actual router stack.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { startHarness } from '../server/harness.js';

const BODY_PARSERS = new Set(['jsonParser', 'urlencodedParser', 'textParser', 'rawParser']);

const harness = await startHarness();
test.after(() => harness.close());

const stack = harness.app._router.stack;

/** Does this middleware layer run for a request to `path`? */
function runsFor(layer, path) {
  return Boolean(layer.regexp.fast_slash || layer.regexp.test(path));
}

const webhookIndex = stack.findIndex(
  (layer) => layer.route?.path === '/api/webhook' && layer.route.methods.post,
);

test('POST /api/webhook is registered', () => {
  assert.ok(webhookIndex >= 0, 'no POST /api/webhook route in the router stack');
});

test('the webhook route parses its body with express.raw()', () => {
  const handlers = stack[webhookIndex].route.stack.map((layer) => layer.handle.name);
  assert.equal(handlers[0], 'rawParser', `the route's first handler is ${handlers[0]}, not express.raw()`);
  assert.ok(handlers.length >= 2, 'the route has no handler after its parser');
});

test('the webhook comes before the global express.json()', () => {
  const globalJson = stack.findIndex((layer) => !layer.route && layer.name === 'jsonParser' && layer.regexp.fast_slash);
  assert.ok(globalJson >= 0, 'no global express.json() found');
  assert.ok(
    webhookIndex < globalJson,
    `POST /api/webhook is layer ${webhookIndex}, after the global express.json() at layer ${globalJson}`,
  );
});

test('no body parser runs for /api/webhook ahead of the route', () => {
  const ahead = stack
    .slice(0, webhookIndex)
    .map((layer, i) => ({ layer, i }))
    .filter(({ layer }) => !layer.route && BODY_PARSERS.has(layer.name) && runsFor(layer, '/api/webhook'))
    .map(({ layer, i }) => `${layer.name} at layer ${i}`);
  assert.deepEqual(ahead, []);
});
