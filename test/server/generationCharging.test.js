/**
 * Server-side charging, through the real app: POST /api/answer-vault/generate,
 * POST /api/credits/deduct and POST /api/jobs/explain, with fake Supabase and
 * Groq on loopback (./fakeServices.js). The fake database runs
 * server/lib/generationSpend.js's memory store, the same rules as migration
 * 007's functions; the server's own Supabase store, supabase-js and
 * requireAuth are the real ones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startHarness } from './harness.js';
import { fakeSupabase, fakeGroq } from './fakeServices.js';
import { memorySpendStore } from '../../server/lib/generationSpend.js';
import { applicationKey } from '../../src/coverLetterCredits.js';
import { validateAgainstCorpus } from '../../src/matching/index.js';

const store = memorySpendStore();
const users = {};
const supabase = fakeSupabase({ store, users });
const groq = fakeGroq();
const defaultReply = groq.state.reply;

const harness = await startHarness({ fakes: { SUPABASE_URL: supabase.handler, GROQ_BASE_URL: groq.handler } });
test.after(() => harness.close());

/** A new signed-in account. `credits: null` leaves it with no profiles row. */
function account({ credits = 3, isPremium = false } = {}) {
  const id = randomUUID();
  const token = `token-${id}`;
  users[token] = { id, email: `${id.slice(0, 8)}@example.com` };
  if (credits !== null) store.setAccount(id, { credits, isPremium });
  return { id, token };
}

async function post(path, token, body) {
  const res = await harness.request('POST', path, {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body,
  });
  return { status: res.status, body: res.body ? JSON.parse(res.body) : null };
}
const generate = (who, body) => post('/api/answer-vault/generate', who.token, body);

