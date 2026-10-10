import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isForeignSubscription,
  activationDecision,
  subscriptionsToCancel,
} from '../../server/subscriptionGuard.js';

// One account, one subscription (server/subscriptionGuard.js). What matters:
// events about a stray subscription never move the account, a second
// subscription is caught as a duplicate only while the first is in force,
// and deleting an account cancels every billable subscription of its own.

test('an event about another subscription is foreign; one that cannot be compared is not', () => {
  assert.equal(isForeignSubscription('sub_A', 'sub_B'), true);
  assert.equal(isForeignSubscription('sub_A', 'sub_A'), false);
  assert.equal(isForeignSubscription(null, 'sub_B'), false, 'no linked subscription yet');
  assert.equal(isForeignSubscription('sub_A', undefined), false, 'event names no subscription');
});

test('a second subscription while the first is in force is a duplicate', () => {
  assert.equal(activationDecision({ linkedId: 'sub_A', linkedStatus: 'active', newId: 'sub_B' }), 'duplicate');
  assert.equal(activationDecision({ linkedId: 'sub_A', linkedStatus: 'trialing', newId: 'sub_B' }), 'duplicate');
});

test('activation links when there is nothing in force to protect', () => {
  assert.equal(activationDecision({ linkedId: null, linkedStatus: null, newId: 'sub_B' }), 'link', 'first subscription');
  assert.equal(activationDecision({ linkedId: 'sub_B', linkedStatus: 'active', newId: 'sub_B' }), 'link', 'redelivered event');
  // on_hold included: checkout lets an account on hold pay again, as it does.
  for (const notInForce of ['cancelled', 'expired', 'failed', 'on_hold']) {
    assert.equal(activationDecision({ linkedId: 'sub_A', linkedStatus: notInForce, newId: 'sub_B' }), 'link', notInForce);
  }
  assert.equal(
    activationDecision({ linkedId: 'sub_A', linkedStatus: null, newId: 'sub_B' }),
    'link',
    'Dodo could not be asked: a paid subscription must not be left without Pro',
  );
});

test('deletion cancels the linked subscription and any tagged with the account, nothing else', () => {
  const subs = [
    { subscription_id: 'sub_linked', status: 'active', metadata: { supabaseUserId: 'u1' } },
    { subscription_id: 'sub_dup', status: 'active', metadata: { supabaseUserId: 'u1' } },
    { subscription_id: 'sub_held', status: 'on_hold', metadata: { supabaseUserId: 'u1' } },
    { subscription_id: 'sub_done', status: 'cancelled', metadata: { supabaseUserId: 'u1' } },
    { subscription_id: 'sub_other_app', status: 'active', metadata: {} },
    { subscription_id: 'sub_other_user', status: 'active', metadata: { supabaseUserId: 'u2' } },
  ];
  assert.deepEqual(
    subscriptionsToCancel(subs, { userId: 'u1', linkedId: 'sub_linked' }).sort(),
    ['sub_dup', 'sub_held', 'sub_linked'],
  );
});

test('deletion copes with no list and with a linked subscription missing its tag', () => {
  assert.deepEqual(subscriptionsToCancel(undefined, { userId: 'u1', linkedId: 'sub_A' }), []);
  assert.deepEqual(
    subscriptionsToCancel([{ subscription_id: 'sub_A', status: 'active' }], { userId: 'u1', linkedId: 'sub_A' }),
    ['sub_A'],
  );
});
