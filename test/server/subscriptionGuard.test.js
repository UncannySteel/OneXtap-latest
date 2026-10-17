import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isForeignSubscription,
  activationDecision,
  activationAction,
  subscriptionsToCancel,
  cancelSubscriptionNow,
  supabaseLinkStore,
  activateSubscription,
  MAX_LINK_ATTEMPTS,
} from '../../server/subscriptionGuard.js';

// One account, one subscription (server/subscriptionGuard.js). What matters:
// events about a stray subscription never move the account, a second
// subscription is caught as a duplicate only while the first is in force,
// deleting an account cancels every billable subscription of its own, two
// activations at once link one subscription and not both, and a linked
// subscription on hold is cancelled when a new one replaces it.

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

test('a linked subscription that is not in force but can still bill is replaced', () => {
  for (const stalled of ['on_hold', 'paused', 'past_due', 'pending']) {
    assert.equal(activationAction({ linkedId: 'sub_A', linkedStatus: stalled, newId: 'sub_B' }), 'replace', stalled);
  }
  for (const live of ['active', 'trialing']) {
    assert.equal(activationAction({ linkedId: 'sub_A', linkedStatus: live, newId: 'sub_B' }), 'duplicate', live);
  }
  for (const ended of ['cancelled', 'expired', 'failed']) {
    assert.equal(activationAction({ linkedId: 'sub_A', linkedStatus: ended, newId: 'sub_B' }), 'link', ended);
  }
  assert.equal(activationAction({ linkedId: null, linkedStatus: null, newId: 'sub_B' }), 'link', 'first subscription');
  assert.equal(activationAction({ linkedId: 'sub_B', linkedStatus: 'on_hold', newId: 'sub_B' }), 'link', 'the same one again');
  assert.equal(activationAction({ linkedId: 'sub_A', linkedStatus: null, newId: 'sub_B' }), 'link', 'Dodo could not be asked');
});

// ------------------------------------------------------------------
// Fakes: the profiles table and Dodo's subscriptions, nothing on a network
// ------------------------------------------------------------------

/**
 * The Supabase client's `profiles` table, as far as the link store uses it.
 * The one property that matters is Postgres's: an UPDATE's filters are
 * checked against the row as it is when the write lands (a blocked UPDATE
 * re-checks its WHERE against the row the winner committed), not as it was
 * read. `holdReads(n)` makes the first n reads wait for each other, so two
 * activations both read before either writes.
 */
function fakeProfiles(rows, { timeline = [], readError = null } = {}) {
  const table = new Map(Object.entries(rows).map(([id, row]) => [id, { id, ...row }]));
  const updates = [];
  let gate = null;

  const matches = (row, filters) => filters.every(([op, col, v]) => (
    op === 'is' ? row[col] == null && v === null : row[col] === v
  ));

  function query() {
    const q = { values: null, filters: [] };
    const run = async () => {
      if (q.values) {
        const hit = [...table.values()].filter((row) => matches(row, q.filters));
        for (const row of hit) Object.assign(row, q.values);
        updates.push({ values: q.values, filters: q.filters, matched: hit.length });
        timeline.push(`link ${q.values.dodo_subscription_id}${hit.length ? '' : ' refused'}`);
        return { data: hit.map((row) => ({ id: row.id })), error: null };
      }
      if (gate) await gate();
      if (readError) return { data: null, error: readError };
      const row = [...table.values()].find((r) => matches(r, q.filters));
      return { data: row ? { dodo_subscription_id: row.dodo_subscription_id ?? null } : null, error: null };
    };
    const builder = {
      update(values) { q.values = values; return builder; },
      select() { return builder; },
      eq(col, v) { q.filters.push(['eq', col, v]); return builder; },
      is(col, v) { q.filters.push(['is', col, v]); return builder; },
      maybeSingle: run,
      then: (ok, fail) => run().then(ok, fail),
    };
    return builder;
  }

  return {
    client: { from(name) { assert.equal(name, 'profiles'); return query(); } },
    row: (id) => table.get(id),
    updates,
    holdReads(n) {
      let waiting = 0;
      let release;
      const all = new Promise((resolve) => { release = resolve; });
      gate = () => { waiting += 1; if (waiting >= n) release(); return all; };
    },
  };
}

