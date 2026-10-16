/**
 * src/extensionClient.js, the website's and the popup's side of the protocol
 * (docs/extension-protocol.md): which extension to address
 * (resolveExtensionId, completion plan item 29), what is installed
 * (getExtensionInfo: current / legacy / absent), and what a profile sync
 * achieved. Run with `chrome` absent (the website without the extension),
 * as a web page sees it, and inside the extension.
 */
import test, { before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { canLoadViteModules, registerViteModules } from './viteModules.js';

const skip = canLoadViteModules ? false : 'needs module.registerHooks (Node 22.15+)';
const STORE_ID = 'fpleipjggoiolomkcnchnlelbjcnoklj';
const UNPACKED_ID = 'abcdefghijklmnopabcdefghijklmnop';
const OTHER_ID = 'ponmlkjihgfedcbaponmlkjihgfedcba';

let client;
before(async () => {
  if (skip) return;
  registerViteModules();
  client = await import('../../src/extensionClient.js');
});

afterEach(() => {
  delete globalThis.chrome;
  delete globalThis.window;
  mock.timers.reset();
});

/** The page at `href`, as `window.location` reports it. */
const at = (href) => { globalThis.window = { location: new URL(href) }; };

const NEVER = Symbol('never answers');

/**
 * `chrome.runtime` as a page or the popup sees it. `answer(msg, id)` returns
 * the reply, `{ lastError }`, NEVER, or throws (as sendMessage does for a
 * malformed id). `id` is null for the one-argument form.
 */
function installChrome(answer, { runtimeId } = {}) {
  const sent = [];
  const runtime = {
    lastError: undefined,
    sendMessage(...args) {
      const callback = args.pop();
      const msg = args.pop();
      const id = args.length ? args[0] : null;
      sent.push({ id, msg });
      const out = answer(msg, id);
      if (out === NEVER) return;
      queueMicrotask(() => {
        if (out && out.lastError) {
          runtime.lastError = { message: out.lastError };
          callback(undefined);
          runtime.lastError = undefined;
        } else {
          callback(out);
        }
      });
    },
  };
  if (runtimeId) runtime.id = runtimeId;
  globalThis.chrome = { runtime };
  return sent;
}

const CURRENT_HELLO = { success: true, version: '1.0.4', protocol: 2, capabilities: ['profile-sync'] };
const LEGACY_HELLO = { success: false, error: 'Unknown action: ONEXTAP_HELLO' };

/** An extension that answers HELLO with `hello` and the sync with `sync`. */
const extension = (hello, sync = { success: true }) => (msg) =>
  (msg.type === 'ONEXTAP_HELLO' || msg.action === 'ONEXTAP_HELLO' ? hello : sync);

// ---------- resolveExtensionId (item 29) ----------

test('the live site always messages the store build, whatever ?extensionId= says', { skip }, () => {
  for (const href of [
    `https://www.onextap.com/dashboard/?extensionId=${OTHER_ID}`,
    `https://onextap.com/dashboard/?view=cover&extensionId=${OTHER_ID}`,
    `https://onextap-git-preview.vercel.app/dashboard/?extensionId=${OTHER_ID}`,
    'https://www.onextap.com/dashboard/',
  ]) {
    at(href);
    assert.equal(client.resolveExtensionId(), STORE_ID, href);
  }
});

test('on localhost and 127.0.0.1 the parameter wins, for unpacked builds', { skip }, () => {
  at(`http://localhost:5173/dashboard/?extensionId=${UNPACKED_ID}&view=profiles`);
  assert.equal(client.resolveExtensionId(), UNPACKED_ID);
  at(`http://127.0.0.1:5173/dashboard/?extensionId=${UNPACKED_ID}`);
  assert.equal(client.resolveExtensionId(), UNPACKED_ID);
});

test('on localhost, no parameter or one that is not an extension ID means the store build', { skip }, () => {
  for (const query of ['', '?extensionId=', '?extensionId=not-an-id', `?extensionId=${UNPACKED_ID.toUpperCase()}`]) {
    at(`http://localhost:5173/dashboard/${query}`);
    assert.equal(client.resolveExtensionId(), STORE_ID, query);
  }
});

test('with no window at all (Node), the store build', { skip }, () => {
  assert.equal(client.resolveExtensionId(), STORE_ID);
});

test('inside an unpacked extension it addresses itself, never the store build', { skip }, () => {
  at(`chrome-extension://${UNPACKED_ID}/index.html?extensionId=${OTHER_ID}`);
  installChrome(() => CURRENT_HELLO, { runtimeId: UNPACKED_ID });
  assert.equal(client.resolveExtensionId(), UNPACKED_ID);
});

// ---------- getExtensionInfo ----------

test('absent with no chrome global at all, at once, sending nothing', { skip }, async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  assert.deepEqual(await client.getExtensionInfo(), { state: 'absent', version: null, protocol: null, capabilities: [] });
});

