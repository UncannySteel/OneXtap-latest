const isExtension = typeof chrome !== 'undefined' && chrome.storage;

/**
 * Smart Storage Wrapper
 * - Chrome storage.local in the extension; localStorage on the web dashboard.
 * - Full `user_profile` JSON lives only in local/extension storage (not on `profiles` row today).
 *
 * Note: Credits are server-managed (see creditManager.js).
 */
export const storage = {
  // --- GET DATA ---
  get: async (key) => {
    return getLocal(key);
  },

  // --- SET DATA ---
  set: async (key, value) => {
    // ALWAYS save to local (offline backup)
    await setLocal(key, value);
    return true;
  },

  // --- REMOVE DATA ---
  remove: async (key) => {
    // Remove from local storage
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
