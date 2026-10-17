/**
 * The Improve guard (server/lib/improveGuard.js) and the prompt text behind it
 * (server/prompts/answerVault.js).
 *
 * HANDOVER §7 item 32: one real Improve took a draft from one claim the resume
 * does not back to four. The prompt now forbids adding facts, and the guard
 * checks the result: more unbacked claims than the old draft means one more
 * model call, with the offending claims listed. Never a second retry, and a
 * retry that fails or does not help returns the first answer, not an error.
 *
 * The model is a stub throughout: `regenerate` is injected, so none of this
 * needs Groq.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'error';

const {
  guardImprovedDraft,
  createGroqRetry,
  applicationTargets,
  IMPROVE_RETRY_LATEST_START_MS,
  IMPROVE_RETRY_TIMEOUT_MS,
} = await import('../../server/lib/improveGuard.js');
const { AI_TIMEOUT_SEC } = await import('../../src/answerStudio.js');
const {
  buildAnswerVaultUserContent,
  buildImproveRetryMessage,
  IMPROVE_FACTS_RULE,
} = await import('../../server/prompts/answerVault.js');
const { validateAgainstCorpus } = await import('../../src/matching/index.js');

const CORPUS = [
  { ref: 'exp.0', text: 'Backend Engineer, Kestrel Analytics, 2019 - 2023' },
  { ref: 'exp.0.b0', text: 'Built a billing service in Node.js and PostgreSQL that processed 2 million invoices a month' },
  { ref: 'exp.0.b1', text: 'Mentored 3 junior engineers through their first on-call rotation' },
  { ref: 'skills.0', text: 'Node.js' },
  { ref: 'skills.1', text: 'PostgreSQL' },
];

/** Fully backed by the corpus: zero flags. */
const DRAFT = 'At Kestrel Analytics I built a billing service in Node.js that processed 2 million invoices a month. I also mentored 3 junior engineers.';

/** The failure from item 32 in miniature: a team size, a percentage and a tool, none on the resume. */
const INVENTED = 'At Kestrel Analytics I built a billing service in Node.js and PostgreSQL that processed 2 million invoices a month. I also led a team of 12 engineers and cut infrastructure costs by 40% using Kubernetes. I mentored 3 junior engineers through their first on-call rotation.';

/** What a retry that worked looks like: the invented sentence gone, nothing new added. */
const CLEAN = 'At Kestrel Analytics I built a billing service in Node.js and PostgreSQL that processed 2 million invoices a month. I mentored 3 junior engineers through their first on-call rotation, and I kept the service reliable as volume grew.';

/** A retry that made it worse: three unbacked claims where the first answer had one. */
const WORSE = 'At Kestrel Analytics I built a billing service in Node.js that processed 5 million invoices a month. I led a team of 12 engineers using Kubernetes. I cut costs by 40% at Halcyon Systems.';

/** A regenerate stub that records every call and answers from a script. */
function scripted(...answers) {
  const calls = [];
  const regenerate = async (correction) => {
    calls.push(correction);
    const next = answers[calls.length - 1];
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, regenerate };
}

// The fixtures are only meaningful if the check sees them the way these tests
// assume. Pinned here so a change to the fabrication check fails loudly at the
// fixture rather than as a confusing guard test.
test('fixtures: the draft and the clean retry are backed, the invented answer is not', () => {
  assert.equal(validateAgainstCorpus(DRAFT, CORPUS).flags.length, 0);
  assert.equal(validateAgainstCorpus(CLEAN, CORPUS).flags.length, 0);
  assert.equal(validateAgainstCorpus(INVENTED, CORPUS).flags.length, 1);
  assert.equal(validateAgainstCorpus(WORSE, CORPUS).flags.length, 3);
});

// ------------------------------------------------------------------
// The four cases the plan names
// ------------------------------------------------------------------
test('no retry when the improved answer adds no unbacked claims', async () => {
  const { calls, regenerate } = scripted(CLEAN);
  const out = await guardImprovedDraft({ draft: DRAFT, text: CLEAN, corpus: CORPUS, regenerate });

  assert.equal(calls.length, 0, 'the model must not be called again');
  assert.equal(out.text, CLEAN);
  assert.equal(out.retried, false);
});

test('one retry that helps: the cleaner answer is returned', async () => {
  const { calls, regenerate } = scripted(CLEAN);
  const out = await guardImprovedDraft({ draft: DRAFT, text: INVENTED, corpus: CORPUS, regenerate });

  assert.equal(calls.length, 1);
  assert.equal(out.text, CLEAN);
  assert.equal(out.retried, true);
  assert.equal(out.kept, 'retry');
  // The offending claim is quoted back so the model knows what to take out.
  assert.ok(calls[0].includes('led a team of 12 engineers'), 'the retry must list the offending claim');
  assert.ok(!calls[0].includes('2 million invoices'), 'a backed sentence is not listed as offending');
});

