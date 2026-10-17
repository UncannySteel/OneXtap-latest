/**
 * POST /api/webhook through the real app (test/server/harness.js), with
 * events signed by the harness's dummy webhook key.
 *
 * The harness has no database: every Supabase call fails. For
 * `subscription.active` that is the case that matters. An activation the
 * server could not finish (link it, cancel a duplicate) answers 500, so Dodo
 * delivers it again, instead of a 200 that leaves a paid subscription
 * without Pro (server/subscriptionGuard.js, activateSubscription()). The
 * decisions themselves are unit-tested in subscriptionGuard.test.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { startHarness, HARNESS_ENV } from './harness.js';

const harness = await startHarness();
test.after(() => harness.close());

/** Standard Webhooks headers for `body`, signed with the harness's dummy key. */
function signed(body) {
  const id = `msg_harness_${Date.now()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(HARNESS_ENV.DODO_PAYMENTS_WEBHOOK_KEY.replace(/^whsec_/, ''), 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`,
  };
}

function deliver(type, data) {
  const body = JSON.stringify({ business_id: 'bus_harness', type, timestamp: new Date().toISOString(), data });
  return harness.request('POST', '/api/webhook', { headers: signed(body), body });
}

const subscription = {
  subscription_id: 'sub_harness_B',
  metadata: { supabaseUserId: '00000000-0000-4000-8000-000000000001' },
  customer: { customer_id: 'cus_harness' },
};

test('an unsigned webhook is refused', async () => {
  const res = await harness.request('POST', '/api/webhook', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'subscription.active', data: subscription }),
  });
  assert.equal(res.status, 400);
});

test('a subscription.active the server cannot record answers 500, so Dodo delivers it again', async () => {
  const logsBefore = harness.logs.length;
  const blockedBefore = harness.blocked.length;

  const res = await deliver('subscription.active', subscription);

  assert.equal(res.status, 500);
  assert.deepEqual(JSON.parse(res.body), { received: false });
  assert.ok(harness.blocked.length > blockedBefore, 'it went to the database');
  const errors = harness.logs
    .slice(logsBefore)
    .filter((line) => line.level === 'error' && /subscription\.active/.test(line.msg));
  assert.equal(errors.length, 1, 'one error line says the event was not handled');
});

test('other events keep their behaviour: logged, and acknowledged', async () => {
  const res = await deliver('subscription.renewed', subscription);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { received: true });
});
