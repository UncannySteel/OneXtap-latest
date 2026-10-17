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
 * kept free of Dodo and Supabase so they can be tested: the functions that
 * talk to either take the client as an argument.
 */

/** Statuses in which the linked subscription is still the one in force. */
export const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

/** Statuses in which a subscription can still charge the customer. */
export const BILLABLE_SUBSCRIPTION_STATUSES = new Set([
  'pending', 'active', 'trialing', 'on_hold', 'paused', 'past_due',
]);

/**
 * Statuses in which a subscription is not in force but can still bill: on
 * hold after a failed payment, paused, past due, pending. Checkout lets such
 * an account pay again (it refuses only one in force), and when it does, the
 * new subscription replaces this one.
 */
export const STALLED_SUBSCRIPTION_STATUSES = new Set(
  [...BILLABLE_SUBSCRIPTION_STATUSES].filter((s) => !LIVE_SUBSCRIPTION_STATUSES.has(s)),
);

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
 * activationDecision(), with the one case where linking is not all there is
 * to do:
 *
 *   'replace'   — link it, then cancel the linked one, which is stalled
 *                 (STALLED_SUBSCRIPTION_STATUSES): not giving the customer
 *                 Pro, and still able to charge them, for instance once they
 *                 update the card it failed on.
 *   'link' and 'duplicate' — as activationDecision().
 *
 * @param {{linkedId?: string|null, linkedStatus?: string|null, newId: string}} args
 * @returns {'link'|'replace'|'duplicate'}
 */
