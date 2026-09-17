/**
 * Storage Wrapper
 *
 * One key/value API over three backends, picked at load time:
 * chrome.storage.local inside the extension, localStorage on the web
 * dashboard, and an in-memory Map when neither exists. Values are
 * JSON-serialised on the web side; Chrome storage handles structured values
 * itself.
 *
 * This is local-only — nothing here writes to Supabase. Profile data
 * (`user_profile`, `onextap_profiles`) and resume data (`onextap_resumes`)
 * never leave the device except when the dashboard pushes the profile to the
 * extension over chrome.runtime messaging (ONEXTAP_SYNC_DATA). Credits and
 * premium status are the exception: those are server-owned, never cached here
 * (see creditManager.js).
 *
 * ═══ WHY EACH OPERATION REPEATS THE THREE-ARM BRANCH ═══
 *
 * `getLocal`/`setLocal`/`setLocalStrict`/`removeLocal` each re-test the same
 * two flags rather than dispatching through one backend table. The arms are
 * not variations on a single call: Chrome's is callback-shaped and reports
 * failure out-of-band through `chrome.runtime.lastError`, the web and memory
 * arms are synchronous and throw. Collapsing them would mean inventing a
 * common adapter shape for three APIs that only two surfaces can ever be
 * tested against — the extension and web arms have no test coverage at all
 * (see below), so the repetition is deliberate and stays.
 */

/** True inside the extension, where chrome.storage.local is the backend. */
const isExtension = typeof chrome !== 'undefined' && chrome.storage;

/** True on the web dashboard, where localStorage is the backend. */
const hasWebStorage = !isExtension && typeof localStorage !== 'undefined' && localStorage !== null;

/** The public key/value API. See the module header for backend selection. */
export const storage = {
  /**
   * Read a key.
   * @param {string} key
   * @returns {Promise<any|null>} null when the key is unset.
   */
  get: async (key) => {
    return getLocal(key);
  },

  /** @returns {Promise<true>} Always resolves true; failures are not surfaced. */
  set: async (key, value) => {
    await setLocal(key, value);
    return true;
  },

  /**
   * Like {@link storage.set}, but REJECTS instead of swallowing the failure.
   *
   * `set()` deliberately hides write errors and a pile of callers depend on
   * that, so this is a second door rather than a change to the first one. Use
   * it where losing the write silently is worse than showing an error — the
   * resume store, where a QuotaExceededError means the user's upload is gone
   * and they need to be told, not left staring at a store that quietly did not
   * change.
   *
   * @param {string} key
   * @param {any} value
   * @returns {Promise<true>}
   * @throws {Error} On any backend failure. A quota failure is normalised to
   *   `err.name === STORAGE_QUOTA_ERROR` with a message the UI can show as-is.
   */
  setStrict: async (key, value) => {
    await setLocalStrict(key, value);
    return true;
  },

  /**
   * Delete a key.
   * @param {string} key
   * @returns {Promise<true>} Resolves true even when the key was absent.
   */
  remove: async (key) => {
    await removeLocal(key);
    return true;
  },
};

// ------------------------------------------------------------------
// Error classes
// ------------------------------------------------------------------
// Named rather than inlined because the string is the whole contract: callers
// branch on `err.name` across module boundaries (resumeStore.js turns a quota
// failure into "delete this resume"), and a typo in either copy would silently
// downgrade that to the generic path with no test able to notice.

/** `err.name` when the backend is out of room. The UI may show `err.message`. */
export const STORAGE_QUOTA_ERROR = 'StorageQuotaError';

/** `err.name` for every other write failure. */
export const STORAGE_WRITE_ERROR = 'StorageWriteError';

// ------------------------------------------------------------------
// In-memory backend
// ------------------------------------------------------------------
// Used ONLY when neither chrome.storage nor localStorage exists — that is,
// bare Node under `node --test`. Extension and dashboard behaviour is
// completely unchanged: chrome.storage.local still wins in the extension and
// localStorage still wins on the web, both picked at module load above.
//
// This exists so that everything layered on `storage` (profileStore,
// resumeStore) is testable with plain `node --test`, with no DOM, no jsdom and
// no fake-chrome shim. It serialises through JSON the way both real backends
// do, so a test cannot accidentally pass by holding a live object reference
// that a real backend would have flattened.
const memoryStore = new Map();

/** When set, every in-memory write throws it. Test hook; see setStrict tests. */
let memoryWriteFailure = null;

/**
 * Read one key out of the in-memory Map, re-hydrating the stored JSON.
 * @param {string} key
 * @param {any} whenUnset Returned when the key was never written — `null` for
 *   the `storage.get` contract, `undefined` for the peek seam, which has to
 *   tell "never written" apart from "written as null".
 * @returns {any}
 */
