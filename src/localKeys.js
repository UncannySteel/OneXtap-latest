/**
 * Every key Onextap writes to chrome.storage.local, defined once, here: the
 * stores import their key from this file, and the extension clears the whole
 * list when the account is deleted (ONEXTAP_WIPE_LOCAL,
 * extension/messages/wipeLocal.js; docs/extension-protocol.md, "The wipe").
 *
 * What is on it:
 *   - the profile store and its flat `user_profile` mirror (profiles, saved
 *     answers, cover letters and their saved versions);
 *   - the resume library;
 *   - the settings: the application type, and the consent flags (src/consent.js
 *     writes nothing yet, and is listed so the day it does is covered);
 *   - store 1.0.2's tour flag, which nothing here writes any more;
 *   - the Supabase session, under the key src/supabaseClient.js names.
 * The avatar is not here: the dashboard keeps it in the website's
 * localStorage, which deleting the account clears on its own.
 *
 * A leaf, on purpose: the service worker imports it for the key names, and
 * must not pull the stores (and their load-time code) in with them. It imports
 * only ./supabaseSessionKey.js, which imports nothing
 * (docs/repo-structure.md, rule 2; test/extension/workerImports.test.js).
 *
 * test/extension/localKeys.test.js runs every store's writes against
 * LOCAL_KEYS, and fails the day a module in src/ writes under a key that is
 * not defined here.
 */
import { supabaseStorageKey } from './supabaseSessionKey.js';

/** The profile store: every profile, and which one is active. src/profileStore.js. */
export const PROFILES_STORAGE_KEY = 'onextap_profiles';

/** The active profile's flat mirror, in the shape older code reads. src/profileStore.js. */
export const LEGACY_PROFILE_KEY = 'user_profile';

/** The resume library. src/resumeStore.js. */
export const RESUMES_STORAGE_KEY = 'onextap_resumes';

/** The application type (job, college, scholarship). src/applicationTypeStorage.js. */
export const APPLICATION_TYPE_KEY = 'onextap_application_type';

/** Consent flags. src/consent.js. */
export const COOKIE_NOTICE_SEEN_KEY = 'onextap_cookie_notice_seen';
export const ANALYTICS_CONSENT_KEY = 'onextap_analytics_consent';

/**
 * Legacy: store 1.0.2's popup wrote its first-run tour flag here, in
 * chrome.storage.local. Nothing in src/ writes it now (the website's dashboard
 * keeps a flag of the same name in its own localStorage); listed so a 1.0.2
 * install that updates and then deletes the account loses it too.
 */
export const LEGACY_TUTORIAL_SEEN_KEY = 'onextap_tutorial_seen';

/** @type {readonly string[]} */
export const LOCAL_KEYS = Object.freeze([
  PROFILES_STORAGE_KEY,
  LEGACY_PROFILE_KEY,
  RESUMES_STORAGE_KEY,
  APPLICATION_TYPE_KEY,
  COOKIE_NOTICE_SEEN_KEY,
  ANALYTICS_CONSENT_KEY,
  LEGACY_TUTORIAL_SEEN_KEY,
  // null in a build without Supabase settings (and in bare Node, which has no
  // import.meta.env): there is no session to keep.
  supabaseStorageKey(import.meta.env?.VITE_SUPABASE_URL),
].filter(Boolean));
