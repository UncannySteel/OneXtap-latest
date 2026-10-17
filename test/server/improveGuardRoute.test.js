/**
 * The Improve guard through the real route: POST /api/answer-vault/generate
 * with fake Supabase and Groq on loopback (./fakeServices.js), as in
 * generationCharging.test.js.
 *
 * What is pinned here is WHICH requests get the Improve rule and the guard:
 * only Answer Studio's Improve, an explicit `kind: 'answer'` with a draft.
 * A cover letter's draft is the user's template and its task hint asks for the
 * company, the role and the posting's requirements by name, so the rule and a
 * retry would strip exactly what it is for. A client that sends no kind gets
 * exactly the prompt it always had.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { startHarness } from './harness.js';
import { fakeSupabase, fakeGroq } from './fakeServices.js';
import { memorySpendStore } from '../../server/lib/generationSpend.js';

const store = memorySpendStore();
const users = {};
const supabase = fakeSupabase({ store, users });
const groq = fakeGroq();

const harness = await startHarness({ fakes: { SUPABASE_URL: supabase.handler, GROQ_BASE_URL: groq.handler } });
test.after(() => harness.close());

const { IMPROVE_FACTS_RULE } = await import('../../server/prompts/answerVault.js');

function account() {
  const id = randomUUID();
  const token = `token-${id}`;
  users[token] = { id, email: `${id.slice(0, 8)}@example.com` };
  store.setAccount(id, { credits: 10, isPremium: false });
  return { id, token };
}

async function generate(who, body) {
  const res = await harness.request('POST', '/api/answer-vault/generate', {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${who.token}` },
    body,
  });
  return { status: res.status, body: res.body ? JSON.parse(res.body) : null };
}

const CORPUS = [
  { ref: 'exp.0', text: 'Backend Engineer, Kestrel Analytics, 2019 - 2023' },
  { ref: 'exp.0.b0', text: 'Built a billing service in Node.js and PostgreSQL that processed 2 million invoices a month' },
  { ref: 'skills.0', text: 'Node.js' },
];
const DRAFT = 'At Kestrel Analytics I built a billing service in Node.js that processed 2 million invoices a month.';
const INVENTED = `${DRAFT} I also led a team of 12 engineers and cut infrastructure costs by 40% using Kubernetes.`;
// The added sentence asserts nothing the check grades (no first person, no
// number), so CLEAN has no flags at all.
const CLEAN = `${DRAFT} That service is still in production today.`;

/** First call answers INVENTED, any later call CLEAN. */
function inventThenClean() {
  const start = groq.calls.length;
  groq.state.reply = (_body, n) => ({ content: n === start + 1 ? INVENTED : CLEAN });
  return () => groq.calls.slice(start);
}

const userTurn = (call) => call.messages.filter((m) => m.role === 'user')[0].content;

test('Answer Studio Improve: the rule is in the prompt, and an invented claim gets one retry', async () => {
  const calls = inventThenClean();
  const res = await generate(account(), {
    question: 'Tell us about a project.', draft: DRAFT, corpus: CORPUS, kind: 'answer',
    jobContext: 'Company: Acme Robotics\n\nRequirements: Kubernetes.',
  });

  assert.equal(res.status, 200);
  assert.equal(calls().length, 2, 'the first answer and one retry');
  assert.ok(userTurn(calls()[0]).includes(IMPROVE_FACTS_RULE));
  assert.deepEqual(calls()[1].messages.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(res.body.text, CLEAN, 'the cleaner retry is what the user gets');
  assert.deepEqual(res.body.fabricationFlags, [], 'with the flags of the answer returned');
  assert.equal(res.body.charge.charged, true);
});

test('a cover letter gets no Improve rule and no retry, invented claim or not', async () => {
  const calls = inventThenClean();
  const res = await generate(account(), {
    question: 'Cover Letter for this application',
    draft: 'Dear team, I am applying for the role.',
    corpus: CORPUS,
    kind: 'cover_letter',
    jobContext: 'Organization: Acme Robotics\nRole: Platform Engineer\n\nRequirements: Kubernetes.',
  });

  assert.equal(res.status, 200);
  assert.equal(calls().length, 1, 'one call: a cover letter is never retried');
  assert.ok(!userTurn(calls()[0]).includes(IMPROVE_FACTS_RULE));
  assert.equal(res.body.text, INVENTED, 'returned as written, with its flags for the user to see');
  assert.ok(res.body.fabricationFlags.length > 0);
});

test('a client that sends no kind gets exactly the old prompt and no retry', async () => {
  const calls = inventThenClean();
  const res = await generate(account(), { question: 'Tell us about a project.', draft: DRAFT, corpus: CORPUS });

  assert.equal(res.status, 200);
  assert.equal(calls().length, 1);
  assert.ok(!userTurn(calls()[0]).includes(IMPROVE_FACTS_RULE));
  assert.equal(res.body.text, INVENTED);
});

test('an Answer Studio first draft (no draft to improve) gets no rule and no retry', async () => {
  const calls = inventThenClean();
  const res = await generate(account(), { question: 'Tell us about a project.', corpus: CORPUS, kind: 'answer' });

  assert.equal(res.status, 200);
  assert.equal(calls().length, 1);
  assert.ok(!userTurn(calls()[0]).includes(IMPROVE_FACTS_RULE));
});

test('a failed retry still returns the first answer, charged once, with 200', async () => {
  const start = groq.calls.length;
  groq.state.reply = (_body, n) => (n === start + 1 ? { content: INVENTED } : { status: 503, message: 'overloaded' });
  const who = account();
  const res = await generate(who, { question: 'Tell us about a project.', draft: DRAFT, corpus: CORPUS, kind: 'answer' });

  assert.equal(res.status, 200);
  assert.equal(groq.calls.length - start, 2);
  assert.equal(res.body.text, INVENTED);
  assert.equal(res.body.charge.charged, true);
  assert.equal(store.account(who.id).credits, 9, 'one credit, not refunded and not charged twice');
});
