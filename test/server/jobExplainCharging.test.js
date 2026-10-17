/**
 * "Explain my fit" pays before its analysis, through the real app:
 * POST /api/jobs/explain with fake Supabase and Groq on loopback
 * (./fakeServices.js). The order is Answer Studio's (server/routes/generate.js):
 * validate, spend (kind 'explain', no follow-ups), then the model, and the
 * spend given back once if anything after it fails. The fake database runs
 * server/lib/generationSpend.js's memory store, the same rules as migration
 * 007's functions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startHarness } from './harness.js';
import { fakeSupabase, fakeGroq } from './fakeServices.js';
import { memorySpendStore, MIGRATION_FILE } from '../../server/lib/generationSpend.js';

const store = memorySpendStore();
const users = {};
const supabase = fakeSupabase({ store, users });
const groq = fakeGroq();

/** Every request either fake served, in the order it arrived. */
const events = [];
const pathOf = (req) => new URL(req.url, 'http://fake').pathname;

const harness = await startHarness({
  fakes: {
    SUPABASE_URL: (req, res) => {
      events.push(`supabase ${req.method} ${pathOf(req)}`);
      return supabase.handler(req, res);
    },
    GROQ_BASE_URL: (req, res) => {
      events.push(`groq ${pathOf(req)}`);
      return groq.handler(req, res);
    },
  },
});
test.after(() => harness.close());

const ANALYSIS = { fitAnalysis: 'A good fit.', gaps: [{ requirement: 'Go' }], strengths: [{ evidence: 'Python' }] };
const analysisReply = () => ({ content: JSON.stringify(ANALYSIS) });
groq.state.reply = analysisReply;

const JOB = { title: 'Backend Engineer', company: 'Norwick Labs' };

/** A new signed-in account with a profiles row. */
function account({ credits = 3, isPremium = false } = {}) {
  const id = randomUUID();
  const token = `token-${id}`;
  users[token] = { id, email: `${id.slice(0, 8)}@example.com` };
  store.setAccount(id, { credits, isPremium });
  return { id, token };
}

