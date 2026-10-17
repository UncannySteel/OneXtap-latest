import { createClient } from '@supabase/supabase-js';
import { log } from './logger';
import { supabaseStorageKey } from './supabaseSessionKey';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  log.error(
    '[Supabase] Missing environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.'
  );
}

/**
 * Supabase client for the frontend (React dashboard + extension popup).
 *
 * Storage is customized so that in a Chrome extension context the session
 * is persisted to chrome.storage.local instead of localStorage (which is
 * not available in service workers / background scripts).
 */
const isExtension = typeof chrome !== 'undefined' && !!chrome?.storage?.local;

const chromeStorageAdapter = {
  getItem: async (key) => {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] ?? null);
      });
    });
  },
  setItem: async (key, value) => {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    });
  },
  removeItem: async (key) => {
    return new Promise((resolve) => {
      chrome.storage.local.remove(key, () => resolve());
    });
  },
};

/**
 * The session's key, named rather than left to supabase-js. Its value is
 * supabase-js's default (src/supabaseSessionKey.js), so no session moved;
 * named so the landing page's "signed in?" check and the extension's wipe on
 * account deletion (src/localKeys.js) read the same key the client writes.
 */
const storageKey = supabaseStorageKey(supabaseUrl);

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    ...(storageKey ? { storageKey } : {}),
    ...(isExtension ? { storage: chromeStorageAdapter } : {}),
  },
});