/** Dodo's subscriptions resource: retrieve and update, by status. */
function fakeDodo(statuses, { timeline = [], unreachable = false, failCancel = [], refusesRepeatCancel = false } = {}) {
  const subs = new Map(Object.entries(statuses));
  const calls = [];
  const apiError = (status, message) => Object.assign(new Error(message), { status });
  return {
    calls,
    status: (id) => subs.get(id),
    subscriptions: {
      async retrieve(id) {
        calls.push(['retrieve', id]);
        if (unreachable) throw apiError(503, 'Dodo is down');
        if (!subs.has(id)) throw apiError(404, 'not found');
        return { subscription_id: id, status: subs.get(id) };
      },
      async update(id, body) {
        calls.push(['update', id, body]);
        if (failCancel.includes(id)) throw apiError(500, 'Dodo could not cancel');
        if (!subs.has(id)) throw apiError(404, 'not found');
        if (refusesRepeatCancel && subs.get(id) === 'cancelled') throw apiError(409, 'already cancelled');
        subs.set(id, body.status);
        timeline.push(`cancel ${id}`);
        return { subscription_id: id, status: body.status };
      },
    },
  };
}

/** A logger that keeps what it is given. */
function spyLog() {
  const lines = [];
  const at = (level) => (msg, ...rest) => { lines.push({ level, msg: String(msg), rest }); };
  return { lines, error: at('error'), warn: at('warn'), info: at('info'), debug: at('debug') };
}

const PREMIUM = { is_premium: true, subscription_status: 'active' };

function activate(newId, { db, dodo, log = spyLog(), userId = 'u1' }) {
  return activateSubscription(
    { userId, newId, values: PREMIUM },
    { store: supabaseLinkStore(db.client), subscriptions: dodo.subscriptions, log },
  );
}

// ------------------------------------------------------------------
// The link: one conditional write
// ------------------------------------------------------------------

test('linking is one conditional update on the link the account had when it was read', async () => {
  const db = fakeProfiles({ u1: { dodo_subscription_id: null }, u2: { dodo_subscription_id: 'sub_A' } });
  const store = supabaseLinkStore(db.client);

  assert.deepEqual(await store.read('u1'), { linkedId: null });
  assert.deepEqual(await store.read('u2'), { linkedId: 'sub_A' });
  assert.equal(await store.read('nobody'), null, 'no profile: the account is gone');

  assert.equal(await store.link('u1', { expectedId: null, newId: 'sub_B', values: PREMIUM }), true);
  assert.deepEqual(db.updates[0], {
    values: { ...PREMIUM, dodo_subscription_id: 'sub_B' },
    filters: [['eq', 'id', 'u1'], ['is', 'dodo_subscription_id', null]],
    matched: 1,
  });

  assert.equal(await store.link('u2', { expectedId: 'sub_A', newId: 'sub_C', values: PREMIUM }), true);
  assert.deepEqual(db.updates[1].filters, [['eq', 'id', 'u2'], ['eq', 'dodo_subscription_id', 'sub_A']]);

  // The link moved since it was read: nothing is written.
  assert.equal(await store.link('u1', { expectedId: null, newId: 'sub_D', values: PREMIUM }), false);
  assert.equal(db.row('u1').dodo_subscription_id, 'sub_B');
});

test('the link store throws on a database error rather than guessing', async () => {
  const db = fakeProfiles({ u1: {} }, { readError: { message: 'connection refused', code: 'XX000' } });
  await assert.rejects(supabaseLinkStore(db.client).read('u1'), /connection refused/);

  const failing = { from: () => {
    const b = { update: () => b, eq: () => b, is: () => b, select: () => b, then: (ok) => ok({ data: null, error: { message: 'duplicate key', code: '23505' } }) };
    return b;
  } };
  await assert.rejects(
    supabaseLinkStore(failing).link('u1', { expectedId: null, newId: 'sub_B', values: PREMIUM }),
    (err) => err.code === '23505' && /duplicate key/.test(err.message),
  );
});