export function activationAction({ linkedId, linkedStatus, newId }) {
  const decision = activationDecision({ linkedId, linkedStatus, newId });
  if (decision === 'link' && linkedId && linkedId !== newId && STALLED_SUBSCRIPTION_STATUSES.has(linkedStatus)) {
    return 'replace';
  }
  return decision;
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

// ------------------------------------------------------------------
// Linking, race-proof
// ------------------------------------------------------------------

/** How many times activateSubscription() reads again when the link moved under it. */
export const MAX_LINK_ATTEMPTS = 3;

/** An Error for a PostgREST error object, keeping its code (PGRST116, 23505…). */
function dbError(error) {
  const err = new Error(error?.message || `Database error (code ${error?.code || 'unknown'})`);
  if (error?.code) err.code = error.code;
  return err;
}

/**
 * The account's link to its subscription (`profiles.dodo_subscription_id`),
 * over a Supabase client with the service role.
 *
 * link() is the race-proof half. It is ONE conditional UPDATE, which lands
 * only if the link is still `expectedId` (what the caller read and judged),
 * and says whether it did. Postgres re-checks a blocked UPDATE's WHERE against
 * the row the first writer committed, so when two activations read the same
 * link, one write lands and the other matches no row. It filters on the
 * column itself, so it needs no migration.
 *
 * @param {object} client Supabase client (service role).
 */
export function supabaseLinkStore(client) {
  return {
    /** @returns {Promise<{linkedId: string|null}|null>} null when the account has no profile. */
    async read(userId) {
      const { data, error } = await client
        .from('profiles')
        .select('dodo_subscription_id')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw dbError(error);
      return data ? { linkedId: data.dodo_subscription_id ?? null } : null;
    },

    /** @returns {Promise<boolean>} true if the link was written. */
    async link(userId, { expectedId, newId, values }) {
      let update = client
        .from('profiles')
        .update({ ...values, dodo_subscription_id: newId })
        .eq('id', userId);
      update = expectedId == null
        ? update.is('dodo_subscription_id', null)
        : update.eq('dodo_subscription_id', expectedId);
      const { data, error } = await update.select('id');
      if (error) throw dbError(error);
      return Array.isArray(data) && data.length > 0;
    },
  };
}

/**
 * Cancel a subscription at Dodo now, not at the end of the period.
 *
 * @param {object} subscriptions Dodo's `subscriptions` resource.
 * @param {string} subscriptionId
 * @returns {Promise<boolean>} true if this call cancelled it; false if it had
 *   already ended (a redelivered event, or another activation got there
 *   first) or Dodo has no such subscription. Neither can bill.
 * @throws the cancel's error when the subscription may still bill.
 */
export async function cancelSubscriptionNow(subscriptions, subscriptionId) {
  try {
    await subscriptions.update(subscriptionId, { status: 'cancelled' });
    return true;
  } catch (err) {
    if (err?.status === 404) return false;
    let status;
    try {
      status = (await subscriptions.retrieve(subscriptionId))?.status;
    } catch {
      throw err;
    }
    if (status && !BILLABLE_SUBSCRIPTION_STATUSES.has(status)) return false;
    throw err;
  }
}

/**
 * `subscription.active`: link the subscription to the account, replace a
 * stalled one with it, or cancel it as a duplicate.
 *
 * Each attempt reads the link, asks Dodo about the linked subscription if it
 * is another one, decides (activationAction) and writes with store.link():
 * one conditional write that lands only if the link is still what was read.
 * So a subscription links only if the account had none, had this one, or had
 * one that has ended, is stalled or could not be checked, and still has it
 * when the write lands. Two activations at once both read "none": one write
 * lands, and the other attempt reads again, finds the winner in force and
 * takes the duplicate path. "Could not be checked" links on the first read
 * only (the paid subscription must not be left without Pro); on a re-read
 * after a lost write it throws instead, because the link it would overwrite
 * is the one another activation has just written.
 *
 * Duplicate: cancelled at Dodo, and logged with both ids. Its payment is
 * refunded by hand in Dodo (automating that needs the payment id, which only
 * `payment.succeeded` carries). If Dodo will not cancel it, this throws, so
 * the webhook answers 5xx and Dodo's next delivery tries again.
 *
 * Replacement: linked first, then the stalled one is cancelled. In that
 * order every later event about the old one is foreign to the account
 * (isForeignSubscription), including the `subscription.cancelled` the cancel
 * itself causes, so nothing about it can switch Premium off. If the cancel
 * fails, the paid subscription stays linked and the error names both, for
 * the old one to be cancelled by hand: a redelivery finds the new one linked
 * and has nothing left to retry.
 *
 * A redelivered activation reads its own subscription as linked, writes the
 * same link again and asks Dodo nothing.
 *
 * @param {{userId: string, newId: string, values: object}} activation
 *   `values`: the profile columns to set along with the link.
 * @param {{store: {read: Function, link: Function}, subscriptions: object, log: object}} deps
 *   `store`: supabaseLinkStore(); `subscriptions`: Dodo's resource.
 * @returns {Promise<{outcome: 'linked'|'replaced'|'duplicate'|'no_account', linkedId?: string|null, replacedId?: string}>}
 * @throws when the account cannot be read or written, a duplicate cannot be
 *   cancelled, Dodo cannot be asked about a link written under it, or the
 *   link moved under it MAX_LINK_ATTEMPTS times. The event
 *   is not done, and Dodo should deliver it again.
 */
export async function activateSubscription({ userId, newId, values }, { store, subscriptions, log }) {
  for (let attempt = 1; attempt <= MAX_LINK_ATTEMPTS; attempt += 1) {
    const current = await store.read(userId);
    if (!current) return { outcome: 'no_account' };

    const expectedId = current.linkedId;
    const linkedId = expectedId || null;
    let linkedStatus = null;
    if (linkedId && linkedId !== newId) {
      try {
        linkedStatus = (await subscriptions.retrieve(linkedId))?.status ?? null;
      } catch (err) {
        // On a re-read the link is one another activation wrote a moment ago,
        // so it is almost certainly in force: linking blind would overwrite
        // it and leave it billing, unlinked. Fail, and let Dodo redeliver.
        if (attempt > 1) {
          throw new Error(
            `subscription ${newId} for user ${userId} not linked: ${linkedId} was linked under it, `
              + `and Dodo could not be asked whether that one is in force`,
            { cause: err },
          );
        }
        log.warn(`[Dodo] subscription.active: could not check ${linkedId} for a duplicate, linking ${newId}`, {
          errName: err?.name,
          status: err?.status,
        });
      }
    }

    const action = activationAction({ linkedId, linkedStatus, newId });
    const ids = { userId, subscriptionId: newId, linkedSubscriptionId: linkedId };

    if (action === 'duplicate') {
      let cancelledNow;
      try {
        cancelledNow = await cancelSubscriptionNow(subscriptions, newId);
      } catch (err) {
        throw new Error(
          `second subscription ${newId} for user ${userId} (already on ${linkedId}) could not be cancelled; `
            + `if this keeps failing, cancel and refund it in Dodo: ${err?.message}`,
          { cause: err },
        );
      }
      if (cancelledNow) {
        log.warn(`[Dodo] Second subscription ${newId} for user ${userId} cancelled (already on ${linkedId}); refund its payment in Dodo`, ids);
      } else {
        log.info(`[Dodo] Second subscription ${newId} for user ${userId} already cancelled (already on ${linkedId})`, ids);
      }
      return { outcome: 'duplicate', linkedId };
    }

    // The link moved between the read and the write: look again.
    if (!(await store.link(userId, { expectedId, newId, values }))) continue;

    if (action === 'replace') {
      try {
        await cancelSubscriptionNow(subscriptions, linkedId);
        log.info(`[Dodo] Subscription ${linkedId} (${linkedStatus}) for user ${userId} cancelled: ${newId} replaces it`, ids);
      } catch (err) {
        log.error(`[Dodo] Subscription ${linkedId} (${linkedStatus}) for user ${userId} was replaced by ${newId} but could not be cancelled; cancel it in Dodo:`, err, ids);
      }
      return { outcome: 'replaced', linkedId: newId, replacedId: linkedId };
    }
    return { outcome: 'linked', linkedId: newId };
  }
  throw new Error(`subscription ${newId} for user ${userId} not linked: the account's link changed under it ${MAX_LINK_ATTEMPTS} times`);
}