const modelCalls = () => groq.calls.length;
const txFor = (who) => store.transactions.filter((t) => t.userId === who.id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const JOB_DESCRIPTION = 'Senior Backend Engineer. Requirements: Python, PostgreSQL.';
const JOB = `Organization: Norwick Labs\n${JOB_DESCRIPTION}`;

test('a generation is charged before it runs: one credit, the usage row, three improvements granted', async () => {
  const who = account({ credits: 2 });
  const before = modelCalls();
  const res = await generate(who, { question: 'Why do you want to work here?', kind: 'answer' });
  assert.equal(res.status, 200);
  assert.match(res.body.text, /^Draft number \d+/);
  assert.equal(res.body.charge.charged, true);
  assert.equal(res.body.charge.premium, false);
  assert.equal(res.body.charge.followUpsLeft, 3);
  assert.equal(res.body.charge.credits, 1);
  assert.match(res.body.charge.allowanceId, UUID);
  assert.equal(store.account(who.id).credits, 1);
  assert.deepEqual(txFor(who), [{ userId: who.id, amount: -1, type: 'usage', description: 'Answer Studio generation' }]);
  assert.equal(modelCalls(), before + 1);
});

test('an answer’s three improvements are free, then the next one is paid', async () => {
  const who = account({ credits: 2 });
  const first = await generate(who, { question: 'Why us?', kind: 'answer' });
  let allowanceId = first.body.charge.allowanceId;
  for (const left of [2, 1, 0]) {
    const res = await generate(who, { question: 'Why us?', draft: 'My draft.', kind: 'answer', allowanceId });
    assert.equal(res.status, 200);
    assert.equal(res.body.charge.charged, false, `improvement with ${left} left after it`);
    assert.equal(res.body.charge.followUpsLeft, left);
    assert.equal(res.body.charge.credits, 1);
    if (left > 0) assert.equal(res.body.charge.allowanceId, allowanceId);
    else assert.equal(res.body.charge.allowanceId, null, 'nothing left to keep');
  }
  const paid = await generate(who, { question: 'Why us?', kind: 'answer', allowanceId });
  assert.equal(paid.body.charge.charged, true);
  assert.equal(paid.body.charge.credits, 0);
  assert.equal(txFor(who).length, 2);
});

test('a cover letter’s re-run is free for the same job context, and another job is paid', async () => {
  const who = account({ credits: 2 });
  const body = { question: 'Cover Letter for this application', draft: 'Dear team,', jobContext: JOB, kind: 'cover_letter' };
  const paid = await generate(who, body);
  assert.equal(paid.body.charge.charged, true);
  assert.equal(paid.body.charge.followUpsLeft, 1);
  // The server keyed it itself, from the description it was sent.
  assert.equal(store.allowances.get(paid.body.charge.allowanceId).subjectKey, applicationKey(JOB_DESCRIPTION));

  const other = await generate(who, { ...body, jobContext: 'Organization: Kestrel\nPlatform Engineer.', allowanceId: paid.body.charge.allowanceId });
  assert.equal(other.body.charge.charged, true, 'another description is another application');

  // A different company and role on the same description: still the re-run.
  const rerun = await generate(who, { ...body, jobContext: `Organization: Norwick Labs Ltd\nRole: Staff Engineer\n\n${JOB_DESCRIPTION}`, allowanceId: paid.body.charge.allowanceId });
  assert.equal(rerun.status, 200);
  assert.equal(rerun.body.charge.charged, false);
  assert.equal(rerun.body.charge.followUpsLeft, 0);
  assert.equal(store.account(who.id).credits, 0);
});

test('out of credits: 403, nothing generated, nothing written', async () => {
  const who = account({ credits: 0 });
  const before = modelCalls();
  const res = await generate(who, { question: 'Why us?', kind: 'answer' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'No credits remaining');
  assert.equal(modelCalls(), before, 'the model was never called');
  assert.deepEqual(txFor(who), []);
});

test('Premium: generated, never charged, nothing granted', async () => {
  const who = account({ credits: 0, isPremium: true });
  for (const kind of ['answer', 'cover_letter']) {
    const res = await generate(who, { question: 'Q', jobContext: JOB, kind });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.charge, { charged: false, premium: true, allowanceId: null, followUpsLeft: null, credits: null });
  }
  assert.deepEqual(txFor(who), []);
  assert.equal(store.account(who.id).credits, 0);
});

test('an old client (no kind) is charged every call and granted nothing', async () => {
  const who = account({ credits: 3 });
  const res = await generate(who, { question: 'Cover Letter for this application', draft: 'Dear team,', jobContext: JOB });
  assert.equal(res.status, 200);
  assert.equal(res.body.text.length > 0, true, 'the response is what it was');
  assert.deepEqual(res.body.charge, { charged: true, premium: false, allowanceId: null, followUpsLeft: 0, credits: 2 });
  // Its "free re-run" is not free any more.
  const again = await generate(who, { question: 'Cover Letter for this application', draft: 'Dear team,', jobContext: JOB });
  assert.equal(again.body.charge.charged, true);
  assert.equal(store.account(who.id).credits, 1);
  assert.deepEqual(txFor(who).map((t) => t.description), ['AI generation credit used', 'AI generation credit used']);
});

test('POST /api/credits/deduct is a no-op: it answers with the balance and charges nothing', async () => {
  const who = account({ credits: 2 });
  const res = await post('/api/credits/deduct', who.token);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { success: true, remaining: 2, isPremium: false, charged: false });
  assert.equal(store.account(who.id).credits, 2);

  // An old Answer Studio page, after a generation that took the last credit:
  // success, so it does not report a failure for a generation it got.
  const broke = account({ credits: 0 });
  assert.deepEqual((await post('/api/credits/deduct', broke.token)).body, { success: true, remaining: 0, isPremium: false, charged: false });

  const premium = account({ credits: 0, isPremium: true });
  assert.deepEqual((await post('/api/credits/deduct', premium.token)).body, { success: true, remaining: null, isPremium: true, charged: false });
  assert.deepEqual([...txFor(who), ...txFor(broke), ...txFor(premium)], []);
  assert.equal(supabase.calls.filter((c) => c.path.startsWith('/rest/v1/rpc/')).every((c) => !c.body || c.body.p_user !== who.id), true);
});