// ------------------------------------------------------------------
// Cancelling at Dodo
// ------------------------------------------------------------------

test('cancelSubscriptionNow: cancelled now, already over, or still able to bill', async () => {
  const dodo = fakeDodo({ sub_A: 'active', sub_done: 'cancelled' }, { refusesRepeatCancel: true });
  assert.equal(await cancelSubscriptionNow(dodo.subscriptions, 'sub_A'), true);
  assert.equal(dodo.status('sub_A'), 'cancelled');

  // Dodo refusing to cancel what has already ended is done, not failed.
  assert.equal(await cancelSubscriptionNow(dodo.subscriptions, 'sub_done'), false);
  assert.equal(await cancelSubscriptionNow(dodo.subscriptions, 'sub_unknown'), false, 'Dodo has no such subscription');

  const stuck = fakeDodo({ sub_A: 'active' }, { failCancel: ['sub_A'] });
  await assert.rejects(cancelSubscriptionNow(stuck.subscriptions, 'sub_A'), /could not cancel/);
});

// ------------------------------------------------------------------
// subscription.active, end to end through the fakes
// ------------------------------------------------------------------

test('a first subscription links, without asking Dodo anything', async () => {
  const db = fakeProfiles({ u1: { dodo_subscription_id: null } });
  const dodo = fakeDodo({ sub_B: 'active' });
  assert.deepEqual(await activate('sub_B', { db, dodo }), { outcome: 'linked', linkedId: 'sub_B' });
  assert.equal(db.row('u1').dodo_subscription_id, 'sub_B');
  assert.equal(db.row('u1').is_premium, true);
  assert.deepEqual(dodo.calls, []);
});

test('two activations at once: only one links, the other is cancelled as a duplicate', async () => {
  const db = fakeProfiles({ u1: { dodo_subscription_id: null } });
  const dodo = fakeDodo({ sub_B: 'active', sub_C: 'active' });
  const log = spyLog();
  db.holdReads(2); // both read "no subscription" before either writes

  const results = await Promise.all([
    activate('sub_B', { db, dodo, log }),
    activate('sub_C', { db, dodo, log }),
  ]);

  const linked = db.row('u1').dodo_subscription_id;
  const other = linked === 'sub_B' ? 'sub_C' : 'sub_B';
  assert.ok(['sub_B', 'sub_C'].includes(linked));
  assert.deepEqual(results.map((r) => r.outcome).sort(), ['duplicate', 'linked']);
  assert.equal(db.updates.filter((u) => u.matched).length, 1, 'exactly one link landed');
  assert.equal(db.updates.filter((u) => !u.matched).length, 1, 'the other write matched nothing');
  assert.equal(dodo.status(linked), 'active');
  assert.equal(dodo.status(other), 'cancelled');
  const warn = log.lines.find((l) => l.level === 'warn');
  assert.ok(warn.msg.includes(other) && warn.msg.includes(linked), warn.msg);
});

test('two activations at once, the loser unable to ask Dodo: the winner stays linked, the loser fails for a redelivery', async () => {
  const db = fakeProfiles({ u1: { dodo_subscription_id: null } });
  // Only the loser's second read reaches retrieve(): the first reads saw no link.
  const dodo = fakeDodo({ sub_B: 'active', sub_C: 'active' }, { unreachable: true });
  db.holdReads(2);

  const results = await Promise.allSettled([activate('sub_B', { db, dodo }), activate('sub_C', { db, dodo })]);

  const linked = db.row('u1').dodo_subscription_id;
  const other = linked === 'sub_B' ? 'sub_C' : 'sub_B';
  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r) => r.status === 'rejected');
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1, 'the loser throws, so the webhook answers 500 and Dodo delivers it again');
  assert.deepEqual(won[0].value, { outcome: 'linked', linkedId: linked });
  assert.match(lost[0].reason.message, new RegExp(other));
  assert.equal(db.updates.filter((u) => u.matched).length, 1, 'the winner’s link is not overwritten');
  assert.deepEqual(dodo.calls.filter(([op]) => op === 'update'), [], 'nothing cancelled');
  assert.equal(dodo.status(linked), 'active');
  assert.equal(dodo.status(other), 'active');
});

