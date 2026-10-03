import { getAccessToken } from './auth';
import { API_URL } from './config';
import { log as baseLog } from './logger';

// API_URL comes from config.js, the one place it is decided. This module used
// to work it out again, and the two copies both sent a website on any domain
// but www.onextap.com to the live API.
const log = baseLog.child('credits');

/**
 * Helper: make an authenticated fetch to the backend.
 * Automatically attaches the Supabase JWT.
 */
async function authFetch(path, options = {}) {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const raw = await res.text();
    let message = `HTTP ${res.status}`;
    if (raw) {
      try {
        const body = JSON.parse(raw);
        message = body.error || body.message || message;
        if (typeof message !== 'string') message = raw.slice(0, 300);
      } catch {
        message = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || message;
      }
    }
    throw new Error(message);
  }
  return res.json();
}

/**
 * Credit Manager (Server-verified)
 *
 * All credit and premium operations go through the Express backend,
 * which verifies the Supabase JWT and manages credits in Postgres.
 * No client-side credit manipulation — tamper-proof.
 */
export const creditManager = {
  /**
   * Get current credit balance from the server, with error details.
   * Use this when you need to show the user why credits failed to load.
   *
   * Premium accounts report `Infinity` rather than a number — guard with
   * Number.isFinite before rendering or comparing.
   *
   * `isPremium` here is the flag stored on the profile row, returned by the
   * same request — so callers that need both need only this one call. It is
   * NOT a fresh check against Dodo: verifyPremium() does that, and
   * DashboardView runs it once per login, which is what keeps this flag
   * honest. Credit spending is gated server-side regardless.
   * @returns {Promise<{credits: number|null, isPremium: boolean, error?: string}>}
   *   `credits` is null when the request failed; `error` then holds why.
   */
  getCreditsWithStatus: async () => {
    try {
      const data = await authFetch('/api/credits');
      return {
        credits: data.isPremium ? Infinity : data.credits,
        isPremium: !!data.isPremium,
        error: undefined,
      };
    } catch (error) {
      const msg = error?.message || String(error);
      log.error('[creditManager] Error getting credits:', msg);
      return {
        credits: null,
        isPremium: false,
        error: msg,
      };
    }
  },

  /**
   * Deduct one credit after successful AI generation.
   * Premium users are not charged.
   * @returns {Promise<{success: boolean, remaining: number, isPremium?: boolean, error?: string}>}
   */
  deductCredit: async () => {
    try {
      return await authFetch('/api/credits/deduct', { method: 'POST' });
    } catch (error) {
      log.error('Error deducting credit:', error);
      return { success: false, remaining: 0, error: error.message };
    }
  },

  // There is no refundCredit. The server's POST /api/credits/refund handed a
  // credit back to anyone who asked, with nothing to prove a charge, and was
  // removed (see the note where it stood in server/index.js). A client cannot
  // be trusted to say it was charged: refunds belong to the route that charged.

  /**
   * Verify premium status via GET /api/verify-premium. The server re-checks
   * the subscription against Dodo Payments (the source of truth) and clears
   * a stale is_premium flag when the subscription is no longer active.
   * Returns false rather than throwing when the request fails, so callers
   * degrade to the free tier.
   * @returns {Promise<boolean>}
   */
  verifyPremium: async () => {
    try {
      const data = await authFetch('/api/verify-premium');
      return data.isPremium === true;
    } catch (error) {
      log.warn('Premium verification failed:', error.message);
      return false;
    }
  },

  /**
   * The account row as GET /api/me reports it. Throws on failure — it is the
   * dashboard's first call, and "could not load your account" is its own
   * screen, not a silent free tier.
   * @returns {Promise<{id: string, email: string, displayName: string|null,
   *   credits: number, isPremium: boolean, subscriptionStatus: string,
   *   premiumSince: string|null, createdAt: string}>}
   */
  getAccount: async () => {
    return authFetch('/api/me');
  },

  /**
   * The same check as verifyPremium, with the billing dates the dashboard's
   * subscription panel shows: `nextBillingDate` (ISO) and `cancelAtPeriodEnd`.
   * Both are absent when Dodo could not be reached. Resolves `{isPremium:
   * false, error}` rather than throwing, as verifyPremium does — `error` is
   * how a caller tells "not premium" from "could not ask".
   * @returns {Promise<{isPremium: boolean, nextBillingDate?: string|null,
   *   cancelAtPeriodEnd?: boolean, subscriptionStatus?: string, error?: string}>}
   */
  getSubscription: async () => {
    try {
      return await authFetch('/api/verify-premium');
    } catch (error) {
      log.warn('Subscription check failed:', error.message);
      return { isPremium: false, error: error.message };
    }
  },

  /**
   * Create a Dodo Payments Checkout Session for premium upgrade.
   * @returns {Promise<{url: string, sessionId: string}>}
   */
  createCheckoutSession: async () => {
    return authFetch('/api/create-checkout-session', { method: 'POST' });
  },

  /**
   * Cancel the premium subscription via Dodo Payments. An active one is
   * cancelled at the end of the period already paid for (`cancelAtPeriodEnd`,
   * with `endsAt`); one that is on hold or otherwise not in good standing is
   * cancelled on the spot.
   * @returns {Promise<{success: boolean, cancelAtPeriodEnd: boolean, endsAt: string|null}>}
   */
  cancelSubscription: async () => {
    return authFetch('/api/cancel-subscription', { method: 'POST' });
  },

  /**
   * Withdraw a cancellation scheduled for the end of the period.
   * @returns {Promise<{success: boolean, cancelAtPeriodEnd: false, nextBillingDate: string|null}>}
   */
  resumeSubscription: async () => {
    return authFetch('/api/resume-subscription', { method: 'POST' });
  },

  /**
   * A link to Dodo's hosted billing portal (invoices, card on file).
   * @returns {Promise<{url: string}>}
   */
  createPortalSession: async () => {
    return authFetch('/api/create-portal-session', { method: 'POST' });
  },

  /**
   * Delete the signed-in account: cancels any live subscription, then the
   * Supabase user and everything keyed to it. Local data is the caller's to
   * clear. Throws with the server's message on failure.
   * @returns {Promise<{success: true}>}
   */
  deleteAccount: async () => {
    return authFetch('/api/account', { method: 'DELETE' });
  },
};