async function explain(who, body = { job: JOB }) {
  const res = await harness.request('POST', '/api/jobs/explain', {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${who.token}` },
    body,
  });
  return { status: res.status, body: res.body ? JSON.parse(res.body) : null };
}

/** Run `fn` with the fake Groq answering `reply`, then put the analysis back. */
async function withReply(reply, fn) {
  groq.state.reply = reply;
  try {
    return await fn();
  } finally {
    groq.state.reply = analysisReply;
  }
}

const modelCalls = () => groq.calls.length;
const txFor = (who) => store.transactions.filter((t) => t.userId === who.id);
const rpcCallsFor = (who, fn) => supabase.calls.filter((c) => c.path === `/rest/v1/rpc/${fn}` && c.body?.p_user === who.id);
const profileReadsFor = (who) => supabase.calls.filter((c) => c.method === 'GET' && c.path === '/rest/v1/profiles' && c.search.includes(who.id));
const allowancesFor = (who) => [...store.allowances.values()].filter((a) => a.userId === who.id);

test('a charge: the spend comes first, then the model; one credit, kind explain, no follow-ups', async () => {
  const who = account({ credits: 2 });
  const mark = events.length;
  const res = await explain(who);

  assert.equal(res.status, 200);
  // The response keeps its shape.
  assert.deepEqual(Object.keys(res.body).sort(), ['creditsRemaining', 'fitAnalysis', 'gaps', 'isPremium', 'strengths', 'tailoringSuggestions']);
  assert.equal(res.body.fitAnalysis, 'A good fit.');
  assert.equal(res.body.creditsRemaining, 1);
  assert.equal(res.body.isPremium, false);

  const seen = events.slice(mark);
  const spendAt = seen.indexOf('supabase POST /rest/v1/rpc/spend_generation');
  const modelAt = seen.findIndex((e) => e.startsWith('groq '));
  assert.ok(spendAt >= 0 && modelAt >= 0, `both happened: ${seen.join(', ')}`);
  assert.ok(spendAt < modelAt, `the spend comes before the model: ${seen.join(', ')}`);

  const [spendCall] = rpcCallsFor(who, 'spend_generation');
  assert.equal(spendCall.body.p_kind, 'explain');
  assert.equal(spendCall.body.p_free, 0);
  assert.equal(spendCall.body.p_allowance, null);
  assert.equal(store.account(who.id).credits, 1);
  assert.deepEqual(txFor(who), [{ userId: who.id, amount: -1, type: 'usage', description: 'Job fit analysis' }]);
  assert.deepEqual(allowancesFor(who).map((a) => [a.kind, a.remaining]), [['explain', 0]], 'the charge’s receipt grants nothing');
  // The spend decides: the route no longer reads the balance first.
  assert.deepEqual(profileReadsFor(who), []);
});

test('out of credits: 403, and the model is never called', async () => {
  const who = account({ credits: 0 });
  const before = modelCalls();
  const res = await explain(who);
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'No credits remaining');
  assert.equal(res.body.fitAnalysis, undefined);
  assert.equal(modelCalls(), before, 'the model was never called');
  assert.equal(rpcCallsFor(who, 'spend_generation').length, 1, 'the spend refused it');
  assert.deepEqual(profileReadsFor(who), [], 'no balance read before the spend');
  assert.deepEqual(txFor(who), []);
});

test('migration 007 missing: 503, the model is never called, and the error log names migration 007', async () => {
  const who = account({ credits: 3 });
  const before = modelCalls();
  const logsBefore = harness.logs.length;
  supabase.options.migrated = false;
  let res;
  try {
    res = await explain(who);
  } finally {
    supabase.options.migrated = true;
  }
  assert.equal(res.status, 503);
  assert.match(res.body.error, /nothing was generated or charged/i);
  assert.equal(res.body.fitAnalysis, undefined);
  assert.equal(modelCalls(), before, 'the model was never called');
  assert.equal(store.account(who.id).credits, 3);
  assert.deepEqual(txFor(who), []);
  const named = harness.logs.slice(logsBefore).filter((r) => r.level === 'error' && String(r.msg).includes(MIGRATION_FILE));
  assert.equal(named.length, 1, 'one error log naming the migration');
  assert.equal(named[0].kind, 'explain');
});

test('Premium: analysed, never charged, creditsRemaining null', async () => {
  const who = account({ credits: 0, isPremium: true });
  const before = modelCalls();
  const res = await explain(who);
  assert.equal(res.status, 200);
  assert.equal(res.body.fitAnalysis, 'A good fit.');
  assert.equal(res.body.creditsRemaining, null);
  assert.equal(res.body.isPremium, true);
  assert.equal(modelCalls(), before + 1);
  assert.equal(store.account(who.id).credits, 0);
  assert.deepEqual(txFor(who), []);
  assert.deepEqual(allowancesFor(who), []);
});

const FAILED_ANALYSES = [
  ['the model fails', () => ({ status: 500, message: 'upstream exploded' }), null],
  ['the reply is cut off and does not parse', () => ({ content: '{"fitAnalysis": "A good fit, beca' }),
    /^The fit analysis came back incomplete\. Try again; your credit was given back\.$/],
];

for (const [what, reply, message] of FAILED_ANALYSES) {
  test(`a failed analysis (${what}) gives the credit back: one undo, one refund row`, async () => {
    const who = account({ credits: 1 });
    const res = await withReply(reply, () => explain(who));
    assert.equal(res.status, 502);
    assert.equal(res.body.fitAnalysis, undefined);
    if (message) assert.match(res.body.error, message);
    assert.equal(store.account(who.id).credits, 1);
    assert.deepEqual(txFor(who).map((t) => [t.amount, t.type, t.description]), [
      [-1, 'usage', 'Job fit analysis'],
      [1, 'refund', 'Credit refunded (failed job fit analysis)'],
    ]);
    assert.equal(rpcCallsFor(who, 'undo_generation').length, 1, 'undone exactly once');
    assert.deepEqual(allowancesFor(who), [], 'the refunded charge’s receipt is gone');
  });
}

test('an incomplete analysis on Premium says nothing about credits', async () => {
  const who = account({ credits: 0, isPremium: true });
  const res = await withReply(() => ({ content: '{"fitAnalysis": "A good fit, beca' }), () => explain(who));
  assert.equal(res.status, 502);
  assert.equal(res.body.error, 'The fit analysis came back incomplete. Try again.');
  assert.deepEqual(txFor(who), []);
  assert.deepEqual(rpcCallsFor(who, 'undo_generation'), [], 'nothing to give back');
});

test('a failed tailoring pass keeps the analysis and its charge', async () => {
  const who = account({ credits: 2 });
  const first = modelCalls() + 1;
  const corpus = [{ ref: 'exp.0', kind: 'experience', text: 'Built a billing service in Python' }];
  const res = await withReply(
    (_body, n) => (n === first ? { content: JSON.stringify(ANALYSIS) } : { status: 500 }),
    () => explain(who, { job: JOB, corpus }),
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.fitAnalysis, 'A good fit.');
  assert.deepEqual(res.body.tailoringSuggestions, []);
  assert.equal(res.body.creditsRemaining, 1);
  assert.deepEqual(txFor(who).map((t) => t.type), ['usage'], 'charged, not refunded');
  assert.deepEqual(rpcCallsFor(who, 'undo_generation'), []);
});

test('two concurrent requests holding one credit: one runs the model, the other gets 403 without calling it', async () => {
  const who = account({ credits: 1 });
  const before = modelCalls();
  const results = await Promise.all([explain(who), explain(who)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 403]);
  assert.equal(modelCalls(), before + 1, 'one analysis, for the request that paid');
  assert.equal(store.account(who.id).credits, 0);
  assert.equal(txFor(who).length, 1);
});

test('a request with no job is a 400, before anything is spent', async () => {
  const who = account({ credits: 1 });
  const before = modelCalls();
  const res = await explain(who, { job: { title: '  ' } });
  assert.equal(res.status, 400);
  assert.equal(modelCalls(), before);
  assert.deepEqual(rpcCallsFor(who, 'spend_generation'), []);
});

test('a server with no Groq key refuses before the spend: nothing charged, nothing refunded', async () => {
  const who = account({ credits: 1 });
  const key = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  let res;
  try {
    res = await explain(who);
  } finally {
    process.env.GROQ_API_KEY = key;
  }
  assert.equal(res.status, 502);
  assert.match(res.body.error, /GROQ_API_KEY/);
  assert.deepEqual(rpcCallsFor(who, 'spend_generation'), []);
  assert.equal(store.account(who.id).credits, 1);
  assert.deepEqual(txFor(who), []);
});

test('nothing in these tests reached past loopback', () => {
  assert.deepEqual(harness.blocked, []);
});