test('migration 007 missing: 503, an error log naming it, and the model is never called', async () => {
  const who = account({ credits: 3 });
  const logsBefore = harness.logs.length;
  supabase.options.migrated = false;
  try {
    const before = modelCalls();
    for (const kind of ['answer', 'cover_letter', undefined]) {
      const res = await generate(who, { question: 'Why us?', jobContext: JOB, ...(kind ? { kind } : {}) });
      assert.equal(res.status, 503, `kind ${kind}`);
      assert.match(res.body.error, /nothing was generated/i);
    }
    assert.equal(modelCalls(), before, 'the model was never called');

    // Explain charges after its analysis, so it has run the model by then;
    // the user still gets nothing for free.
    groq.state.reply = () => ({ content: JSON.stringify({ fitAnalysis: 'A good fit.', gaps: [], strengths: [] }) });
    const explain = await post('/api/jobs/explain', who.token, { job: { title: 'Backend Engineer' } });
    assert.equal(explain.status, 503, 'explain fails closed too');
    assert.equal(explain.body.fitAnalysis, undefined);
  } finally {
    supabase.options.migrated = true;
    groq.state.reply = defaultReply;
  }
  assert.equal(store.account(who.id).credits, 3);
  assert.deepEqual(txFor(who), []);
  const named = harness.logs.slice(logsBefore).filter((r) => r.level === 'error' && r.msg.includes('supabase/migrations/007_generation_charges.sql'));
  assert.ok(named.length >= 4, 'each refusal is an error log naming the migration');
});

test('a generation that fails after its charge gives the credit back, once', async () => {
  const who = account({ credits: 1 });
  groq.state.reply = () => ({ status: 500, message: 'upstream exploded' });
  try {
    const res = await generate(who, { question: 'Why us?', kind: 'answer' });
    assert.equal(res.status, 502);
  } finally {
    groq.state.reply = defaultReply;
  }
  assert.equal(store.account(who.id).credits, 1);
  assert.deepEqual(txFor(who).map((t) => [t.amount, t.type]), [[-1, 'usage'], [1, 'refund']]);
  assert.equal([...store.allowances.values()].some((a) => a.userId === who.id), false, 'the refunded charge grants nothing');
});

test('a free improvement that fails gets its use back', async () => {
  const who = account({ credits: 1 });
  const paid = await generate(who, { question: 'Why us?', kind: 'answer' });
  const { allowanceId } = paid.body.charge;
  groq.state.reply = () => ({ status: 500 });
  try {
    assert.equal((await generate(who, { question: 'Why us?', kind: 'answer', allowanceId })).status, 502);
  } finally {
    groq.state.reply = defaultReply;
  }
  assert.equal(store.allowances.get(allowanceId).remaining, 3);
  const next = await generate(who, { question: 'Why us?', kind: 'answer', allowanceId });
  assert.equal(next.body.charge.followUpsLeft, 2);
  assert.equal(txFor(who).length, 1, 'one charge, no refund');
});

// The route's own refusals after generateDraft(): text too short to be an
// answer, and an answer cut off at the token limit. Both throw after the spend.
const AFTER_SPEND_FAILURES = [
  ['an incomplete answer', () => ({ content: 'Ok.' }), /incomplete answer/i],
  ['an answer cut off at the token limit', () => ({ content: 'A long answer that stops mid-sentence because', finish: 'length' }), /output limit/i],
];

for (const [what, reply, message] of AFTER_SPEND_FAILURES) {
  test(`${what} is refused, and its charge comes back with exactly one refund row`, async () => {
    const who = account({ credits: 1 });
    groq.state.reply = reply;
    let res;
    try {
      res = await generate(who, { question: 'Why us?', kind: 'answer' });
    } finally {
      groq.state.reply = defaultReply;
    }
    assert.equal(res.status, 502);
    assert.match(res.body.error, message);
    assert.equal(res.body.charge, undefined);
    assert.equal(store.account(who.id).credits, 1);
    assert.deepEqual(txFor(who).map((t) => [t.amount, t.type]), [[-1, 'usage'], [1, 'refund']]);
    assert.equal([...store.allowances.values()].some((a) => a.userId === who.id), false, 'the refunded charge grants nothing');
  });

  test(`${what} on a free improvement gives the improvement back, and writes no refund`, async () => {
    const who = account({ credits: 1 });
    const paid = await generate(who, { question: 'Why us?', kind: 'answer' });
    const { allowanceId } = paid.body.charge;
    groq.state.reply = reply;
    let res;
    try {
      res = await generate(who, { question: 'Why us?', draft: 'My draft answer.', kind: 'answer', allowanceId });
    } finally {
      groq.state.reply = defaultReply;
    }
    assert.equal(res.status, 502);
    assert.match(res.body.error, message);
    assert.equal(store.allowances.get(allowanceId).remaining, 3, 'the improvement is back');
    assert.equal(store.account(who.id).credits, 0);
    assert.deepEqual(txFor(who).map((t) => t.type), ['usage'], 'one charge, no refund');
  });
}