test('the duplicate path: cancelled at Dodo, logged with both ids, refund left to a person', async () => {
  const db = fakeProfiles({ u1: { dodo_subscription_id: 'sub_A' } });
  const dodo = fakeDodo({ sub_A: 'active', sub_B: 'active' });
  const log = spyLog();

  assert.deepEqual(await activate('sub_B', { db, dodo, log }), { outcome: 'duplicate', linkedId: 'sub_A' });
  assert.equal(db.row('u1').dodo_subscription_id, 'sub_A', 'the account stays on its subscription');
  assert.deepEqual(db.updates, [], 'nothing written');
  assert.equal(dodo.status('sub_B'), 'cancelled');
  assert.equal(dodo.status('sub_A'), 'active');

  const warns = log.lines.filter((l) => l.level === 'warn');
  assert.equal(warns.length, 1);
  assert.match(warns[0].msg, /sub_B/);
  assert.match(warns[0].msg, /sub_A/);
  assert.match(warns[0].msg, /refund/i);
  assert.deepEqual(warns[0].rest[0], { userId: 'u1', subscriptionId: 'sub_B', linkedSubscriptionId: 'sub_A' });
  assert.deepEqual(
    dodo.calls.filter(([op]) => op === 'update'),
    [['update', 'sub_B', { status: 'cancelled' }]],
    'the only change at Dodo is the cancellation: no refund is attempted',
  );
});

test('a duplicate Dodo will not cancel fails the event, so Dodo delivers it again', async () => {
  const db = fakeProfiles({ u1: { dodo_subscription_id: 'sub_A' } });
  const dodo = fakeDodo({ sub_A: 'active', sub_B: 'active' }, { failCancel: ['sub_B'] });
  await assert.rejects(activate('sub_B', { db, dodo }), (err) => /sub_B/.test(err.message) && /sub_A/.test(err.message));
  assert.equal(db.row('u1').dodo_subscription_id, 'sub_A');
  assert.deepEqual(db.updates, []);
});

test('a duplicate delivered again after it was cancelled is not reported twice', async () => {
  const db = fakeProfiles({ u1: { dodo_subscription_id: 'sub_A' } });
  const dodo = fakeDodo({ sub_A: 'active', sub_B: 'active' }, { refusesRepeatCancel: true });
  await activate('sub_B', { db, dodo });
  const log = spyLog();
  assert.deepEqual(await activate('sub_B', { db, dodo, log }), { outcome: 'duplicate', linkedId: 'sub_A' });
  assert.equal(log.lines.filter((l) => l.level === 'warn').length, 0, 'no second "refund it" warning');
  assert.ok(log.lines.some((l) => l.level === 'info' && /already cancelled/.test(l.msg)));
});

test('on-hold replacement: the new one is linked, then the on-hold one is cancelled through Dodo', async () => {
  const timeline = [];
  const db = fakeProfiles({ u1: { dodo_subscription_id: 'sub_A' } }, { timeline });
  const dodo = fakeDodo({ sub_A: 'on_hold', sub_B: 'active' }, { timeline });
  const log = spyLog();

  assert.deepEqual(await activate('sub_B', { db, dodo, log }), { outcome: 'replaced', linkedId: 'sub_B', replacedId: 'sub_A' });
  assert.equal(db.row('u1').dodo_subscription_id, 'sub_B');
  assert.equal(db.row('u1').is_premium, true);
  assert.equal(dodo.status('sub_A'), 'cancelled');
  assert.equal(dodo.status('sub_B'), 'active');
  // Linked first: from then on every event about sub_A, the cancellation
  // this causes included, is foreign and cannot switch Premium off.
  assert.deepEqual(timeline, ['link sub_B', 'cancel sub_A']);
  assert.deepEqual(db.updates[0].filters, [['eq', 'id', 'u1'], ['eq', 'dodo_subscription_id', 'sub_A']]);
  assert.ok(log.lines.some((l) => l.level === 'info' && /sub_A/.test(l.msg) && /sub_B/.test(l.msg)));
});

