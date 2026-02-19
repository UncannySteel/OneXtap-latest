import { getAccessToken } from './auth';

export const INITIAL_CREDITS = 3;

// API base URL — set via VITE_API_URL in .env, defaults to local dev server
const API_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || 'http://localhost:3001';

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
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `Request failed (${res.status})`);
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
   * @returns {Promise<{credits: number|null, error?: string}>}
   */
  getCreditsWithStatus: async () => {
    try {
      const data = await authFetch('/api/credits');
      return {
        credits: data.isPremium ? Infinity : data.credits,
        error: undefined,
      };
    } catch (error) {
      const msg = error?.message || String(error);
      console.error('[creditManager] Error getting credits:', msg);
      return {
        credits: null,
        error: msg,
      };
    }
  },

  /**
   * Get current credit balance from the server.
   * Returns 0 on error (for backward compat). Use getCreditsWithStatus for error details.
   * @returns {Promise<number>}
   */
  getCredits: async () => {
    const { credits, error } = await creditManager.getCreditsWithStatus();
    if (error) return 0;
    return credits ?? 0;
  },

  /**
   * Check if user can use AI (has credits or is premium).
   * @returns {Promise<boolean>}
   */
  canUseAI: async () => {
    try {
      const data = await authFetch('/api/credits');
      return data.isPremium || data.credits > 0;
    } catch (error) {
      console.error('Error checking AI availability:', error);
      return false;
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
      console.error('Error deducting credit:', error);
      return { success: false, remaining: 0, error: error.message };
    }
  },

  /**
   * Get premium status from the server.
   * @returns {Promise<boolean>}
   */
  isPremium: async () => {
    try {
      const data = await authFetch('/api/verify-premium');
      return data.isPremium === true;
    } catch (error) {
      console.error('Error checking premium status:', error);
      return false;
    }
  },

  /**
   * Refund one credit (when AI generation fails after deduction).
   * @returns {Promise<{success: boolean, remaining: number, error?: string}>}
   */
  refundCredit: async () => {
    try {
      return await authFetch('/api/credits/refund', { method: 'POST' });
    } catch (error) {
      console.error('Error refunding credit:', error);
      return { success: false, remaining: 0, error: error.message };
    }
  },

  /**
   * Verify premium status with the server (Dodo Payments source of truth).
   * @returns {Promise<boolean>}
   */
  verifyPremium: async () => {
    try {
      const data = await authFetch('/api/verify-premium');
      return data.isPremium === true;
    } catch (error) {
      console.warn('Premium verification failed:', error.message);
      return false;
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
   * Cancel the current premium subscription via Dodo Payments.
   * @returns {Promise<{success: boolean}>}
   */
  cancelSubscription: async () => {
    return authFetch('/api/cancel-subscription', { method: 'POST' });
  },
};
