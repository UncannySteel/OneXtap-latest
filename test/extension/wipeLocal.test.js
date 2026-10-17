/**
 * ONEXTAP_WIPE_LOCAL (extension/messages/wipeLocal.js): after DELETE
 * /api/account succeeds, the dashboard asks the extension to drop its local
 * copy. docs/extension-protocol.md, "The wipe".
 *
 * The handler through the registry, with the three kinds of sender, and once
 * through extension/background.js itself.
 */
import test, { before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Plain imports: the registry reaches src/ only for src/localKeys.js, a leaf
// (test/extension/workerImports.test.js). Without Vite's import.meta.env the
// list has no session key; localKeys.test.js covers that one.
import { LOCAL_KEYS } from '../../src/localKeys.js';
import { dispatch, CAPABILITIES } from '../../extension/messages/registry.js';
import { allowedOrigins } from '../../extension/messages/senders.js';
import wipeLocal from '../../extension/messages/wipeLocal.js';
import { canLoadViteModules } from './viteModules.js';
import { EXTENSION_ID, MANIFEST, SITE, POPUP, CONTENT, loadWorker } from './fakeWorker.js';

const quiet = { error() {}, warn() {}, info() {}, debug() {} };

/** chrome.storage.local over a plain object, as the worker sees it. */
function fakeChrome(store) {
  return {
    runtime: { id: EXTENSION_ID, getManifest: () => structuredClone(MANIFEST) },
    storage: {
      local: {
        async get(keys) {
          const list = keys == null ? Object.keys(store) : [].concat(keys);
          return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
        },
        async set(items) { Object.assign(store, structuredClone(items)); },
        async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
      },
    },
  };
}

/** Everything Onextap keeps, plus a key of nobody's. */
function fullStore() {
  const store = Object.fromEntries(LOCAL_KEYS.map((k) => [k, { planted: k }]));
  store.not_onextaps = 'stays';
  return store;
}

const contextFor = (store) => ({
  chrome: fakeChrome(store),
  log: quiet,
  runtimeId: EXTENSION_ID,
  origins: allowedOrigins(MANIFEST),
});

test('it is the site\'s message, and it reports the wipe-local capability', () => {
  assert.equal(wipeLocal.kind, 'ONEXTAP_WIPE_LOCAL');
  assert.deepEqual(wipeLocal.from, ['site']);
  assert.equal(wipeLocal.capability, 'wipe-local');
  assert.ok(CAPABILITIES.includes('wipe-local'));
});

test('from the site: every key on the list goes, and the reply names the ones that were there', async () => {
  const store = fullStore();
  const reply = await dispatch({ type: 'ONEXTAP_WIPE_LOCAL' }, SITE, 'external', contextFor(store));
  assert.equal(reply.success, true);
  assert.deepEqual([...reply.removed].sort(), [...LOCAL_KEYS].sort());
  assert.deepEqual(store, { not_onextaps: 'stays' });
});

test('only what was there is reported; nothing there is still a success', async () => {
  const store = { onextap_profiles: { profiles: {} }, not_onextaps: 'stays' };
  assert.deepEqual(await dispatch({ action: 'ONEXTAP_WIPE_LOCAL' }, SITE, 'external', contextFor(store)),
    { success: true, removed: ['onextap_profiles'] });
  assert.deepEqual(await dispatch({ type: 'ONEXTAP_WIPE_LOCAL' }, SITE, 'external', contextFor(store)),
    { success: true, removed: [] });
  assert.deepEqual(store, { not_onextaps: 'stays' });
});

test('refused from the popup, the content script and a page off the list: nothing is removed', async () => {
  const evil = { url: 'https://evil.example/', origin: 'https://evil.example', tab: { id: 9 } };
  for (const [sender, channel] of [[POPUP, 'internal'], [CONTENT, 'internal'], [evil, 'external']]) {
    const store = fullStore();
    assert.deepEqual(await dispatch({ type: 'ONEXTAP_WIPE_LOCAL' }, sender, channel, contextFor(store)),
      { success: false, error: 'Not accepted from this sender: ONEXTAP_WIPE_LOCAL' });
    assert.deepEqual(store, fullStore());
  }
});

test('a storage failure is a reply, not a silence', async () => {
  const context = contextFor(fullStore());
  context.chrome.storage.local.remove = async () => { throw new Error('storage is gone'); };
  assert.deepEqual(await dispatch({ type: 'ONEXTAP_WIPE_LOCAL' }, SITE, 'external', context),
    { success: false, error: 'storage is gone' });
});

test('an install updated from store 1.0.2: its user_profile and its tour flag go too', async () => {
  // What 1.0.2's popup left in chrome.storage.local (its dark-mode switch lived
  // in the popup page's own localStorage, which no worker can reach).
  const store = { user_profile: { firstName: 'Ada', vault: [] }, onextap_tutorial_seen: true };
  const reply = await dispatch({ type: 'ONEXTAP_WIPE_LOCAL' }, SITE, 'external', contextFor(store));
  assert.equal(reply.success, true);
  assert.deepEqual([...reply.removed].sort(), ['onextap_tutorial_seen', 'user_profile']);
  assert.deepEqual(store, {});
});

// ---------- Through the worker ----------

// background.js reads import.meta.env, so it loads through the Vite hooks.
const skip = canLoadViteModules ? false : 'needs module.registerHooks (Node 22.15+)';
let worker;

before(async () => {
  if (skip) return;
  mock.method(console, 'error', () => {});
  mock.method(console, 'warn', () => {});
  worker = await loadWorker();
  // fakeWorker.js's storage has no remove(); the wipe is the first message to need one.
  globalThis.chrome.storage.local.remove = async (keys) => {
    for (const k of [].concat(keys)) delete worker.state.store[k];
  };
});
beforeEach(() => worker?.reset());

test('through background.js: a profile synced from the site, then wiped from the site', { skip }, async () => {
  assert.deepEqual(await worker.external({ type: 'ONEXTAP_SYNC_DATA', payload: { firstName: 'Ada' } }, SITE), { success: true });
  assert.ok(worker.state.store.onextap_profiles);
  worker.state.store.onextap_resumes = { resumes: {}, activeResumeId: null };

  const reply = await worker.external({ type: 'ONEXTAP_WIPE_LOCAL' }, SITE);
  assert.equal(reply.success, true);
  assert.deepEqual([...reply.removed].sort(), ['onextap_profiles', 'onextap_resumes', 'user_profile']);
  assert.deepEqual(worker.state.store, {});
});

test('ONEXTAP_HELLO now reports wipe-local', { skip }, async () => {
  const hello = await worker.external({ type: 'ONEXTAP_HELLO' }, SITE);
  assert.ok(hello.capabilities.includes('wipe-local'));
});