// B2-C's Improve guard (server/lib/improveGuard.js): an improved draft that
// adds unbacked claims is asked once more, inside the same request. Fixtures
// from test/server/improveGuard.test.js; the claim is in no job context.
const RESUME = [
  { ref: 'exp.0', text: 'Backend Engineer, Kestrel Analytics, 2019 - 2023' },
  { ref: 'exp.0.b0', text: 'Built a billing service in Node.js and PostgreSQL that processed 2 million invoices a month' },
  { ref: 'exp.0.b1', text: 'Mentored 3 junior engineers through their first on-call rotation' },
  { ref: 'skills.0', text: 'Node.js' },
  { ref: 'skills.1', text: 'PostgreSQL' },
];
const BACKED_DRAFT = 'At Kestrel Analytics I built a billing service in Node.js that processed 2 million invoices a month. I also mentored 3 junior engineers.';
const INVENTED = 'At Kestrel Analytics I built a billing service in Node.js and PostgreSQL that processed 2 million invoices a month. I also led a team of 12 engineers and cut infrastructure costs by 40% using Kubernetes. I mentored 3 junior engineers through their first on-call rotation.';
const CLEAN = 'At Kestrel Analytics I built a billing service in Node.js and PostgreSQL that processed 2 million invoices a month. I mentored 3 junior engineers through their first on-call rotation, and I kept the service reliable as volume grew.';

test('fixtures: the draft and the clean answer are backed by the resume, the invented one is not', () => {
  assert.equal(validateAgainstCorpus(BACKED_DRAFT, RESUME).flags.length, 0);
  assert.equal(validateAgainstCorpus(CLEAN, RESUME).flags.length, 0);
  assert.ok(validateAgainstCorpus(INVENTED, RESUME).flags.length > 0);
});

test('the Improve retry is part of the paid request: two model calls, one charge, the clean text', async () => {
  const who = account({ credits: 2 });
  const before = modelCalls();
  const spendsBefore = supabase.calls.filter((c) => c.path === '/rest/v1/rpc/spend_generation').length;
  groq.state.reply = (_body, n) => ({ content: n === before + 1 ? INVENTED : CLEAN });
  let res;
  try {
    res = await generate(who, {
      question: 'Tell us about a system you built.',
      draft: BACKED_DRAFT,
      jobContext: 'Company: Norwick Labs\n\nSenior Backend Engineer. Requirements: Node.js, PostgreSQL.',
      corpus: RESUME,
      kind: 'answer',
    });
  } finally {
    groq.state.reply = defaultReply;
  }
  assert.equal(res.status, 200);
  assert.equal(modelCalls(), before + 2, 'the first answer, then one retry');
  assert.equal(res.body.text, CLEAN);
  assert.deepEqual(res.body.fabricationFlags, []);
  // One spend, one usage row, the balance down by exactly one.
  assert.equal(supabase.calls.filter((c) => c.path === '/rest/v1/rpc/spend_generation').length, spendsBefore + 1);
  assert.deepEqual(txFor(who), [{ userId: who.id, amount: -1, type: 'usage', description: 'Answer Studio generation' }]);
  assert.equal(store.account(who.id).credits, 1);
  assert.deepEqual(res.body.charge, { charged: true, premium: false, allowanceId: res.body.charge.allowanceId, followUpsLeft: 3, credits: 1 });
  // The retry continues the first answer's conversation.
  const retry = groq.calls.at(-1);
  assert.equal(retry.messages.length, 4);
  assert.equal(retry.messages[2].content, INVENTED);
});

