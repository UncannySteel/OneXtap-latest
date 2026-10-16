/**
 * The worker's registry and its sender checks (docs/extension-protocol.md):
 * who may send which message, ONEXTAP_HELLO, and the allowlist read from the
 * manifest. The replies of 1.0.2's four messages are workerCompat.test.js's.
 */
import test, { before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { MESSAGES, CAPABILITIES, dispatch, kindOf } from '../../extension/messages/registry.js';
import { allowedOrigins, isAllowedOrigin, senderKind } from '../../extension/messages/senders.js';
import { canLoadViteModules } from './viteModules.js';
import { loadWorker, MANIFEST, EXTENSION_ID, SITE, POPUP, CONTENT } from './fakeWorker.js';

const quiet = { error() {}, warn() {}, info() {}, debug() {} };
const self = { runtimeId: EXTENSION_ID, origins: allowedOrigins(MANIFEST) };

// ---------- The registry ----------

test('the registry holds 1.0.2\'s four messages and ONEXTAP_HELLO, once each', () => {
  assert.deepEqual(MESSAGES.map((m) => m.kind).sort(), [
    'GENERATE_IMPROVED_ANSWER', 'ONEXTAP_HELLO', 'ONEXTAP_SYNC_DATA', 'PARSE_RESUME', 'SCRAPE_ACTIVE_TAB',
  ]);
});

test('every message names its senders from the three kinds, and has a handler', () => {
  for (const m of MESSAGES) {
    assert.ok(Array.isArray(m.from) && m.from.length > 0, m.kind);
    assert.ok(m.from.every((s) => ['site', 'popup', 'content'].includes(s)), m.kind);
    assert.equal(typeof m.handle, 'function', m.kind);
  }
});

test('who may send what, as the protocol says', () => {
  const from = Object.fromEntries(MESSAGES.map((m) => [m.kind, [...m.from].sort()]));
  assert.deepEqual(from, {
    ONEXTAP_SYNC_DATA: ['site'],
    PARSE_RESUME: ['site'],
    SCRAPE_ACTIVE_TAB: ['popup', 'site'],
    GENERATE_IMPROVED_ANSWER: ['popup'],
    ONEXTAP_HELLO: ['popup', 'site'],
  });
});

test('the capabilities are the ones that work in this build: profile sync, not yet the handoff or the wipe', () => {
  assert.deepEqual([...CAPABILITIES], ['profile-sync']);
});

test('the kind is `type` or `action`', () => {
  assert.equal(kindOf({ type: 'A' }), 'A');
  assert.equal(kindOf({ action: 'B' }), 'B');
  assert.equal(kindOf(null), undefined);
  assert.equal(kindOf('ONEXTAP_HELLO'), undefined);
});

test('a message from B3 is not answered yet: "Unknown action"', async () => {
  for (const kind of ['OPEN_COVER_CUSTOMIZER', 'GET_COVER_HANDOFF', 'ONEXTAP_WIPE_LOCAL', 'MOUNT_COVER_BUTTON']) {
    assert.deepEqual(await dispatch({ type: kind }, SITE, 'external', { ...self, log: quiet }),
      { success: false, error: `Unknown action: ${kind}` });
  }
});

test('a name off Object.prototype is just unknown', async () => {
  for (const kind of ['constructor', '__proto__', 'toString']) {
    assert.deepEqual(await dispatch({ type: kind }, SITE, 'external', { ...self, log: quiet }),
      { success: false, error: `Unknown action: ${kind}` });
  }
});

test('a handler that throws still gets a reply', async () => {
  const context = { ...self, log: quiet, chrome: { runtime: { getManifest() { throw new Error('boom'); } } } };
  assert.deepEqual(await dispatch({ type: 'ONEXTAP_HELLO' }, SITE, 'external', context), { success: false, error: 'boom' });
});

// ---------- Senders ----------

test('the allowlist is the manifest\'s externally_connectable origins', () => {
  for (const origin of ['https://www.onextap.com', 'https://onextap.com', 'http://localhost:5173']) {
    assert.equal(isAllowedOrigin(origin, self.origins), true, origin);
  }
  for (const origin of ['http://www.onextap.com', 'https://evil.example', 'https://onextap.com.evil.example',
    'https://sub.onextap.com', 'http://localhost:5174', 'http://127.0.0.1:5173', 'null', '']) {
    assert.equal(isAllowedOrigin(origin, self.origins), false, origin);
  }
});

test('a release manifest without localhost entries refuses localhost, with no change in the worker', () => {
  const release = structuredClone(MANIFEST);
  release.externally_connectable.matches = release.externally_connectable.matches.filter((m) => !m.includes('localhost'));
  const origins = allowedOrigins(release);
  assert.equal(isAllowedOrigin('http://localhost:5173', origins), false);
  assert.equal(isAllowedOrigin('https://www.onextap.com', origins), true);
  assert.equal(senderKind({ origin: 'http://localhost:5173', url: 'http://localhost:5173/dashboard/' }, 'external',
    { runtimeId: EXTENSION_ID, origins }), null);
});

test('match patterns: a wildcard subdomain, a wildcard scheme, a pattern without a port', () => {
  const origins = allowedOrigins({ externally_connectable: { matches: ['https://*.example.com/*', '*://example.org/*', 'junk'] } });
  assert.equal(isAllowedOrigin('https://a.example.com', origins), true);
  assert.equal(isAllowedOrigin('https://example.com', origins), true);
  assert.equal(isAllowedOrigin('https://badexample.com', origins), false);
  assert.equal(isAllowedOrigin('http://example.org:8080', origins), true);
  assert.equal(isAllowedOrigin('ftp://example.org', origins), false);
  assert.deepEqual(allowedOrigins({}), []);
});

test('sender kinds: the popup, the content script, the site', () => {
  assert.equal(senderKind(POPUP, 'internal', self), 'popup');
  // The popup opened in a tab is still the popup.
  assert.equal(senderKind({ ...POPUP, tab: { id: 3 } }, 'internal', self), 'popup');
  assert.equal(senderKind(CONTENT, 'internal', self), 'content');
  assert.equal(senderKind(SITE, 'external', self), 'site');
  // Chrome without sender.origin: the url's origin.
  assert.equal(senderKind({ url: SITE.url }, 'external', self), 'site');
});

test('senders this build does not know', () => {
  // Internal, but not this extension.
  assert.equal(senderKind({ ...POPUP, id: 'ponmlkjihgfedcbaponmlkjihgfedcba' }, 'internal', self), null);
  // Internal, ours, but neither one of our pages nor in a tab.
  assert.equal(senderKind({ id: EXTENSION_ID }, 'internal', self), null);
  // External from another extension.
  assert.equal(senderKind({ id: 'ponmlkjihgfedcbaponmlkjihgfedcba', origin: 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba' }, 'external', self), null);
  // External from an origin off the list, and with no origin at all.
  assert.equal(senderKind({ origin: 'https://evil.example', url: 'https://evil.example/' }, 'external', self), null);
  assert.equal(senderKind({}, 'external', self), null);
  assert.equal(senderKind(undefined, 'external', self), null);
  assert.equal(senderKind(SITE, 'sideways', self), null);
});

// ---------- Through the worker ----------

const skip = canLoadViteModules ? false : 'needs module.registerHooks (Node 22.15+)';
let worker;

before(async () => {
  if (skip) return;
  mock.method(console, 'error', () => {});
  mock.method(console, 'warn', () => {});
  worker = await loadWorker();
});
beforeEach(() => worker?.reset());

test('ONEXTAP_HELLO from the site: the manifest\'s version, protocol 2, the capabilities', { skip }, async () => {
  assert.deepEqual(await worker.external({ type: 'ONEXTAP_HELLO' }, SITE),
    { success: true, version: MANIFEST.version, protocol: 2, capabilities: ['profile-sync'] });
});

test('ONEXTAP_HELLO from the popup too: getExtensionInfo() runs there', { skip }, async () => {
  assert.deepEqual(await worker.internal({ action: 'ONEXTAP_HELLO' }, POPUP),
    { success: true, version: MANIFEST.version, protocol: 2, capabilities: ['profile-sync'] });
});

test('a refusal is never "Unknown action", so the website cannot take a current build for 1.0.2', { skip }, async () => {
  const reply = await worker.internal({ type: 'ONEXTAP_HELLO' }, CONTENT);
  assert.deepEqual(reply, { success: false, error: 'Not accepted from this sender: ONEXTAP_HELLO' });
  assert.doesNotMatch(reply.error, /^Unknown action/);
});

test('the content script may not sync a profile, and nothing is written', { skip }, async () => {
  assert.deepEqual(await worker.internal({ type: 'ONEXTAP_SYNC_DATA', payload: { firstName: 'Mallory' } }, CONTENT),
    { success: false, error: 'Not accepted from this sender: ONEXTAP_SYNC_DATA' });
  assert.deepEqual(worker.state.store, {});
});

test('the site may not generate through the worker: nothing reaches the API', { skip }, async () => {
  assert.deepEqual(await worker.external({ type: 'GENERATE_IMPROVED_ANSWER', data: { token: 't' } }, SITE),
    { success: false, error: 'Not accepted from this sender: GENERATE_IMPROVED_ANSWER' });
  assert.equal(worker.state.fetches.length, 0);
});

test('PARSE_RESUME and SCRAPE_ACTIVE_TAB are refused from the content script', { skip }, async () => {
  for (const type of ['PARSE_RESUME', 'SCRAPE_ACTIVE_TAB']) {
    assert.deepEqual(await worker.internal({ type, data: {} }, CONTENT),
      { success: false, error: `Not accepted from this sender: ${type}` });
  }
  assert.equal(worker.state.fetches.length, 0);
  assert.equal(worker.state.scripts.length, 0);
});

test('an origin off the manifest\'s list is refused, whatever it sends', { skip }, async () => {
  const evil = { url: 'https://evil.example/', origin: 'https://evil.example', tab: { id: 9 } };
  for (const type of ['ONEXTAP_HELLO', 'ONEXTAP_SYNC_DATA', 'PARSE_RESUME', 'SCRAPE_ACTIVE_TAB']) {
    const reply = await worker.external({ type, payload: { firstName: 'x' }, data: {} }, evil);
    assert.deepEqual(reply, { success: false, error: `Not accepted from this sender: ${type}` });
  }
  assert.deepEqual(worker.state.store, {});
  assert.equal(worker.state.fetches.length, 0);
});

test('the site on localhost:5173 is accepted while the manifest lists it', { skip }, async () => {
  const local = { url: 'http://localhost:5173/dashboard/', origin: 'http://localhost:5173', tab: { id: 2 } };
  assert.equal((await worker.external({ type: 'ONEXTAP_HELLO' }, local)).success, true);
});
