import { CHROME_WEB_STORE_URL, EXTENSION_ID_FALLBACK } from './config';
import { log as baseLog } from './logger';

const log = baseLog.child('extension');

/**
 * Extension Client Helpers
 *
 * The one bridge from the popup and the website to the extension's service
 * worker. The same code runs with `chrome.*` present (the popup, and a web
 * page an installed extension lists as externally_connectable) and absent
 * (the website without the extension, Node tests), so every touch of
 * `chrome` is guarded and falls back to a plain web value.
 *
 * The protocol, and what each extension version answers, is
 * docs/extension-protocol.md.
 */
export function openChromeWebStore() {
  window.open(CHROME_WEB_STORE_URL, '_blank', 'noopener,noreferrer');
}

/**
 * True inside the extension's own pages. `chrome.runtime.id` exists only
 * there, never on a web page, even one the extension can message.
 */
function insideExtension() {
  return typeof chrome !== 'undefined' && !!chrome?.runtime?.id;
}

/** True when the extension's messaging API is reachable from this surface. */
export function hasExtensionRuntime() {
  return typeof chrome !== 'undefined' && !!chrome?.runtime?.sendMessage;
}

/** Chrome extension IDs: 32 letters a–p. */
const EXTENSION_ID_SHAPE = /^[a-p]{32}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * The extension this surface talks to (completion plan item 29).
 *
 *   - Inside the extension: itself, `chrome.runtime.id`. Never the store's ID:
 *     an unpacked popup that messaged it would be talking to another
 *     extension.
 *   - The website on localhost or 127.0.0.1: `?extensionId=` when it is an
 *     extension ID (an unpacked build passes its own when its popup opens the
 *     dashboard), else the store's.
 *   - The website anywhere else: always the store's, EXTENSION_ID_FALLBACK,
 *     whatever `?extensionId=` says. A link cannot point the live site at
 *     another extension.
 *
 * @returns {string}
 */
export function resolveExtensionId() {
  if (insideExtension()) return chrome.runtime.id;
  const where = typeof window !== 'undefined' ? window.location : null;
  if (where && LOCAL_HOSTS.has(where.hostname)) {
    const fromUrl = new URLSearchParams(where.search || '').get('extensionId')?.trim();
    if (fromUrl && EXTENSION_ID_SHAPE.test(fromUrl)) return fromUrl;
  }
  return EXTENSION_ID_FALLBACK;
}

/** deliver()'s error when its timeout ran out before any reply. */
const NO_REPLY = 'No reply from the extension';

/**
 * One message to the service worker. Never rejects.
 *
 * Addressing: from the website the message must name the extension
 * (resolveExtensionId); inside the extension the one-argument form reaches its
 * own worker.
 *
 * @param {object} msg
 * @param {{ timeoutMs?: number }} [options] Resolve with an error after this
 *   long without a reply.
 * @returns {Promise<{ reply: any, error: string|null }>}
 */
function deliver(msg, { timeoutMs } = {}) {
  return new Promise((resolve) => {
    if (!hasExtensionRuntime()) {
      resolve({ reply: undefined, error: 'Extension context not available' });
      return;
    }
    let settled = false;
    let timer = null;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    if (Number.isFinite(timeoutMs)) {
      timer = setTimeout(() => settle({ reply: undefined, error: NO_REPLY }), timeoutMs);
    }
    // Reading lastError here is what keeps Chrome from logging it as unchecked.
    const callback = (reply) => {
      const lastError = chrome.runtime?.lastError;
      if (lastError) settle({ reply: undefined, error: lastError.message || 'Extension messaging failed' });
      else settle({ reply, error: null });
    };
    try {
      if (insideExtension()) chrome.runtime.sendMessage(msg, callback);
      else chrome.runtime.sendMessage(resolveExtensionId(), msg, callback);
    } catch (e) {
      settle({ reply: undefined, error: e?.message || 'Extension messaging failed' });
    }
  });
}

/**
 * Send one message to the extension's service worker and resolve its reply.
 * Rejects when the extension cannot be reached.
 *
 * @param {string} action Message kind, e.g. 'SCRAPE_ACTIVE_TAB'.
 * @param {object} [payload] Extra fields merged into the message.
 * @returns {Promise<any>} The service worker's response.
 */
