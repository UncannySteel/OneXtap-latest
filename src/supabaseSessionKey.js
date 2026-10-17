/**
 * The key Supabase's client keeps the session under, for a project URL.
 *
 * One function, three readers: src/supabaseClient.js passes it as the
 * client's `storageKey`; the landing page (web/src/app/session.js) reads a
 * stored session under it before the SDK has loaded; and src/localKeys.js
 * lists it among the keys the extension clears when the account is deleted.
 *
 * The value is supabase-js's own default, sb-<first label of the project's
 * hostname>-auth-token, so naming it explicitly moved no session:
 * test/web/session.test.js holds the two together.
 *
 * No imports and no import.meta: Node tests load it bare.
 *
 * @param {unknown} supabaseUrl e.g. 'https://abcdefghijklmnopqrst.supabase.co'
 * @returns {string|null} null when there is no usable URL (a build without
 *   Supabase settings).
 */
export function supabaseStorageKey(supabaseUrl) {
  if (typeof supabaseUrl !== 'string' || !supabaseUrl.trim()) return null;
  try {
    return 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token';
  } catch {
    return null;
  }
}
