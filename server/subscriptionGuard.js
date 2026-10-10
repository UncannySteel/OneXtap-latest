/**
 * One account, one subscription.
 *
 * The app links an account to exactly one Dodo subscription
 * (`profiles.dodo_subscription_id`), but nothing at Dodo stops a second one:
 * checkout refuses an account that is already Pro, and an account only
 * becomes Pro when the first `subscription.active` webhook lands. Two
 * checkouts inside that window (a double click, two tabs, a slow or failing
 * webhook) left a second, unlinked subscription billing — found on the dev
 * project on 2026-10-10, where it also outlived the account's deletion.
 *
 * These are the decisions the webhook and DELETE /api/account make about it,
 * kept free of Dodo and Supabase so they can be tested.
 */

/** Statuses in which the linked subscription is still the one in force. */
export const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

/** Statuses in which a subscription can still charge the customer. */
export const BILLABLE_SUBSCRIPTION_STATUSES = new Set([
  'pending', 'active', 'trialing', 'on_hold', 'paused', 'past_due',
]);

/**
 * Whether a webhook is about a subscription other than the account's own.
 *
 * Such an event must not move the account: a stray subscription being
 * cancelled would otherwise switch Premium off while the linked one is still
 * paid for. An account with no linked subscription, or an event that names
 * none, cannot be compared, and is handled as it always was.
 *
 * @param {string|null|undefined} linkedId The account's dodo_subscription_id.
 * @param {string|null|undefined} eventSubscriptionId The event's subscription_id.
 * @returns {boolean}
 */
export function isForeignSubscription(linkedId, eventSubscriptionId) {
  return Boolean(linkedId && eventSubscriptionId && linkedId !== eventSubscriptionId);
}

/**
 * What to do with `subscription.active`.
 *
 *   'link'      — make it the account's subscription: there is none, it is
 *                 the same one again (a redelivery), or the linked one has
 *                 ended (a returning customer) or could not be checked.
 *   'duplicate' — the account already has a different subscription in force,
 *                 so this one is a second charge for the same plan.
 *
 * A linked status of null means Dodo could not be asked. That links, because
 * the customer has paid for the new one and linking is what happened before
 * this check existed; refusing would leave a paid subscription with no Pro.
 *
 * @param {{linkedId?: string|null, linkedStatus?: string|null, newId: string}} args
 * @returns {'link'|'duplicate'}
 */
export function activationDecision({ linkedId, linkedStatus, newId }) {
  if (!linkedId || linkedId === newId) return 'link';
  return LIVE_SUBSCRIPTION_STATUSES.has(linkedStatus) ? 'duplicate' : 'link';
}

/**
 * The subscriptions to cancel before an account is deleted: every billable
 * one that is this account's — the linked one, and any the checkout tagged
 * with its user id. A customer's subscriptions to anything else are left alone.
 *
 * @param {Array<{subscription_id: string, status: string, metadata?: object}>} subscriptions
 * @param {{userId: string, linkedId?: string|null}} account
 * @returns {string[]} Subscription ids, each once.
 */
export function subscriptionsToCancel(subscriptions, { userId, linkedId }) {
  const ids = new Set();
  for (const sub of Array.isArray(subscriptions) ? subscriptions : []) {
    if (!sub || !BILLABLE_SUBSCRIPTION_STATUSES.has(sub.status)) continue;
    const ours = sub.subscription_id === linkedId || sub.metadata?.supabaseUserId === userId;
    if (ours) ids.add(sub.subscription_id);
  }
  return [...ids];
}