export async function sendToExtension(action, payload = {}) {
  const { reply, error } = await deliver({ action, ...payload });
  if (error) throw new Error(error);
  return reply;
}

/** How long getExtensionInfo() waits for ONEXTAP_HELLO before saying absent. */
export const EXTENSION_INFO_TIMEOUT_MS = 1500;

const ABSENT = Object.freeze({ state: 'absent', version: null, protocol: null, capabilities: Object.freeze([]) });

/**
 * What a reply to ONEXTAP_HELLO says about the extension. Exported for tests.
 *
 * @param {any} reply The reply, or undefined when there was none.
 * @returns {{ state: 'current'|'legacy'|'absent', version: string|null,
 *   protocol: number|null, capabilities: string[] }}
 */
export function classifyHello(reply) {
  if (reply && reply.success === true && typeof reply.version === 'string') {
    return {
      state: 'current',
      version: reply.version,
      protocol: Number.isFinite(reply.protocol) ? reply.protocol : null,
      capabilities: Array.isArray(reply.capabilities) ? reply.capabilities.filter((c) => typeof c === 'string') : [],
    };
  }
  // Store 1.0.2 answers every message it does not know this way.
  if (reply && reply.success === false && typeof reply.error === 'string' && reply.error.startsWith('Unknown action')) {
    return { ...ABSENT, state: 'legacy', capabilities: [] };
  }
  return { ...ABSENT, capabilities: [] };
}

/**
 * Which extension, if any, this surface can talk to:
 *
 *   current  answered ONEXTAP_HELLO, with its version and capabilities;
 *   legacy   answered "Unknown action": store 1.0.2. It takes
 *            ONEXTAP_SYNC_DATA, but its popup reads the sync only before its
 *            first open;
 *   absent   no `chrome.runtime` at all, `chrome.runtime.lastError` (not
 *            installed, or not reachable from here), or no reply within
 *            1.5 s.
 *
 * Asks every time: the extension can be installed or updated while the page
 * is open. Never rejects.
 *
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<ReturnType<typeof classifyHello>>}
 */
export async function getExtensionInfo({ timeoutMs = EXTENSION_INFO_TIMEOUT_MS } = {}) {
  return (await handshake(timeoutMs)).info;
}

/** getExtensionInfo(), plus whether `absent` only means "no reply in time". */
async function handshake(timeoutMs) {
  const { reply, error } = await deliver({ type: 'ONEXTAP_HELLO' }, { timeoutMs });
  return { info: classifyHello(error ? undefined : reply), timedOut: error === NO_REPLY };
}

/** How long a profile sync waits for its reply before the save moves on. */
export const SYNC_TIMEOUT_MS = 10000;

/**
 * Push a profile (the flat `user_profile` shape) to the extension over
 * ONEXTAP_SYNC_DATA, and say what that achieved. Never rejects: the local
 * save it follows has already happened.
 *
 * `synced` is true only for a `current` extension with `profile-sync` that
 * confirmed it. A success from 1.0.2 is not a sync: it always says success,
 * and its popup stops reading the synced copy once it has opened. The sync is
 * still sent to it, which helps a fresh install.
 *
 * @param {object} profile
 * @returns {Promise<{ state: 'current'|'legacy'|'absent', synced: boolean, version: string|null }>}
 */
export async function syncProfileToExtension(profile) {
  const { info, timedOut } = await handshake(EXTENSION_INFO_TIMEOUT_MS);
  // Only a definite "not here" skips the sync. A handshake that merely timed
  // out may be a service worker still waking from sleep, which can take longer
  // than the handshake waits: the sync still goes, as it did before the
  // handshake existed, and the save just doesn't claim it arrived.
  if (info.state === 'absent' && !timedOut) return { state: 'absent', synced: false, version: null };

  const { reply, error } = await deliver({ type: 'ONEXTAP_SYNC_DATA', payload: profile }, { timeoutMs: SYNC_TIMEOUT_MS });
  const confirmed = !error && reply?.success === true;
  if (!confirmed) log.warn('extension did not confirm the profile sync', { state: info.state, reason: error || reply?.error || 'no reply' });
  return {
    state: info.state,
    synced: info.state === 'current' && confirmed && info.capabilities.includes('profile-sync'),
    version: info.version,
  };
}

// Helper to get icon URL
export const getIconUrl = () => {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL('icon.png');
  }
  return '/icon.png';
};