test('two concurrent requests holding one credit: one is generated, the other refused, one model call', async () => {
  const who = account({ credits: 1 });
  const before = modelCalls();
  const results = await Promise.all([
    generate(who, { question: 'Why us?', kind: 'answer' }),
    generate(who, { question: 'Why us?', kind: 'answer' }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 403]);
  assert.equal(modelCalls(), before + 1);
  assert.equal(store.account(who.id).credits, 0);
  assert.equal(txFor(who).length, 1);
});

test('an unknown kind is a 400, before anything is spent', async () => {
  const who = account({ credits: 1 });
  const before = modelCalls();
  const res = await generate(who, { question: 'Why us?', kind: 'explain' });
  assert.equal(res.status, 400);
  assert.equal(modelCalls(), before);
  assert.equal(store.account(who.id).credits, 1);
});

test('an allowance id that is not one is no allowance: the request is charged', async () => {
  const who = account({ credits: 2 });
  const res = await generate(who, { question: 'Why us?', kind: 'answer', allowanceId: "x' or 1=1" });
  assert.equal(res.status, 200);
  assert.equal(res.body.charge.charged, true);
  const spendCall = supabase.calls.filter((c) => c.path === '/rest/v1/rpc/spend_generation').at(-1);
  assert.equal(spendCall.body.p_allowance, null);
});

test('no profile row yet: it is created with the welcome credits, then charged', async () => {
  const who = account({ credits: null });
  const res = await generate(who, { question: 'Why us?', kind: 'answer' });
  assert.equal(res.status, 200);
  assert.equal(res.body.charge.charged, true);
  assert.equal(res.body.charge.credits, 2);
});

test('the client cannot choose what a charge grants', async () => {
  const who = account({ credits: 1 });
  const res = await generate(who, { question: 'Why us?', kind: 'answer', free: 99, p_free: 99, followUpsLeft: 99 });
  assert.equal(res.body.charge.followUpsLeft, 3);
  const spendCall = supabase.calls.filter((c) => c.path === '/rest/v1/rpc/spend_generation').at(-1);
  assert.equal(spendCall.body.p_free, 3);
});

test('Explain my fit is charged through the same atomic spend, after its analysis', async () => {
  const who = account({ credits: 2 });
  groq.state.reply = () => ({ content: JSON.stringify({ fitAnalysis: 'A good fit.', gaps: [], strengths: ['Python'] }) });
  let res;
  try {
    res = await post('/api/jobs/explain', who.token, { job: { title: 'Backend Engineer' } });
  } finally {
    groq.state.reply = defaultReply;
  }
  assert.equal(res.status, 200);
  assert.equal(res.body.fitAnalysis, 'A good fit.');
  assert.equal(res.body.creditsRemaining, 1);
  assert.equal(res.body.isPremium, false);
  const spendCall = supabase.calls.filter((c) => c.path === '/rest/v1/rpc/spend_generation' && c.body.p_user === who.id).at(-1);
  assert.equal(spendCall.body.p_kind, 'explain');
  assert.equal(spendCall.body.p_free, 0);
  assert.deepEqual(txFor(who), [{ userId: who.id, amount: -1, type: 'usage', description: 'Job fit analysis' }]);
});

test('Explain my fit at zero credits: 403, before the model', async () => {
  const who = account({ credits: 0 });
  const before = modelCalls();
  const res = await post('/api/jobs/explain', who.token, { job: { title: 'Backend Engineer' } });
  assert.equal(res.status, 403);
  assert.equal(modelCalls(), before);
});

test('refundOneCredit() gives back the charge it is handed, once, and nothing without one', async () => {
  // The same module instance the app uses (its Supabase client is the fake's).
  const { chargeOneCredit, refundOneCredit } = await import('../../server/lib/credits.js');
  const who = account({ credits: 1 });
  const charge = await chargeOneCredit(who.id, null, 'Job fit analysis');
  assert.equal(charge.charged, true);
  assert.equal(charge.remaining, 0);

  await refundOneCredit(who.id, null, 'Credit refunded (failed job fit analysis)', charge);
  assert.equal(store.account(who.id).credits, 1);
  await refundOneCredit(who.id, null, 'Credit refunded (failed job fit analysis)', charge);
  await refundOneCredit(who.id, null, 'Credit refunded (failed job fit analysis)');
  assert.equal(store.account(who.id).credits, 1, 'a second refund of one charge, or one with no charge, gives nothing');
  assert.deepEqual(txFor(who).map((t) => t.type), ['usage', 'refund']);

  const premium = account({ credits: 0, isPremium: true });
  const free = await chargeOneCredit(premium.id, null, 'Job fit analysis');
  assert.deepEqual([free.charged, free.remaining], [false, Infinity]);
  await refundOneCredit(premium.id, null, 'Credit refunded (failed job fit analysis)', free);
  assert.equal(store.account(premium.id).credits, 0);
});

test('nothing in these tests reached past loopback', () => {
  assert.deepEqual(harness.blocked, []);
});
