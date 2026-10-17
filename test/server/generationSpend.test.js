import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ANSWER_FREE_IMPROVEMENTS,
  CLIENT_KINDS,
  FOLLOW_UP_DAYS,
  MIGRATION_FILE,
  SpendError,
  classifySpendError,
  freeFollowUps,
  jobDescriptionOf,
  memorySpendStore,
  subjectKeyFor,
  supabaseSpendStore,
} from '../../server/lib/generationSpend.js';
import { COVER_LETTER_FREE_RERUNS, applicationKey } from '../../src/coverLetterCredits.js';

// Charging for a generation (server/lib/generationSpend.js). The rules live in
// the database (spend_generation() and undo_generation(), migration 007); the
// memory store is the same rules in JS, so these walk them without one, and
// the last tests hold the SQL itself to the parts that matter.

const DAY = 24 * 60 * 60 * 1000;

/** A clock the test moves by hand. */
function clock(start = Date.UTC(2026, 9, 17, 12, 0, 0)) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

const JOB = 'Organization: Norwick Labs\nSenior Backend Engineer. Requirements: Python, PostgreSQL.';

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof SpendError, `expected a SpendError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

test('the amounts are the product’s: 3 improvements, 1 re-run, nothing for explain or an old client', () => {
  assert.equal(ANSWER_FREE_IMPROVEMENTS, 3);
  assert.equal(freeFollowUps('answer'), 3);
  assert.equal(freeFollowUps('cover_letter'), COVER_LETTER_FREE_RERUNS);
  assert.equal(freeFollowUps('cover_letter'), 1);
  assert.equal(freeFollowUps('explain'), 0);
  assert.equal(freeFollowUps(undefined), 0);
  assert.deepEqual([...CLIENT_KINDS], ['answer', 'cover_letter']);
  assert.equal(FOLLOW_UP_DAYS, 30);
});

/** A job context as both front ends write it (cover-letter.js's jobContextFor(), CoverLetterPanel.jsx). */
const contextFor = (company, role, description) =>
  `${company ? `Organization: ${company}\n` : ''}${role ? `Role: ${role}\n\n` : ''}${description.substring(0, 6000)}`;

const DESCRIPTION = 'Senior Backend Engineer at Norwick Labs.\n\nRequirements: Python, PostgreSQL.';

test('the server keys a cover letter exactly as src/coverLetterCredits.js does (parity)', () => {
  // With no header lines, the context is the description.
  for (const text of ['', '  spaced   OUT  ', 'x'.repeat(7000), 'Ünïcödé — résumé', DESCRIPTION]) {
    assert.equal(subjectKeyFor('cover_letter', text), applicationKey(text));
  }
  // Answers are not tied to text, and nothing else has a subject.
  assert.equal(subjectKeyFor('answer', JOB), null);
  assert.equal(subjectKeyFor('explain', JOB), null);
});

test('the same description is the same application, whatever the company and role say', () => {
  const key = applicationKey(DESCRIPTION);
  for (const [company, role] of [['', ''], ['Norwick Labs', ''], ['', 'Backend Engineer'], ['Norwick Labs', 'Backend Engineer'], ['Kestrel Analytics', 'Staff Engineer']]) {
    // As the server gets it: trimmed.
    const sent = contextFor(company, role, DESCRIPTION).trim();
    assert.equal(subjectKeyFor('cover_letter', sent), key, `company ${JSON.stringify(company)}, role ${JSON.stringify(role)}`);
  }
  // The 6000 characters both front ends send decide it, as in the client.
  const long = `${'y'.repeat(6000)} and a tail`;
  assert.equal(subjectKeyFor('cover_letter', contextFor('Norwick Labs', 'Engineer', long)), applicationKey(long));
});

test('a different description is a different application', () => {
  const other = 'Platform Engineer at Kestrel Analytics. Requirements: Kubernetes, Terraform.';
  assert.notEqual(
    subjectKeyFor('cover_letter', contextFor('Norwick Labs', 'Engineer', DESCRIPTION)),
    subjectKeyFor('cover_letter', contextFor('Norwick Labs', 'Engineer', other)),
  );
  assert.equal(subjectKeyFor('cover_letter', contextFor('Norwick Labs', 'Engineer', other)), applicationKey(other));
});

test('only short header lines are left out: a whole job cannot ride in the company line', () => {
  const smuggled = `Organization: ${'Another job entirely, with its own requirements. '.repeat(6)}\n${DESCRIPTION}`;
  assert.notEqual(subjectKeyFor('cover_letter', smuggled), applicationKey(DESCRIPTION));
  // And a description is not mistaken for a header further down.
  assert.equal(jobDescriptionOf(`Organization: Norwick\nRole: Engineer\n\n${DESCRIPTION}`), DESCRIPTION);
  assert.equal(jobDescriptionOf(`${DESCRIPTION}\nRole: not a header here`), `${DESCRIPTION}\nRole: not a header here`);
});

test('src/coverLetterCredits.js stays importable by the server: no imports at all', () => {
  // server/lib/generationSpend.js imports it, so an import added there would
  // drag a browser module (or chrome.*) into the server bundle.
  const source = readFileSync(new URL('../../src/coverLetterCredits.js', import.meta.url), 'utf8');
  assert.equal(/^\s*import\s/m.test(source), false);
  assert.equal(/\bimport\s*\(/.test(source), false);
  assert.equal(/\brequire\s*\(/.test(source), false);
});

test('a charge takes one credit, writes the usage row, and grants the follow-ups', async () => {
  const store = memorySpendStore({ accounts: { u1: { credits: 2 } } });
  const spend = await store.spend({ userId: 'u1', kind: 'answer', free: 3, description: 'Answer Studio generation' });
  assert.equal(spend.charged, true);
  assert.equal(spend.premium, false);
  assert.equal(spend.credits, 1);
  assert.equal(spend.followUpsLeft, 3);
  assert.match(spend.allowanceId, /^[0-9a-f-]{36}$/);
  assert.equal(store.account('u1').credits, 1);
  assert.deepEqual(store.transactions, [{ userId: 'u1', amount: -1, type: 'usage', description: 'Answer Studio generation' }]);
});

test('a granted follow-up is free, and runs out', async () => {
  const store = memorySpendStore({ accounts: { u1: { credits: 1 } } });
  const paid = await store.spend({ userId: 'u1', kind: 'answer', free: 3 });
  for (const left of [2, 1, 0]) {
    const free = await store.spend({ userId: 'u1', kind: 'answer', allowanceId: paid.allowanceId, free: 3 });
    assert.equal(free.charged, false);
    assert.equal(free.followUpsLeft, left);
    assert.equal(free.credits, 0, 'the balance is reported, and untouched');
  }
  // Used up, at zero credits: refused, not free.
  await rejectsWith(store.spend({ userId: 'u1', kind: 'answer', allowanceId: paid.allowanceId, free: 3 }), 'no_credits');
  assert.equal(store.transactions.length, 1);
});

test('a used-up or foreign allowance is simply a charge', async () => {
  const store = memorySpendStore({ accounts: { u1: { credits: 5 }, u2: { credits: 5 } } });
  const mine = await store.spend({ userId: 'u1', kind: 'answer', free: 0 });
  const charged = await store.spend({ userId: 'u1', kind: 'answer', allowanceId: mine.allowanceId, free: 3 });
  assert.equal(charged.charged, true, 'an allowance with nothing left buys nothing');

  const theirs = await store.spend({ userId: 'u2', kind: 'answer', free: 3 });
  const borrowed = await store.spend({ userId: 'u1', kind: 'answer', allowanceId: theirs.allowanceId, free: 3 });
  assert.equal(borrowed.charged, true, 'another account’s allowance is not this one’s');
  assert.equal(store.account('u2').credits, 4);

  const unknown = await store.spend({ userId: 'u1', kind: 'answer', allowanceId: '00000000-0000-4000-8000-000000000000', free: 3 });
  assert.equal(unknown.charged, true);
});

test('a cover letter’s re-run is for the same application only, and not for an answer', async () => {
  const store = memorySpendStore({ accounts: { u1: { credits: 3 } } });
  const subject = subjectKeyFor('cover_letter', JOB);
  const paid = await store.spend({ userId: 'u1', kind: 'cover_letter', subject, free: 1 });
  assert.equal(paid.followUpsLeft, 1);

  const other = await store.spend({ userId: 'u1', kind: 'cover_letter', allowanceId: paid.allowanceId, subject: subjectKeyFor('cover_letter', 'Another job entirely'), free: 1 });
  assert.equal(other.charged, true, 'another description is another application');

  const asAnswer = await store.spend({ userId: 'u1', kind: 'answer', allowanceId: paid.allowanceId, free: 3 });
  assert.equal(asAnswer.charged, true, 'a re-run is not an answer improvement');

  const rerun = await store.spend({ userId: 'u1', kind: 'cover_letter', allowanceId: paid.allowanceId, subject, free: 1 });
  assert.equal(rerun.charged, false);
  assert.equal(rerun.followUpsLeft, 0);
  assert.equal(store.account('u1').credits, 0);
});

test('follow-ups last 30 days', async () => {
  const c = clock();
  const store = memorySpendStore({ now: c.now, accounts: { u1: { credits: 2 } } });
  const paid = await store.spend({ userId: 'u1', kind: 'answer', free: 3 });
  c.advance(FOLLOW_UP_DAYS * DAY - 1000);
  assert.equal((await store.spend({ userId: 'u1', kind: 'answer', allowanceId: paid.allowanceId })).charged, false);
  c.advance(1000);
  assert.equal((await store.spend({ userId: 'u1', kind: 'answer', allowanceId: paid.allowanceId })).charged, true, 'expired: charged');
});

test('Premium pays nothing, is granted nothing, and writes no row', async () => {
  const store = memorySpendStore({ accounts: { p1: { credits: 0, isPremium: true } } });
  for (const kind of ['answer', 'cover_letter', 'explain']) {
    const spend = await store.spend({ userId: 'p1', kind, free: 3 });
    assert.deepEqual(spend, { charged: false, premium: true, allowanceId: null, followUpsLeft: null, credits: null });
  }
  assert.deepEqual(store.transactions, []);
  assert.equal(store.allowances.size, 0);
});

test('no credits: refused, nothing written; no profile row: its own error', async () => {
  const store = memorySpendStore({ accounts: { u1: { credits: 0 } } });
  await rejectsWith(store.spend({ userId: 'u1', kind: 'answer', free: 3 }), 'no_credits');
  await rejectsWith(store.spend({ userId: 'nobody', kind: 'answer', free: 3 }), 'no_profile');
  assert.deepEqual(store.transactions, []);
  assert.equal(store.allowances.size, 0);
  const err = await store.spend({ userId: 'u1', kind: 'answer' }).catch((e) => e);
  assert.equal(err.statusCode, 403);
  assert.equal(err.message, 'No credits remaining');
});

test('two concurrent spends holding one credit: one passes, one gets no_credits', async () => {
  const store = memorySpendStore({ accounts: { u1: { credits: 1 } } });
  const results = await Promise.allSettled([
    store.spend({ userId: 'u1', kind: 'answer', free: 3 }),
    store.spend({ userId: 'u1', kind: 'answer', free: 3 }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'no_credits');
  assert.equal(store.account('u1').credits, 0);
  assert.equal(store.transactions.length, 1);
});

test('two concurrent follow-ups holding one use: one is free, the other has to pay', async () => {
  const store = memorySpendStore({ accounts: { u1: { credits: 1 } } });
  const paid = await store.spend({ userId: 'u1', kind: 'cover_letter', subject: 'k', free: 1 });
  const results = await Promise.allSettled([
    store.spend({ userId: 'u1', kind: 'cover_letter', allowanceId: paid.allowanceId, subject: 'k', free: 1 }),
    store.spend({ userId: 'u1', kind: 'cover_letter', allowanceId: paid.allowanceId, subject: 'k', free: 1 }),
  ]);
  // Zero credits left, so the second is refused rather than charged.
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(results.find((r) => r.status === 'fulfilled').value.charged, false);
});

test('undo gives a charge back once, deletes its allowance, and gives a follow-up its use back', async () => {
  const store = memorySpendStore({ accounts: { u1: { credits: 2 } } });
  const paid = await store.spend({ userId: 'u1', kind: 'answer', free: 3 });
  const free = await store.spend({ userId: 'u1', kind: 'answer', allowanceId: paid.allowanceId });
  assert.equal(free.followUpsLeft, 2);

  assert.deepEqual(await store.undo('u1', free, 'refund'), { undone: true, followUpsLeft: 3 });

  assert.deepEqual(await store.undo('u1', paid, 'Credit refunded (failed AI generation)'), { undone: true, credits: 2 });
  assert.equal(store.allowances.has(paid.allowanceId), false, 'a refunded charge grants nothing');
  assert.deepEqual(store.transactions.at(-1), { userId: 'u1', amount: 1, type: 'refund', description: 'Credit refunded (failed AI generation)' });

  // The receipt is gone, so a second refund of the same charge gives nothing.
  assert.deepEqual(await store.undo('u1', paid, 'again'), { undone: false });
  assert.equal(store.account('u1').credits, 2);
  assert.equal(store.transactions.filter((t) => t.type === 'refund').length, 1);
});

test('undo of a Premium spend, or someone else’s charge, gives nothing back', async () => {
  const store = memorySpendStore({ accounts: { p1: { credits: 0, isPremium: true }, u1: { credits: 1 }, u2: { credits: 0 } } });
  const premium = await store.spend({ userId: 'p1', kind: 'answer', free: 3 });
  assert.deepEqual(await store.undo('p1', premium), { undone: false });
  const charge = await store.spend({ userId: 'u1', kind: 'explain', free: 0 });
  assert.deepEqual(await store.undo('u2', charge), { undone: false });
  assert.equal(store.account('u2').credits, 0);
  assert.equal(store.account('u1').credits, 0);
});

// ------------------------------------------------------------------
// The Supabase store: what it sends, and how it reads PostgREST's errors
// ------------------------------------------------------------------

function rpcClient(answer) {
  const calls = [];
  return {
    calls,
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return typeof answer === 'function' ? answer(fn, args) : answer;
    },
  };
}

test('the Supabase store calls spend_generation and undo_generation with every argument', async () => {
  const client = rpcClient({
    data: { charged: true, premium: false, allowanceId: 'a-1', followUpsLeft: 1, credits: 4 },
    error: null,
  });
  const store = supabaseSpendStore(client);
  const spend = await store.spend({ userId: 'u1', kind: 'cover_letter', allowanceId: null, subject: 'abc12345', free: 1, description: 'Cover letter personalisation' });
  assert.deepEqual(spend, { charged: true, premium: false, allowanceId: 'a-1', followUpsLeft: 1, credits: 4 });
  assert.deepEqual(client.calls[0], {
    fn: 'spend_generation',
    args: { p_user: 'u1', p_kind: 'cover_letter', p_allowance: null, p_subject: 'abc12345', p_free: 1, p_description: 'Cover letter personalisation' },
  });

  await store.undo('u1', spend, 'Credit refunded (failed AI generation)');
  assert.deepEqual(client.calls[1], {
    fn: 'undo_generation',
    args: { p_user: 'u1', p_spend: { charged: true, allowanceId: 'a-1' }, p_description: 'Credit refunded (failed AI generation)' },
  });
});

test('PostgREST errors map to what the route answers', async () => {
  const cases = [
    [{ code: 'P0001', message: 'no_credits' }, 'no_credits', 403],
    [{ code: 'P0001', message: 'no_profile' }, 'no_profile', 503],
    // Migration 007 not applied: the function is not in the schema cache…
    [{ code: 'PGRST202', message: 'Could not find the function public.spend_generation(p_allowance, …) in the schema cache' }, 'not_migrated', 503],
    // …or Postgres itself says so, or the table under it is missing.
    [{ code: '42883', message: 'function public.spend_generation does not exist' }, 'not_migrated', 503],
    [{ code: '42P01', message: 'relation "public.generation_allowances" does not exist' }, 'not_migrated', 503],
    // Anything else: unavailable, never free.
    [{ code: '', message: 'TypeError: fetch failed' }, 'unavailable', 503],
    [{ code: '57014', message: 'canceling statement due to statement timeout' }, 'unavailable', 503],
  ];
  for (const [error, code, status] of cases) {
    assert.equal(classifySpendError(error), code, JSON.stringify(error));
    const store = supabaseSpendStore(rpcClient({ data: null, error }));
    const err = await store.spend({ userId: 'u1', kind: 'answer', free: 3 }).catch((e) => e);
    assert.ok(err instanceof SpendError);
    assert.equal(err.code, code);
    assert.equal(err.statusCode, status);
    assert.equal(err.dbCode, error.code || null);
  }
});

test('a client that throws, or an answer that is not a spend, is unavailable', async () => {
  const throwing = { rpc: async () => { throw new Error('socket hang up'); } };
  await rejectsWith(supabaseSpendStore(throwing).spend({ userId: 'u1', kind: 'answer' }), 'unavailable');
  for (const data of [null, 'yes', { charged: 'true' }, []]) {
    await rejectsWith(supabaseSpendStore(rpcClient({ data, error: null })).spend({ userId: 'u1', kind: 'answer' }), 'unavailable');
  }
});

test('an answer with junk numbers keeps only finite ones', async () => {
  const store = supabaseSpendStore(rpcClient({
    data: { charged: false, premium: true, allowanceId: 7, followUpsLeft: 'lots', credits: 'Infinity' },
    error: null,
  }));
  assert.deepEqual(await store.spend({ userId: 'p1', kind: 'answer' }), {
    charged: false, premium: true, allowanceId: null, followUpsLeft: null, credits: null,
  });
});

// ------------------------------------------------------------------
// The SQL: one conditional statement per step, re-runnable, service role only
// ------------------------------------------------------------------

const repoFile = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const migration = repoFile(MIGRATION_FILE);
const schema = repoFile('supabase/schema.sql');

/** The SQL without comments, whitespace collapsed. */
const code = (sql) => sql.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();

/** One function's body, between its `as $$` and the closing `$$;`. */
function functionBody(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name}() is defined`);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('$$;', open + 2);
  return code(sql.slice(open + 2, close));
}