test('one retry that does not help: the first answer is kept and there is no third call', async () => {
  for (const retryAnswer of [WORSE, INVENTED]) {
    const { calls, regenerate } = scripted(retryAnswer, CLEAN, CLEAN);
    const out = await guardImprovedDraft({ draft: DRAFT, text: INVENTED, corpus: CORPUS, regenerate });

    assert.equal(calls.length, 1, 'exactly one retry, however the first one went');
    assert.equal(out.text, INVENTED, 'a retry with as many or more flags does not replace the first answer');
    assert.equal(out.retried, true);
    assert.equal(out.kept, 'first');
  }
});

test('a failed retry returns the first answer, not an error', async () => {
  const providerDown = Object.assign(new Error('rate limit reached'), { status: 429 });
  for (const failure of [providerDown, '', '   ', null, undefined]) {
    const { calls, regenerate } = scripted(failure);
    const out = await guardImprovedDraft({ draft: DRAFT, text: INVENTED, corpus: CORPUS, regenerate });

    assert.equal(calls.length, 1);
    assert.equal(out.text, INVENTED, `a ${failure instanceof Error ? 'throwing' : 'blank'} retry must leave the first answer`);
    assert.equal(out.retried, true);
    assert.equal(out.kept, 'first');
  }
});

// ------------------------------------------------------------------
// When the guard stays out of the way
// ------------------------------------------------------------------
test('a first draft (nothing to improve) is never retried, flags or not', async () => {
  for (const draft of ['', '   ', undefined, null]) {
    const { calls, regenerate } = scripted(CLEAN);
    const out = await guardImprovedDraft({ draft, text: INVENTED, corpus: CORPUS, regenerate });
    assert.equal(calls.length, 0);
    assert.equal(out.text, INVENTED);
    assert.equal(out.retried, false);
  }
});

test('no corpus means nothing to check against, so no retry', async () => {
  for (const corpus of [[], undefined, null, 'nonsense']) {
    const { calls, regenerate } = scripted(CLEAN);
    const out = await guardImprovedDraft({ draft: DRAFT, text: INVENTED, corpus, regenerate });
    assert.equal(calls.length, 0);
    assert.equal(out.text, INVENTED);
  }
});

test('extra flags that only restate the draft do not trigger a retry', async () => {
  // The draft itself carries an unbacked claim (one flag). The improvement
  // splits it into two sentences, so the count goes up — but nothing in either
  // sentence is new: both facts are the user's own, from the draft. The rule
  // forbids adding facts, not keeping the ones the user wrote.
  const draft = 'I cut onboarding time by 30% at Brightwave Media while working in Node.js.';
  const improved = 'At Brightwave Media I worked in Node.js every day. I cut onboarding time there by 30%.';
  assert.equal(validateAgainstCorpus(draft, CORPUS).flags.length, 1);
  assert.equal(validateAgainstCorpus(improved, CORPUS).flags.length, 2);

  const { calls, regenerate } = scripted(CLEAN);
  const out = await guardImprovedDraft({ draft, text: improved, corpus: CORPUS, regenerate });
  assert.equal(calls.length, 0);
  assert.equal(out.text, improved);
  assert.equal(out.retried, false);
});

test('a missing regenerate is a no-op, not a crash', async () => {
  const out = await guardImprovedDraft({ draft: DRAFT, text: INVENTED, corpus: CORPUS });
  assert.equal(out.text, INVENTED);
  assert.equal(out.retried, false);
  await assert.doesNotReject(() => guardImprovedDraft());
  await assert.doesNotReject(() => guardImprovedDraft(null));
});

// ------------------------------------------------------------------
// createGroqRetry: the production regenerate
// ------------------------------------------------------------------
function stubGroq(reply) {
  const requests = [];
  const options = [];
  return {
    requests,
    options,
    chat: {
      completions: {
        create: async (body, requestOptions) => {
          requests.push(body);
          options.push(requestOptions);
          if (reply instanceof Error) throw reply;
          return reply;
        },
      },
    },
  };
}

const completion = (content, finishReason = 'stop') => ({
  model: 'llama-3.3-70b-versatile',
  choices: [{ message: { content }, finish_reason: finishReason }],
});

