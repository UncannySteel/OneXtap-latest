import { CHROME_WEB_STORE_URL, EXTENSION_ID_FALLBACK } from './config';

/**
 * Extension Client Helpers
 *
 * Small bridge used by the React tree to talk about the extension from
 * either surface. The same code runs with `chrome.*` present (extension
 * popup) and absent (web dashboard), so every touch of `chrome` is guarded
 * and falls back to a plain web value.
 *
 * Resolving the extension ID matters because the dashboard, opened from the
 * popup, receives the real ID as `?extensionId=` — that is what lets it
 * message the installed extension instead of the hardcoded fallback.
 */
export function openChromeWebStore() {
  window.open(CHROME_WEB_STORE_URL, '_blank', 'noopener,noreferrer');
}

/** Get extension ID: from URL (?extensionId=) when dashboard opened from popup, then chrome.runtime.id, then fallback. */
export function getExtensionId() {
  if (typeof window !== 'undefined' && window.location?.search) {
    const fromUrl = new URLSearchParams(window.location.search).get('extensionId');
    if (fromUrl?.trim()) return fromUrl.trim();
  }
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) return chrome.runtime.id;
  return EXTENSION_ID_FALLBACK || null;
}

/** True when the extension's messaging API is reachable from this surface. */
export function hasExtensionRuntime() {
  return typeof chrome !== 'undefined' && !!chrome?.runtime?.sendMessage;
}

/**
 * Send one message to the extension's service worker and resolve its reply.
 *
 * Addressing matters: from the web dashboard `chrome.runtime.id` is undefined,
 * so the message must be sent to an explicit extension id (resolved by
 * getExtensionId, which reads `?extensionId=` when the dashboard was opened
 * from the popup). Inside the popup there is no id to pass and the one-arg
 * form is correct. Getting this wrong silently fails on the dashboard only.
 *
 * @param {string} action Message kind, e.g. 'SCRAPE_ACTIVE_TAB'.
 * @param {object} [payload] Extra fields merged into the message.
 * @returns {Promise<any>} The service worker's response.
 */
export function sendToExtension(action, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!hasExtensionRuntime()) return reject(new Error('Extension context not available'));
    const msg = { action, ...payload };
    const cb = (res) => {
      if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    };
    const id = getExtensionId();
    if (id) chrome.runtime.sendMessage(id, msg, cb);
    else chrome.runtime.sendMessage(msg, cb);
  });
}

// Helper to get icon URL
export const getIconUrl = () => {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL('icon.png');
  }
  return '/icon.png';
};
