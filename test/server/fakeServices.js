/**
 * Fake Supabase and Groq, for route tests through the harness
 * (startHarness({ fakes }) in ./harness.js). Plain node:http handlers.
 *
 * The fake Supabase answers what the charging routes ask of it, with the wire
 * shapes supabase-js and PostgREST use:
 *   GET  /auth/v1/user                 requireAuth(): the token's user, or 401
 *   POST /rest/v1/rpc/spend_generation the spend, by server/lib/generationSpend.js's
 *   POST /rest/v1/rpc/undo_generation  memory store (the same rules as the SQL)
 *   GET  /rest/v1/profiles             getProfile()
 *   POST /rest/v1/profiles             getProfile() creating a missing row
 * Anything else (generation_rate_limit, job_listings, credit_transactions)
 * answers PGRST205, "no such table": the hourly limit then fails open and the
 * explain route reads no description, both as they would on a bare project.
 * `options.migrated = false` makes the two functions missing (PGRST202), as
 * on a project where migration 007 was never applied.
 *
 * Not a test file (no .test.js), so `node --test` does not run it.
 */

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

function send(res, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

/**
 * @param {{ store: ReturnType<import('../../server/lib/generationSpend.js').memorySpendStore>,
 *   users: Record<string, {id: string, email: string}> }} args `users` maps a
 *   bearer token to the account it signs in.
 */
export function fakeSupabase({ store, users }) {
  const calls = [];
  const options = { migrated: true, rpcDelayMs: 0 };

  async function handler(req, res) {
    const url = new URL(req.url, 'http://fake.supabase');
    const body = await readBody(req);
    calls.push({ method: req.method, path: url.pathname, search: url.search, body });

    if (url.pathname === '/auth/v1/user') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const user = users[token];
      if (!user) return send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
      return send(res, 200, {
        id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email,
        app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
      });
    }

    const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname);
    if (rpc) {
      const fn = rpc[1];
      if (!options.migrated || !['spend_generation', 'undo_generation'].includes(fn)) {
        return send(res, 404, {
          code: 'PGRST202',
          details: `Searched for the function public.${fn} with parameters ${Object.keys(body || {}).sort().join(', ')}, but no matches were found in the schema cache.`,
          hint: null,
          message: `Could not find the function public.${fn}(${Object.keys(body || {}).sort().join(', ')}) in the schema cache`,
        });
      }
      if (options.rpcDelayMs) await new Promise((r) => setTimeout(r, options.rpcDelayMs));
      if (fn === 'undo_generation') return send(res, 200, await store.undo(body.p_user, body.p_spend, body.p_description));
      try {
        const spend = await store.spend({
          userId: body.p_user,
          kind: body.p_kind,
          allowanceId: body.p_allowance,
          subject: body.p_subject,
          free: body.p_free,
          description: body.p_description,
        });
        return send(res, 200, spend);
      } catch (err) {
        // `raise exception 'no_credits'`, as PostgREST reports it.
        return send(res, 400, { code: 'P0001', details: null, hint: null, message: err.code });
      }
    }

    if (url.pathname === '/rest/v1/profiles') {
      if (req.method === 'GET') {
        const id = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
        const account = store.account(id);
        const user = Object.values(users).find((u) => u.id === id);
        return send(res, 200, account
          ? [{ id, email: user?.email ?? null, display_name: 'Tester', credits: account.credits, is_premium: account.isPremium }]
          : []);
      }
      if (req.method === 'POST') {
        const row = Array.isArray(body) ? body[0] : body;
        store.setAccount(row.id, { credits: row.credits, isPremium: row.is_premium });
        const created = { ...row };
        const single = String(req.headers.accept || '').includes('vnd.pgrst.object');
        return send(res, 201, single ? created : [created]);
      }
    }

    const table = url.pathname.replace(/^\/rest\/v1\//, '');
    return send(res, 404, { code: 'PGRST205', details: null, hint: null, message: `Could not find the table 'public.${table}' in the schema cache` });
  }

  return { handler, calls, options };
}

/**
 * Groq's chat completions. `reply(body, n)` decides each answer: `{ content,
 * finish? }` for a completion, or `{ status, message }` for a provider error.
 * The default writes "Draft number <n>, written for the test."
 */
export function fakeGroq() {
  const calls = [];
  const state = {
    reply: (_body, n) => ({ content: `Draft number ${n}, written for the test.` }),
  };

  async function handler(req, res) {
    const body = await readBody(req);
    if (!req.url.endsWith('/chat/completions')) return send(res, 404, { error: { message: 'not faked' } });
    calls.push(body);
    const answer = state.reply(body, calls.length);
    if (answer.status) return send(res, answer.status, { error: { message: answer.message || 'fake provider error', type: 'server_error' } });
    return send(res, 200, {
      id: `chatcmpl-fake-${calls.length}`,
      object: 'chat.completion',
      created: 0,
      model: body?.model,
      choices: [{ index: 0, message: { role: 'assistant', content: answer.content }, finish_reason: answer.finish || 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }

  return { handler, calls, state };
}
