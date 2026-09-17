/**
 * Supabase Auth Helpers
 * Sign-in, sign-up, sign-out, session management, and auth state listeners.
 *
 * Works in both contexts: on the web dashboard the session persists to
 * localStorage; inside the extension it persists to chrome.storage.local
 * via the adapter in supabaseClient.js.
 */
import { supabase } from './supabaseClient';

/**
 * Sign up with email and password.
 * The database trigger auto-creates a profile row with 3 free credits.
 * @param {string} email
 * @param {string} password
 * @param {string} [displayName] Stored as user metadata `full_name`.
 * @returns {Promise<{user: object|null, session: object|null, error: object|null}>}
 *   `session` is null when the project requires email confirmation.
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
 * In a Chrome extension context, uses chrome.identity.launchWebAuthFlow
 * so the popup doesn't close. On the web, uses the standard redirect flow.
 * Any provider enabled on the Supabase project works; only 'google' is
 * wired into the UI today.
 * @param {string} provider Supabase OAuth provider id, e.g. 'google'.
 * @returns {Promise<{error: object|null}>}
 */
export async function signInWithOAuth(provider) {
  const isExtension =
    typeof chrome !== 'undefined' && !!chrome?.identity?.launchWebAuthFlow;

  if (isExtension) {
    return signInWithOAuthExtension(provider);
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: window.location.origin + window.location.pathname,
    },
  });
  return { error };
}

/**
 * Extension-specific OAuth: opens a Chrome identity auth window,
 * parses the tokens from the redirect URL, and sets the Supabase session.
 * Requires the "identity" permission in manifest.json and the redirect URL
 * https://<extension-id>.chromiumapp.org/ in Supabase's Redirect URLs.
 */
async function signInWithOAuthExtension(provider) {
  const redirectTo = `https://${chrome.runtime.id}.chromiumapp.org/`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) return { error };

  try {
    const responseUrl = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: data.url, interactive: true },
        (callbackUrl) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(callbackUrl);
          }
        },
      );
    });

    const url = new URL(responseUrl);
    const params = new URLSearchParams(url.hash.substring(1));
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');

    if (!access_token) {
      return { error: { message: 'No access token in OAuth response' } };
    }

    const { error: sessionError } = await supabase.auth.setSession({
      access_token,
      refresh_token,
    });

    return { error: sessionError };
  } catch (err) {
    return {
      error: { message: err.message || 'OAuth flow was cancelled or failed' },
    };
  }
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
