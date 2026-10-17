/* --- is anyone signed in? ------------------------------------------------------
   The pure half of backend.js's hasSession(), kept apart so a Node test can
   load it: no import.meta, and one import, of a module with none.

   The landing page decides between "Log in" and "Dashboard" on first paint,
   and Supabase's SDK only loads on the first sign-in (backend.js), so it
   cannot ask the client which key the session is under. It reads the key
   from the function the client is configured with:
   src/supabaseClient.js passes supabaseStorageKey() as its `storageKey`.
   Imported by a relative path, not @app, so Node can load this file bare.

   test/web/session.test.js holds the key to supabase-js's own default (so
   naming it moved no session) and to src/supabaseClient.js's options. */

/** The key Supabase's client keeps the session under for this project URL;
 *  null when there is no usable URL (a build without Supabase settings). */
export { supabaseStorageKey } from '../../../src/supabaseSessionKey.js';

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
