/* --- is anyone signed in? ------------------------------------------------------
   The pure half of backend.js's hasSession(), kept apart so a Node test can
   load it: no imports, no import.meta.

   The landing page decides between "Log in" and "Dashboard" on first paint,
   and Supabase's SDK only loads on the first sign-in (backend.js), so it
   cannot ask the client which key the session is under. It works the key out
   the way the client does instead: src/supabaseClient.js sets no
   `storageKey`, so supabase-js keeps the session under its default,
   sb-<first label of the project's hostname>-auth-token.

   test/web/session.test.js holds the two together: it builds a real client
   with src/supabaseClient.js's options and compares keys, and it fails the
   day src/supabaseClient.js chooses a key of its own. */

/** The key Supabase's client keeps the session under for this project URL;
 *  null when there is no usable URL (a build without Supabase settings). */
export function supabaseStorageKey(supabaseUrl) {
  if (typeof supabaseUrl !== 'string' || !supabaseUrl.trim()) return null;
  try {
    return 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token';
  } catch {
    return null;
  }
}

/* A stored session with a refresh token counts: the access token inside it may
   have lapsed, but the dashboard's client refreshes it on load, and if that
   fails it sends the reader back here to sign in. `currentSession` is the
   shape older supabase-js versions wrote. */
export function hasStoredSession(storage, key) {
  if (!storage || !key) return false;
  try {
    var stored = JSON.parse(storage.getItem(key) || 'null');
    var session = stored && (stored.currentSession || stored);
    return !!(session && session.refresh_token);
  } catch {
    return false;
  }
}
