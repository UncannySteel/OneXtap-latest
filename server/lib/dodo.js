/**
 * The one Dodo Payments client, shared by billing, account deletion and the
 * webhook.
 */
import DodoPayments from 'dodopayments';

export const dodo = new DodoPayments({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY,
  environment: process.env.DODO_PAYMENTS_ENVIRONMENT || 'test_mode',
  webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY,
});

/** Create a Dodo checkout session via SDK (v2+) or REST fallback (v0.x / missing SDK). */
export async function createDodoCheckoutSession(payload) {
  if (dodo.checkoutSessions?.create) {
    return dodo.checkoutSessions.create(payload);
  }

  const env = process.env.DODO_PAYMENTS_ENVIRONMENT || 'test_mode';
  const baseUrl = env === 'live_mode'
    ? 'https://live.dodopayments.com'
    : 'https://test.dodopayments.com';

  const response = await fetch(`${baseUrl}/checkouts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DODO_PAYMENTS_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  if (!response.ok) {
    let message = body.slice(0, 300);
    try {
      const parsed = JSON.parse(body);
      message = parsed.message || parsed.error || message;
    } catch { /* use raw text */ }
    throw new Error(message || `Dodo checkout failed (${response.status})`);
  }

  return JSON.parse(body);
}