test('absent when chrome has no runtime messaging (a page no extension connects to)', { skip }, async () => {
  globalThis.chrome = { runtime: {} };
  assert.equal((await client.getExtensionInfo()).state, 'absent');
  globalThis.chrome = {};
  assert.equal((await client.getExtensionInfo()).state, 'absent');
});

test('current: ONEXTAP_HELLO answered, with the version and capabilities, from the resolved extension', { skip }, async () => {
  at('https://www.onextap.com/dashboard/');
  const sent = installChrome(() => CURRENT_HELLO);
  assert.deepEqual(await client.getExtensionInfo(),
    { state: 'current', version: '1.0.4', protocol: 2, capabilities: ['profile-sync'] });
  assert.deepEqual(sent, [{ id: STORE_ID, msg: { type: 'ONEXTAP_HELLO' } }]);
});

test('legacy: store 1.0.2 says "Unknown action"', { skip }, async () => {
  at('https://www.onextap.com/dashboard/');
  installChrome(() => LEGACY_HELLO);
  assert.deepEqual(await client.getExtensionInfo(), { state: 'legacy', version: null, protocol: null, capabilities: [] });
});

test('absent: chrome.runtime.lastError (not installed, or not reachable)', { skip }, async () => {
  at('https://www.onextap.com/dashboard/');
  installChrome(() => ({ lastError: 'Could not establish connection. Receiving end does not exist.' }));
  assert.equal((await client.getExtensionInfo()).state, 'absent');
});

test('absent: sendMessage throws', { skip }, async () => {
  at('https://www.onextap.com/dashboard/');
  installChrome(() => { throw new Error('Invalid extension id'); });
  assert.equal((await client.getExtensionInfo()).state, 'absent');
});

test('absent after 1.5 s with no reply, not before', { skip }, async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  at('https://www.onextap.com/dashboard/');
  installChrome(() => NEVER);
  let info = null;
  client.getExtensionInfo().then((i) => { info = i; });
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  mock.timers.tick(1499);
  await settle();
  assert.equal(info, null, 'still waiting at 1499 ms');
  mock.timers.tick(1);
  await settle();
  assert.equal(info?.state, 'absent');
  assert.equal(client.EXTENSION_INFO_TIMEOUT_MS, 1500);
});

test('a late reply after the timeout changes nothing', { skip }, async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  at('https://www.onextap.com/dashboard/');
  let late;
  globalThis.chrome = { runtime: { sendMessage: (_id, _msg, cb) => { late = cb; } } };
  const pending = client.getExtensionInfo();
  mock.timers.tick(1500);
  late(CURRENT_HELLO);
  assert.equal((await pending).state, 'absent');
});

test('any other reply is absent: a refusal, nothing, a success without a version', { skip }, async () => {
  at('https://www.onextap.com/dashboard/');
  for (const reply of [undefined, null, {}, { success: false, error: 'Not accepted from this sender: ONEXTAP_HELLO' },
    { success: true }, 'Unknown action']) {
    installChrome(() => reply);
    assert.equal((await client.getExtensionInfo()).state, 'absent', JSON.stringify(reply));
  }
});

test('current keeps only string capabilities, and tolerates none', { skip }, () => {
  assert.deepEqual(client.classifyHello({ success: true, version: '1.0.5', capabilities: ['profile-sync', 3, null, 'wipe-local'] }),
    { state: 'current', version: '1.0.5', protocol: null, capabilities: ['profile-sync', 'wipe-local'] });
  assert.deepEqual(client.classifyHello({ success: true, version: '1.0.5', protocol: 2 }).capabilities, []);
});

test('inside the extension: the one-argument sendMessage, to its own worker', { skip }, async () => {
  at(`chrome-extension://${UNPACKED_ID}/index.html`);
  const sent = installChrome(() => CURRENT_HELLO, { runtimeId: UNPACKED_ID });
  assert.equal((await client.getExtensionInfo()).state, 'current');
  assert.deepEqual(sent, [{ id: null, msg: { type: 'ONEXTAP_HELLO' } }]);
});

test('on localhost the handshake goes to ?extensionId=', { skip }, async () => {
  at(`http://localhost:5173/dashboard/?extensionId=${UNPACKED_ID}`);
  const sent = installChrome(() => CURRENT_HELLO);
  await client.getExtensionInfo();
  assert.equal(sent[0].id, UNPACKED_ID);
});

// ---------- syncProfileToExtension ----------

const PROFILE = { firstName: 'Ada', _activeProfileId: 'default' };