test('createGroqRetry asks once, after the first answer, on the same model', async () => {
  const groq = stubGroq(completion(`  ${CLEAN}  `));
  const retry = createGroqRetry({ groq, model: 'llama-3.3-70b-versatile', system: 'SYS', user: 'USER', previous: INVENTED });

  const text = await retry('CORRECTION');
  assert.equal(text, CLEAN);
  assert.equal(groq.requests.length, 1, 'one call, no fallback chain');

  const [body] = groq.requests;
  assert.equal(body.model, 'llama-3.3-70b-versatile');
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
  assert.deepEqual(body.messages.map((m) => m.content), ['SYS', 'USER', INVENTED, 'CORRECTION']);
  assert.ok(Number.isFinite(body.temperature) && Number.isFinite(body.max_tokens));
});

test('createGroqRetry throws on an unusable reply, so the guard keeps the first answer', async () => {
  const unusable = [
    completion(''),
    completion('short'),
    completion(CLEAN, 'length'),
    { choices: [{ message: { content: '', refusal: 'I cannot help with that.' } }] },
    new Error('upstream 503'),
  ];
  for (const reply of unusable) {
    const groq = stubGroq(reply);
    const retry = createGroqRetry({ groq, model: 'm', system: 's', user: 'u', previous: INVENTED });
    await assert.rejects(() => retry('c'));

    // And end to end: the same reply through the guard is the first answer.
    const out = await guardImprovedDraft({
      draft: DRAFT, text: INVENTED, corpus: CORPUS,
      regenerate: createGroqRetry({ groq: stubGroq(reply), model: 'm', system: 's', user: 'u', previous: INVENTED }),
    });
    assert.equal(out.text, INVENTED);
  }
});

// ------------------------------------------------------------------
// The prompt text
// ------------------------------------------------------------------
const PROMPT_PARTS = {
  relevantAnswers: '(No saved answers in vault.)',
  profileBlock: 'PROFILE (brief):\nCore skills: Node.js\n\n',
  jobContext: 'Not provided',
  question: 'Tell us about a project you are proud of.',
};

test('an Answer Studio Improve forbids claiming numbers, employers, titles or tools', () => {
  const content = buildAnswerVaultUserContent({ ...PROMPT_PARTS, draft: DRAFT, improve: true });
  assert.ok(content.includes(IMPROVE_FACTS_RULE));
  for (const word of ['experience', 'number', 'employer', 'job title', 'tool', 'PROFILE', 'EXISTING DRAFT']) {
    assert.ok(IMPROVE_FACTS_RULE.includes(word), `the rule must name ${word}`);
  }
  // After the draft, so it is the last thing the model reads before answering.
  assert.ok(content.indexOf(IMPROVE_FACTS_RULE) > content.indexOf(DRAFT));
});

test('the rule lets the answer name the organisation and role it is for', () => {
  // An answer to "Why do you want to work here?" has to name "here". What the
  // rule forbids is claiming things about the candidate, and it says that a
  // requirement in the posting is not something the candidate has.
  assert.match(IMPROVE_FACTS_RULE, /may name the organisation and the role/);
  assert.match(IMPROVE_FACTS_RULE, /JOB CONTEXT/);
  assert.match(IMPROVE_FACTS_RULE, /not something the candidate has/);
});

test('without `improve` the message is exactly what it was, draft or not', () => {
  // Cover letters, first drafts and clients that send no kind: no rule.
  for (const extra of [{ draft: DRAFT }, { draft: DRAFT, improve: false }, { draft: '' }, { draft: '', improve: true }]) {
    const content = buildAnswerVaultUserContent({ ...PROMPT_PARTS, ...extra });
    assert.ok(!content.includes(IMPROVE_FACTS_RULE), JSON.stringify(extra));
    assert.ok(content.endsWith(`EXISTING DRAFT (improve this):\n${extra.draft || 'None'}`));
  }
});

// ------------------------------------------------------------------
// The organisation and role the application is for
// ------------------------------------------------------------------
test('applicationTargets reads only the labelled header lines of the job context', () => {
  assert.deepEqual(
    applicationTargets('Organization: Acme Robotics\nRole: Senior Frontend Engineer\n\nWe need React and Kubernetes.\nRole: ignored'),
    ['Acme Robotics', 'Senior Frontend Engineer'],
  );
  assert.deepEqual(applicationTargets('Company: Acme Robotics\n\nRequirements: Kubernetes, 5+ years.'), ['Acme Robotics']);
  assert.deepEqual(applicationTargets('Organisation: Acme\nPosition: Data Analyst\nJob title: Analyst II'), ['Acme', 'Data Analyst', 'Analyst II']);
  // The description is never read, even when it carries a label further down.
  assert.deepEqual(applicationTargets('We are hiring at Acme.\nCompany: Not The Header\nRole: Nope'), []);
  // Placeholders the clients send when nothing was filled in.
  assert.deepEqual(applicationTargets('Company: Not specified\n\nSome posting.'), []);
  for (const junk of ['', 'Not provided', undefined, null, 42]) assert.deepEqual(applicationTargets(junk), []);
});