test('on-hold replacement when Dodo will not cancel: the paid one stays linked and the log says what to cancel', async () => {
  const db = fakeProfiles({ u1: { dodo_subscription_id: 'sub_A' } });
  const dodo = fakeDodo({ sub_A: 'on_hold', sub_B: 'active' }, { failCancel: ['sub_A'] });
  const log = spyLog();

  assert.deepEqual(await activate('sub_B', { db, dodo, log }), { outcome: 'replaced', linkedId: 'sub_B', replacedId: 'sub_A' });
  assert.equal(db.row('u1').dodo_subscription_id, 'sub_B');
  const error = log.lines.find((l) => l.level === 'error');
  assert.ok(error, 'an error is logged');
  assert.match(error.msg, /sub_A/);
  assert.match(error.msg, /sub_B/);
  assert.match(error.msg, /cancel it in Dodo/);
});

test('the same activation delivered twice: linked once, nothing cancelled the second time', async () => {
  const db = fakeProfiles({ u1: { dodo_subscription_id: 'sub_A' } });
  const dodo = fakeDodo({ sub_A: 'on_hold', sub_B: 'active' });
  await activate('sub_B', { db, dodo });
  const before = dodo.calls.length;

  assert.deepEqual(await activate('sub_B', { db, dodo }), { outcome: 'linked', linkedId: 'sub_B' });
  assert.equal(db.row('u1').dodo_subscription_id, 'sub_B');
  assert.deepEqual(dodo.calls.slice(before), [], 'the redelivery asks Dodo nothing');
  assert.deepEqual(db.updates[1].filters, [['eq', 'id', 'u1'], ['eq', 'dodo_subscription_id', 'sub_B']]);
});

test('a returning customer whose old subscription ended is linked to the new one, nothing cancelled', async () => {
  const db = fakeProfiles({ u1: { dodo_subscription_id: 'sub_A' } });
  const dodo = fakeDodo({ sub_A: 'cancelled', sub_B: 'active' });
  assert.deepEqual(await activate('sub_B', { db, dodo }), { outcome: 'linked', linkedId: 'sub_B' });
  assert.ok(!dodo.calls.some(([op]) => op === 'update'));
});

test('when Dodo cannot be asked about the linked one, the paid subscription still links', async () => {
  const db = fakeProfiles({ u1: { dodo_subscription_id: 'sub_A' } });
  const dodo = fakeDodo({ sub_A: 'active', sub_B: 'active' }, { unreachable: true });
  const log = spyLog();
  assert.deepEqual(await activate('sub_B', { db, dodo, log }), { outcome: 'linked', linkedId: 'sub_B' });
  assert.ok(log.lines.some((l) => l.level === 'warn' && /could not check/.test(l.msg)));
});

test('an activation for a deleted account writes nothing and asks Dodo nothing', async () => {
  const db = fakeProfiles({});
  const dodo = fakeDodo({ sub_B: 'active' });
  assert.deepEqual(await activate('sub_B', { db, dodo }), { outcome: 'no_account' });
  assert.deepEqual(db.updates, []);
  assert.deepEqual(dodo.calls, []);
});

test('a link that keeps moving gives up after MAX_LINK_ATTEMPTS, so Dodo delivers again', async () => {
  let reads = 0;
  const store = {
    async read() { reads += 1; return { linkedId: null }; },
    async link() { return false; },
  };
  const dodo = fakeDodo({ sub_B: 'active' });
  await assert.rejects(
    activateSubscription({ userId: 'u1', newId: 'sub_B', values: PREMIUM }, { store, subscriptions: dodo.subscriptions, log: spyLog() }),
    /sub_B/,
  );
  assert.equal(reads, MAX_LINK_ATTEMPTS);
});

test('a database that cannot be read fails the activation instead of linking blind', async () => {
  const db = fakeProfiles({ u1: {} }, { readError: { message: 'connection refused' } });
  await assert.rejects(activate('sub_B', { db, dodo: fakeDodo({ sub_B: 'active' }) }), /connection refused/);
  assert.deepEqual(db.updates, []);
});
