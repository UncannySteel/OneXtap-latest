/**
 * Cookie/analytics consent flags.
 *
 * No cookies or analytics run today (see privacy-policy.html, "Cookies &
 * Local Storage"). This module exists so the day an analytics SDK is added,
 * its init call has a gate to check (`if (await getAnalyticsConsent())`)
 * instead of needing a design pass at that point. Backed by the same
 * cross-surface `storage` wrapper as every other "remember this choice" flag
 * in the app (see `onextap_tutorial_seen` in DashboardView.jsx).
 */

import { storage } from './storage';

const COOKIE_NOTICE_SEEN_KEY = 'onextap_cookie_notice_seen';
const ANALYTICS_CONSENT_KEY = 'onextap_analytics_consent';

/** @returns {Promise<boolean>} Whether the cookie notice has been dismissed. */
export async function hasSeenCookieNotice() {
  return Boolean(await storage.get(COOKIE_NOTICE_SEEN_KEY));
}

/** @returns {Promise<void>} */
export async function markCookieNoticeSeen() {
  await storage.set(COOKIE_NOTICE_SEEN_KEY, true);
}

/**
 * Opt-out model (CCPA-style): analytics is allowed unless the user has
 * explicitly declined it.
 * @returns {Promise<boolean>}
 */
export async function getAnalyticsConsent() {
  const stored = await storage.get(ANALYTICS_CONSENT_KEY);
  return stored !== false;
}

/** @param {boolean} allowed @returns {Promise<void>} */
export async function setAnalyticsConsent(allowed) {
  await storage.set(ANALYTICS_CONSENT_KEY, Boolean(allowed));
}
