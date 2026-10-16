/**
 * A stand-in for the service worker's world, for the tests that load
 * extension/background.js itself: `chrome` (runtime, storage.local, tabs,
 * scripting), `self` and `fetch`, plus the three kinds of sender Chrome
 * reports. Not a test file.
 *
 * The worker registers its listeners when it is imported, so loadWorker()
 * installs the globals, imports it once, and hands back the listeners. Tests
 * then reset the state between cases with worker.reset().
 */
import { readFileSync } from 'node:fs';

import { registerViteModules } from './viteModules.js';

export const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
export const API = 'https://api.test.invalid';

/** The repo's manifest: the worker's allowlist and version come from it. */
export const MANIFEST = JSON.parse(readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));

/** The website, as Chrome reports a page on an externally_connectable origin. */
export const SITE = Object.freeze({
  url: 'https://www.onextap.com/dashboard/?view=profiles',
  origin: 'https://www.onextap.com',
  tab: { id: 41 },
  frameId: 0,
});

/** The popup (or any other page of the extension, also when opened in a tab). */
export const POPUP = Object.freeze({
  id: EXTENSION_ID,
  url: `chrome-extension://${EXTENSION_ID}/index.html`,
  origin: `chrome-extension://${EXTENSION_ID}`,
});

/** content.js, injected into a job page. */
export const CONTENT = Object.freeze({
  id: EXTENSION_ID,
  url: 'https://jobs.example.com/apply/42',
  origin: 'https://jobs.example.com',
  tab: { id: 7 },
  frameId: 0,
});

/** A JSON Response, as the API sends it. */
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-test' },
  });
}

function makeState() {
  return {
    store: {},
    tabs: [{ id: 7, url: 'https://jobs.example.com/apply/42' }],
    scriptResult: [{ result: { company: 'Acme', description: 'Build payment systems.' } }],
    scripts: [],
    fetches: [],
    respond: () => json({}),
  };
}

let loaded = null;

/**
 * Import extension/background.js under the fake globals (once per process).
 * @returns {Promise<{ state: object, reset(): void,
 *   internal(msg, sender?): Promise<any>, external(msg, sender?): Promise<any> }>}
 */
export async function loadWorker() {
  if (loaded) return loaded;
  registerViteModules();

  let state = makeState();
  const listeners = {};
  globalThis.self = { addEventListener() {} };
  globalThis.fetch = async (url, init) => {
    state.fetches.push({ url: String(url), init });
    return state.respond(String(url), init);
  };
  globalThis.chrome = {
    runtime: {
      id: EXTENSION_ID,
      getManifest: () => structuredClone(MANIFEST),
      onInstalled: { addListener() {} },
      onMessage: { addListener: (fn) => { listeners.internal = fn; } },
      onMessageExternal: { addListener: (fn) => { listeners.external = fn; } },
    },
    storage: {
      local: {
        async get(keys) {
          const list = keys == null ? Object.keys(state.store) : [].concat(keys);
          return Object.fromEntries(list.filter((k) => k in state.store).map((k) => [k, structuredClone(state.store[k])]));
        },
        async set(items) {
          Object.assign(state.store, structuredClone(items));
        },
      },
    },
    tabs: { query: async () => state.tabs },
    scripting: {
      async executeScript(options) {
        state.scripts.push(options);
        if (state.scriptResult instanceof Error) throw state.scriptResult;
        return state.scriptResult;
      },
    },
  };

  await import('../../extension/background.js');

  /** One message through a registered listener, resolved with its reply. */
  const send = (channel) => (msg, sender) => new Promise((resolve, reject) => {
    const listener = listeners[channel];
    if (!listener) return reject(new Error(`the worker registered no ${channel} listener`));
    const keepOpen = listener(msg, sender, resolve);
    if (keepOpen !== true) reject(new Error(`the ${channel} listener must return true to answer asynchronously`));
  });

  loaded = {
    get state() { return state; },
    reset() { state = makeState(); },
    internal: send('internal'),
    external: send('external'),
  };
  return loaded;
}
