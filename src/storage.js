const isExtension = typeof chrome !== 'undefined' && chrome.storage;

/**
 * Storage Wrapper
 *
 * One key/value API over two backends, picked at load time:
 * chrome.storage.local inside the extension, localStorage on the web
 * dashboard. Values are JSON-serialised on the web side; Chrome storage
 * handles structured values itself.
 *
 * This is local-only — nothing here writes to Supabase. Profile data
 * (`user_profile`, `onextap_profiles`) never leaves the device except when
 * the dashboard pushes it to the extension over chrome.runtime messaging
 * (ONEXTAP_SYNC_DATA). Credits and premium status are the exception: those
 * are server-owned, never cached here (see creditManager.js).
 */
export const storage = {
  /** @returns {Promise<any|null>} null when the key is unset. */
  get: async (key) => {
    return getLocal(key);
  },

  /** @returns {Promise<true>} Always resolves true; failures are not surfaced. */
  set: async (key, value) => {
    await setLocal(key, value);
    return true;
  },

  /** @returns {Promise<true>} Resolves true even when the key was absent. */
  remove: async (key) => {
    await removeLocal(key);
    return true;
  },
};

// ------------------------------------------------------------------
// Local storage helpers (Chrome Storage or localStorage)
// ------------------------------------------------------------------
function getLocal(key) {
  return new Promise((resolve) => {
    if (isExtension) {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] || null);
      });
    } else {
      const item = localStorage.getItem(key);
      try {
        resolve(JSON.parse(item));
      } catch {
        resolve(item);
      }
    }
  });
}

function setLocal(key, value) {
  return new Promise((resolve) => {
    if (isExtension) {
      chrome.storage.local.set({ [key]: value }, () => resolve(true));
    } else {
      localStorage.setItem(key, JSON.stringify(value));
      resolve(true);
    }
  });
}

function removeLocal(key) {
  return new Promise((resolve) => {
    if (isExtension) {
      chrome.storage.local.remove(key, () => resolve(true));
    } else {
      localStorage.removeItem(key);
      resolve(true);
    }
  });
}