const TARGET_JOB = 'Company: Acme Robotics\n\nRequirements: Kubernetes and Terraform, 5+ years of platform work.';

test('naming the company the answer is for does not trigger a retry', async () => {
  // "Acme Robotics" is an employer the resume never mentions, so the check
  // flags it — but it is the organisation this application is FOR.
  const improved = `${DRAFT} Acme Robotics builds billing at a scale where I have processed 2 million invoices a month.`;
  assert.ok(validateAgainstCorpus(improved, CORPUS).flags.length > 0, 'fixture: flagged against the resume alone');

  const { calls, regenerate } = scripted(CLEAN);
  const out = await guardImprovedDraft({ draft: DRAFT, text: improved, corpus: CORPUS, jobContext: TARGET_JOB, regenerate });
  assert.equal(calls.length, 0, 'the target organisation is grounded by the job context header');
  assert.equal(out.text, improved);

  // Without the job context the same answer is retried: the grounding is
  // what made the difference, not a blanket exemption.
  const bare = scripted(CLEAN);
  await guardImprovedDraft({ draft: DRAFT, text: improved, corpus: CORPUS, regenerate: bare.regenerate });
  assert.equal(bare.calls.length, 1);
});

test('a requirement in the posting does not back a claim the user never made', async () => {
  const improved = `${DRAFT} I ran Kubernetes and Terraform for 5 years at Acme Robotics.`;
  const { calls, regenerate } = scripted(CLEAN);
  const out = await guardImprovedDraft({ draft: DRAFT, text: improved, corpus: CORPUS, jobContext: TARGET_JOB, regenerate });
  assert.equal(calls.length, 1, 'Kubernetes and 5 years are only in the description, so still offending');
  assert.ok(calls[0].includes('Kubernetes'));
  assert.equal(out.text, CLEAN);
});

// ------------------------------------------------------------------
// The time budget
// ------------------------------------------------------------------
test('the retry is skipped when the request has already run long', async () => {
  const now = 1_000_000;
  const late = scripted(CLEAN);
  const out = await guardImprovedDraft({
    draft: DRAFT, text: INVENTED, corpus: CORPUS, regenerate: late.regenerate,
    startedAt: now - IMPROVE_RETRY_LATEST_START_MS - 1, now: () => now,
  });
  assert.equal(late.calls.length, 0, 'no second call once the budget is spent');
  assert.equal(out.text, INVENTED);
  assert.equal(out.reason, 'out_of_time');

  const early = scripted(CLEAN);
  const ok = await guardImprovedDraft({
    draft: DRAFT, text: INVENTED, corpus: CORPUS, regenerate: early.regenerate,
    startedAt: now - 1_000, now: () => now,
  });
  assert.equal(early.calls.length, 1);
  assert.equal(ok.text, CLEAN);
});

test('the latest retry, timed out, still ends well inside the client timeout', () => {
  // The client gives up after AI_TIMEOUT_SEC, and the request is charged
  // before the model runs, so a late answer is a paid answer nobody sees.
  const worstCaseMs = IMPROVE_RETRY_LATEST_START_MS + IMPROVE_RETRY_TIMEOUT_MS;
  assert.ok(worstCaseMs <= (AI_TIMEOUT_SEC * 1000) / 2, `${worstCaseMs}ms leaves too little of ${AI_TIMEOUT_SEC}s`);
});

test('createGroqRetry gives the retry its own timeout and no SDK retries', async () => {
  const groq = stubGroq(completion(CLEAN));
  await createGroqRetry({ groq, model: 'm', system: 's', user: 'u', previous: INVENTED })('c');
  assert.deepEqual(groq.options[0], { timeout: IMPROVE_RETRY_TIMEOUT_MS, maxRetries: 0 });
});

test('the retry message lists each claim once, bounded', () => {
  const claims = Array.from({ length: 10 }, (_, i) => `Claim number ${i} ${'x'.repeat(400)}`);
  const message = buildImproveRetryMessage(claims);
  assert.equal((message.match(/^- "/gm) || []).length, 6, 'at most six claims are quoted back');
  assert.ok(!message.includes('x'.repeat(301)), 'each claim is capped');
  assert.ok(message.includes('Do not replace them'), 'and the model is told not to swap in new facts');
  assert.doesNotThrow(() => buildImproveRetryMessage(null));
});