test('sync, current: sent, confirmed, synced', { skip }, async () => {
  at('https://www.onextap.com/dashboard/');
  const sent = installChrome(extension(CURRENT_HELLO));
  assert.deepEqual(await client.syncProfileToExtension(PROFILE), { state: 'current', synced: true, version: '1.0.4' });
  assert.deepEqual(sent.map((s) => s.msg), [{ type: 'ONEXTAP_HELLO' }, { type: 'ONEXTAP_SYNC_DATA', payload: PROFILE }]);
  assert.ok(sent.every((s) => s.id === STORE_ID));
});

test('sync, legacy: still sent (it helps a fresh install), but 1.0.2\'s success is not "synced"', { skip }, async () => {
  at('https://www.onextap.com/dashboard/');
  const sent = installChrome(extension(LEGACY_HELLO, { success: true }));
  assert.deepEqual(await client.syncProfileToExtension(PROFILE), { state: 'legacy', synced: false, version: null });
  assert.deepEqual(sent[1].msg, { type: 'ONEXTAP_SYNC_DATA', payload: PROFILE });
});

test('sync, absent: nothing sent', { skip }, async () => {
  assert.deepEqual(await client.syncProfileToExtension(PROFILE), { state: 'absent', synced: false, version: null });
  at('https://www.onextap.com/dashboard/');
  const sent = installChrome(() => ({ lastError: 'Receiving end does not exist.' }));
  assert.deepEqual(await client.syncProfileToExtension(PROFILE), { state: 'absent', synced: false, version: null });
  assert.equal(sent.length, 1, 'the handshake only');
});

test('sync, absent only because the handshake timed out: still sent (a waking worker), not synced', { skip }, async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  at('https://www.onextap.com/dashboard/');
  const sent = installChrome((msg) => (msg.type === 'ONEXTAP_HELLO' ? NEVER : { success: true }));
  const pending = client.syncProfileToExtension(PROFILE);
  mock.timers.tick(client.EXTENSION_INFO_TIMEOUT_MS);
  assert.deepEqual(await pending, { state: 'absent', synced: false, version: null });
  assert.deepEqual(sent.map((s) => s.msg.type), ['ONEXTAP_HELLO', 'ONEXTAP_SYNC_DATA']);
});

test('sync: a reply that never comes ends the wait after SYNC_TIMEOUT_MS, so a save cannot hang', { skip }, async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  at('https://www.onextap.com/dashboard/');
  installChrome(extension(CURRENT_HELLO, NEVER));
  let out = null;
  client.syncProfileToExtension(PROFILE).then((o) => { out = o; });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await settle();
  mock.timers.tick(client.SYNC_TIMEOUT_MS - 1);
  await settle();
  assert.equal(out, null, 'still waiting just before the timeout');
  mock.timers.tick(1);
  await settle();
  assert.deepEqual(out, { state: 'current', synced: false, version: '1.0.4' });
});

test('sync, current, but not confirmed: not synced', { skip }, async () => {
  at('https://www.onextap.com/dashboard/');
  for (const reply of [{ success: false, error: 'No profile payload' }, { lastError: 'The message port closed before a response was received.' }, null]) {
    installChrome(extension(CURRENT_HELLO, reply));
    assert.deepEqual(await client.syncProfileToExtension(PROFILE), { state: 'current', synced: false, version: '1.0.4' });
  }
});

test('sync, current without profile-sync: its success does not mean the popup sees it', { skip }, async () => {
  at('https://www.onextap.com/dashboard/');
  installChrome(extension({ ...CURRENT_HELLO, capabilities: [] }));
  assert.equal((await client.syncProfileToExtension(PROFILE)).synced, false);
});

// ---------- sendToExtension ----------

test('sendToExtension rejects with no chrome, as before', { skip }, async () => {
  await assert.rejects(client.sendToExtension('SCRAPE_ACTIVE_TAB'), /Extension context not available/);
});

test('sendToExtension: the reply, or the runtime error as a rejection', { skip }, async () => {
  at(`chrome-extension://${UNPACKED_ID}/index.html`);
  const sent = installChrome(() => ({ success: true, context: { company: 'Acme', description: '' } }), { runtimeId: UNPACKED_ID });
  assert.deepEqual(await client.sendToExtension('SCRAPE_ACTIVE_TAB'), { success: true, context: { company: 'Acme', description: '' } });
  assert.deepEqual(sent, [{ id: null, msg: { action: 'SCRAPE_ACTIVE_TAB' } }]);

  installChrome(() => ({ lastError: 'Receiving end does not exist.' }), { runtimeId: UNPACKED_ID });
  await assert.rejects(client.sendToExtension('SCRAPE_ACTIVE_TAB'), /Receiving end does not exist/);
});

test('getIconUrl: the extension\'s icon inside it, the site\'s outside', { skip }, () => {
  assert.equal(client.getIconUrl(), '/icon.png');
  globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://${UNPACKED_ID}/${p}` } };
  assert.equal(client.getIconUrl(), `chrome-extension://${UNPACKED_ID}/icon.png`);
});
