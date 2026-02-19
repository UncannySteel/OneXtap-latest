import { supabase } from './supabaseClient';

const isExtension = typeof chrome !== 'undefined' && chrome.storage;

/**
 * Check if the user is signed in to Supabase
 */
const isSignedIn = async () => {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data?.session;
  } catch {
    return false;
  }
};

/**
 * Smart Storage Wrapper
 * 1. If signed in to Supabase: profile data syncs to Supabase Postgres via the profiles table
 *    (only the `user_profile` key is synced — other keys stay local)
 * 2. Chrome Storage (Local) is always used as the local/offline layer
 * 3. Falls back to localStorage when not in an extension context
 *
 * Note: Credits are now server-managed (see creditManager.js).
 *       This storage layer handles profile data and general KV needs.
 */
export const storage = {
  // --- GET DATA ---
  get: async (key) => {
    // For user_profile, try Supabase first when signed in
    if (key === 'user_profile') {
      try {
        const signedInNow = await isSignedIn();
        if (signedInNow) {
          const { data } = await supabase.auth.getSession();
          if (data?.session?.user?.id) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', data.session.user.id)
              .single();
            // If we have a stored profile JSON, return it
            // Otherwise fall through to local storage
            if (profile) {
              // We store the full profile JSON in local storage too as cache
              const localProfile = await getLocal(key);
              // Prefer local if it has data (user may have edited offline)
              if (localProfile) return localProfile;
            }
          }
        }
      } catch (err) {
        console.warn('Supabase profile fetch failed, using local:', err);
      }
    }

    // Fallback to local storage
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