function readMemory(key, whenUnset) {
  return memoryStore.has(key) ? JSON.parse(memoryStore.get(key)) : whenUnset;
}

/**
 * SUPPORTED TEST SEAM. Clear the in-memory backend between tests.
 * No-op against chrome.storage/localStorage.
 * @returns {void}
 */
export function __resetMemoryStorageForTests() {
  memoryStore.clear();
  memoryWriteFailure = null;
}

/**
 * SUPPORTED TEST SEAM. Make in-memory writes fail, so `set` vs `setStrict` can
 * be told apart without a real quota to exhaust.
 * @param {Error|{message: string}|null} error Pass null to restore normal
 *   writes. A bare `{ message }` stands in for `chrome.runtime.lastError`.
 * @returns {void}
 */
export function __setMemoryStorageFailureForTests(error) {
  memoryWriteFailure = error || null;
}

/**
 * SUPPORTED TEST SEAM. Read the in-memory backend directly, bypassing the
 * `storage` API. Lets a test assert that a "pure read" really wrote nothing.
 * @param {string} key
 * @returns {any|undefined} undefined when the key was never written, which is
 *   distinct from a key written as `null`.
 */
export function __peekMemoryStorageForTests(key) {
  return readMemory(key, undefined);
}

// ------------------------------------------------------------------
// Local storage helpers (Chrome Storage, localStorage, or memory)
// ------------------------------------------------------------------
function getLocal(key) {
  return new Promise((resolve) => {
    if (isExtension) {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] || null);
      });
    } else if (hasWebStorage) {
      const item = localStorage.getItem(key);
      try {
        resolve(JSON.parse(item));
      } catch {
        resolve(item);
      }
    } else {
      resolve(readMemory(key, null));
    }
  });
}

function setLocal(key, value) {
  return new Promise((resolve) => {
    if (isExtension) {
      chrome.storage.local.set({ [key]: value }, () => resolve(true));
    } else if (hasWebStorage) {
      localStorage.setItem(key, JSON.stringify(value));
      resolve(true);
    } else {
      memoryStore.set(key, JSON.stringify(value));
      resolve(true);
    }
  });
}

function setLocalStrict(key, value) {
  return new Promise((resolve, reject) => {
    if (isExtension) {
      try {
        chrome.storage.local.set({ [key]: value }, () => {
          const lastError = chrome.runtime?.lastError;
          if (lastError) reject(toStorageError(lastError.message, key));
          else resolve(true);
        });
      } catch (e) {
        reject(toStorageError(e, key));
      }
    } else if (hasWebStorage) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        resolve(true);
      } catch (e) {
        reject(toStorageError(e, key));
      }
    } else {
      try {
        if (memoryWriteFailure) throw memoryWriteFailure;
        memoryStore.set(key, JSON.stringify(value));
        resolve(true);
      } catch (e) {
        reject(toStorageError(e, key));
      }
    }
  });
}

function removeLocal(key) {
  return new Promise((resolve) => {
    if (isExtension) {
      chrome.storage.local.remove(key, () => resolve(true));
    } else if (hasWebStorage) {
      localStorage.removeItem(key);
      resolve(true);
    } else {
      memoryStore.delete(key);
      resolve(true);
    }
  });
}

/**
 * Is this a "you are out of room" failure?
 *
 * Three shapes to recognise: the DOM's `QuotaExceededError`, Firefox's
 * `NS_ERROR_DOM_QUOTA_REACHED`, and `chrome.runtime.lastError`, which is a
 * plain `{ message }` carrying strings like "QUOTA_BYTES quota exceeded".
 * @param {unknown} cause
 * @returns {boolean}
 */
function isQuotaFailure(cause) {
  if (!cause) return false;
  const name = typeof cause === 'object' ? String(cause.name || '') : '';
  const message = typeof cause === 'string' ? cause : String(cause?.message || '');
  return name === 'QuotaExceededError'
    || name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || /quota/i.test(message);
}

/**
 * Normalise a backend failure into an Error a caller can branch on and a UI
 * can render verbatim.
 * @param {unknown} cause Thrown value, or a chrome.runtime.lastError message.
 * @param {string} key The key being written.
 * @returns {Error}
 */
function toStorageError(cause, key) {
  const detail = typeof cause === 'string' ? cause : String(cause?.message || cause || 'unknown error');
  if (isQuotaFailure(cause)) {
    const err = new Error(
      `Local storage is full, so "${key}" could not be saved. Delete a saved resume to free up space, then try again.`,
    );
    err.name = STORAGE_QUOTA_ERROR;
    if (cause instanceof Error) err.cause = cause;
    return err;
  }
  const err = new Error(`Could not write "${key}" to local storage: ${detail}`);
  err.name = STORAGE_WRITE_ERROR;
  if (cause instanceof Error) err.cause = cause;
  return err;
}
