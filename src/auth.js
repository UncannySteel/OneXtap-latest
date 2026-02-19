/**
 * Supabase Auth Helpers
 * Replaces puterBridge.js — provides sign-in, sign-up, sign-out,
 * session management, and auth state listeners.
 */
import { supabase } from './supabaseClient';

/**
 * Sign up with email and password.
 * The database trigger auto-creates a profile row with 3 free credits.
 * @param {string} email
 * @param {string} password
 * @param {string} [displayName]
 * @returns {Promise<{user: object|null, error: object|null}>}
 */
export async function signUp(email, password, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: displayName || '' },
    },
  });
  return { user: data?.user ?? null, session: data?.session ?? null, error };
}

/**
 * Sign in with email and password.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: object|null, session: object|null, error: object|null}>}
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { user: data?.user ?? null, session: data?.session ?? null, error };
}

/**
 * Sign in with OAuth provider (e.g. 'google').
 * Opens a popup/redirect for the OAuth flow.
 * @param {'google'|'github'|'discord'} provider
 * @returns {Promise<{error: object|null}>}
 */
export async function signInWithOAuth(provider) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      // Use full URL so Supabase can round-trip back to the exact page
      // where the dashboard/extension is running.
      // Make sure this URL is listed in Supabase's "Redirect URLs".
      redirectTo: window.location.href,
    },
  });
  return { error };
}

/**
 * Sign out the current user.
 * @returns {Promise<{error: object|null}>}
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

/**
 * Get the current session (JWT + user).
 * Returns null if not signed in.
 * @returns {Promise<{session: object|null, error: object|null}>}
 */
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  return { session: data?.session ?? null, error };
}

/**
 * Get the current user from the session.
 * @returns {Promise<object|null>}
 */
export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

/**
 * Get the current JWT access token (for Authorization header).
 * Returns null if not signed in.
 * @returns {Promise<string|null>}
 */
export async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

/**
 * Listen for auth state changes (sign-in, sign-out, token refresh).
 * @param {(event: string, session: object|null) => void} callback
 * @returns {{ unsubscribe: () => void }}
 */
export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return { unsubscribe: () => data.subscription.unsubscribe() };
}