test('the migration file is the one the logs name', () => {
  assert.equal(MIGRATION_FILE, 'supabase/migrations/007_generation_charges.sql');
});

test('a credit is spent by one conditional update, never read and then written', () => {
  const spend = functionBody(migration, 'spend_generation');
  assert.match(spend, /update public\.profiles set credits = credits - 1 where id = p_user and credits > 0 returning credits into v_credits;/);
  // The only writes to a balance are relative to the row itself.
  assert.deepEqual(spend.match(/set credits = [^;]*/g), ['set credits = credits - 1 where id = p_user and credits > 0 returning credits into v_credits']);
  assert.doesNotMatch(spend, /select credits[^;]*into[^;]*;[^$]*set credits = v_/);
  // A follow-up is one conditional update too.
  assert.match(spend, /update public\.generation_allowances set remaining = remaining - 1 where id = p_allowance and user_id = p_user and kind = p_kind and remaining > 0 and expires_at > now\(\) and \(subject_key is null or subject_key = p_subject\) returning remaining into v_left;/);
  // No row back, no spend: refused.
  assert.match(spend, /raise exception 'no_credits'/);
});

test('undo refunds only by deleting the charge’s row first, so once at most', () => {
  const undo = functionBody(migration, 'undo_generation');
  const del = undo.indexOf('delete from public.generation_allowances where id = v_allowance and user_id = p_user;');
  const refund = undo.indexOf('update public.profiles set credits = credits + 1 where id = p_user');
  assert.ok(del >= 0 && refund > del, 'the receipt is deleted before the credit is given back');
  assert.match(undo.slice(del, refund), /if not found then return/);
  assert.match(undo, /insert into public\.credit_transactions \(user_id, amount, type, description\) values \(p_user, 1, 'refund'/);
});

test('the migration is re-runnable and touches nothing that exists', () => {
  const sql = code(migration);
  for (const stmt of sql.match(/\bcreate (?:or replace )?(?:table|index|function|trigger)\b[^(]*/g) || []) {
    assert.match(stmt, /^create (?:or replace function|table if not exists|index if not exists)/, `not re-runnable: ${stmt}`);
  }
  assert.doesNotMatch(sql, /\bdrop (?:table|function)\b/);
  assert.doesNotMatch(sql, /\b(?:public\.)?(?:auth\.users|on_auth_user_created)\b/);
  assert.doesNotMatch(sql, /\balter table public\.(?:profiles|credit_transactions)\b/);
  assert.match(sql, /alter table public\.generation_allowances enable row level security;/);
  assert.doesNotMatch(sql, /create policy/, 'no policies: the service role only');
  assert.match(sql, /expires_at timestamptz not null default now\(\) \+ interval '30 days'/);
});

test('both functions run for the service role only', () => {
  const sql = code(migration);
  for (const signature of [
    'public.spend_generation(uuid, text, uuid, text, integer, text)',
    'public.undo_generation(uuid, jsonb, text)',
  ]) {
    assert.ok(sql.includes(`revoke all on function ${signature} from public, anon, authenticated;`), `revoke on ${signature}`);
    assert.ok(sql.includes(`grant execute on function ${signature} to service_role;`), `grant on ${signature}`);
  }
  assert.doesNotMatch(sql, /security definer/, 'they run with the caller’s rights, and only the service role can call them');
});

test('schema.sql carries every statement of migration 007', () => {
  const body = code(schema);
  const statements = code(migration).split(/;\s*(?=(?:create|alter|revoke|grant|notify|comment)\b)/);
  assert.ok(statements.length >= 8, `expected the migration's statements, found ${statements.length}`);
  for (const statement of statements) {
    const s = statement.replace(/;$/, '');
    assert.ok(body.includes(s), `schema.sql is missing: ${s.slice(0, 120)}…`);
  }
});
