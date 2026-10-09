// Stand-ins for the account (Supabase auth) and the API, for the tests that
// press buttons which talk to them. The patterns match any host, so they
// answer even when the dev server was started with a real VITE_SUPABASE_URL
// (reuseExistingServer): a test run can never sign in to a real project.
// Not a spec file, so Playwright does not run it (testMatch: *.spec.js).

// A token that parses as a JWT, for a client that reads its claims.
function fakeJwt(claims) {
  const part = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.e2e`;
}

/* The session Supabase's client keeps, for `email`. Exported for a client
   whose session has to be put in place rather than signed in (the popup). */
export function sessionFor(email) {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: '00000000-0000-4000-8000-00000000e2e0',
    aud: 'authenticated',
    role: 'authenticated',
    email,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: new Date().toISOString()
  };
  return {
    access_token: fakeJwt({ sub: user.id, email, aud: 'authenticated', role: 'authenticated', exp: now + 3600 }),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: 'e2e-refresh-token',
    user
  };
}

// The auth calls are cross-origin from the page, so every answer carries CORS
// headers, and a preflight is answered on its own.
function cors(request) {
  const headers = request.headers();
  return {
    'access-control-allow-origin': headers.origin || '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': headers['access-control-request-headers'] || '*'
  };
}

/* The hash Supabase's password-reset email opens a page with: the recovery
   session, as the implicit flow (its client's default) sends it. */
export function recoveryHash(email = 'reader@example.com') {
  const s = sessionFor(email);
  return `#access_token=${s.access_token}&expires_in=3600&refresh_token=${s.refresh_token}&token_type=bearer&type=recovery`;
}

/* Supabase auth. `answers` sets how the project behaves:
     password: 'ok' (default) | 'wrong'     POST /token?grant_type=password
     signup:   'session' (default) | 'confirm'
               POST /signup; 'confirm' is a project that wants the address
               confirmed first, so no session comes back
     recover:  'ok' (default) | 'wait'      POST /recover (the reset email);
               'wait' is Supabase's "only request this after N seconds"
     update:   'ok' (default) | 'same'      PUT /user (a new password);
               'same' is "should be different from the old password"
   GET /user answers with the user (a recovery link's session is checked
   that way). Resolves with the calls made, in order ({ method, path, grant,
   redirectTo, body }), to assert what was sent. Google's hand-over
   (/authorize) is a page load: it gets a blank page, and the test reads the
   address. */
export async function stubAuth(page, answers = {}) {
  const calls = [];
  await page.route('**/auth/v1/**', async route => {
    const request = route.request();
    const headers = cors(request);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/auth\/v1/, '');
    const body = request.postData() ? request.postDataJSON() : null;
    calls.push({
      method: request.method(), path, grant: url.searchParams.get('grant_type'),
      redirectTo: url.searchParams.get('redirect_to'), body
    });

    if (path === '/recover') {
      if (answers.recover === 'wait') {
        return route.fulfill({ status: 429, headers, json: { code: 429, error_code: 'over_email_send_rate_limit', msg: 'For security purposes, you can only request this after 42 seconds.' } });
      }
      return route.fulfill({ headers, json: {} });
    }
    if (path === '/user' && request.method() === 'GET') {
      return route.fulfill({ headers, json: sessionFor('reader@example.com').user });
    }
    if (path === '/user' && request.method() === 'PUT') {
      if (answers.update === 'same') {
        return route.fulfill({ status: 422, headers, json: { code: 422, error_code: 'same_password', msg: 'New password should be different from the old password.' } });
      }
      return route.fulfill({ headers, json: sessionFor('reader@example.com').user });
    }

    if (path === '/authorize') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Google (stub)</title>' });
    }
    if (path === '/token' && url.searchParams.get('grant_type') === 'password') {
      if (answers.password === 'wrong') {
        return route.fulfill({ status: 400, headers, json: { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' } });
      }
      return route.fulfill({ headers, json: sessionFor(body.email) });
    }
    if (path === '/signup') {
      const session = sessionFor(body.email);
      return route.fulfill({ headers, json: answers.signup === 'confirm' ? session.user : session });
    }
    // Anything else the client asks for: a plain no.
    return route.fulfill({ status: 404, headers, json: { code: 404, msg: 'not stubbed' } });
  });
  return calls;
}

/* POST /api/feedback. `answer`: 'ok' (default) or 'fail' (the server could
   not send it). Resolves with the bodies sent, in order. */
export async function stubFeedback(page, answer = 'ok') {
  const sent = [];
  await page.route('**/api/feedback', async route => {
    const request = route.request();
    const headers = cors(request);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    sent.push(request.postDataJSON());
    if (answer === 'fail') return route.fulfill({ status: 502, headers, json: { error: 'Could not send feedback.' } });
    return route.fulfill({ headers, json: { ok: true } });
  });
  return sent;
}

/* The API the dashboard boots on and spends credits through, for an account
   with `credits` and no Premium:
     GET  /api/me, /api/credits, /api/verify-premium
     POST /api/credits/deduct            one credit, never below zero
     POST /api/answer-vault/generate     a fixed letter, numbered per call
   Resolves with the calls made, in order ({ method, path, body }), and the
   live balance as `state.credits`. Anything else under /api/ is a 404. */
export async function stubApi(page, { credits = 3 } = {}) {
  const calls = [];
  const state = { credits };
  const account = () => ({
    id: '00000000-0000-4000-8000-00000000e2e0',
    email: 'reader@example.com',
    displayName: 'Ada Tester',
    credits: state.credits,
    isPremium: false,
    // Old enough that the first-run tour stays away.
    createdAt: '2026-01-01T00:00:00.000Z'
  });
  let generated = 0;
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request();
    const headers = cors(request);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const path = new URL(request.url()).pathname;
    const body = request.postData() ? request.postDataJSON() : null;
    calls.push({ method: request.method(), path, body });

    if (path === '/api/me') return route.fulfill({ headers, json: account() });
    if (path === '/api/credits') return route.fulfill({ headers, json: { credits: state.credits, isPremium: false } });
    if (path === '/api/verify-premium') return route.fulfill({ headers, json: { isPremium: false } });
    if (path === '/api/credits/deduct') {
      if (state.credits <= 0) return route.fulfill({ status: 402, headers, json: { success: false, remaining: 0, error: 'No credits remaining' } });
      state.credits -= 1;
      return route.fulfill({ headers, json: { success: true, remaining: state.credits, isPremium: false } });
    }
    if (path === '/api/answer-vault/generate') {
      generated += 1;
      return route.fulfill({ headers, json: { text: `Dear Norwick Labs team, letter number ${generated}.`, fabricationFlags: [] } });
    }
    return route.fulfill({ status: 404, headers, json: { error: 'not stubbed' } });
  });
  return { calls, state };
}

/* The dashboard, as a blank page: for tests that only check a button goes
   there, without booting it. */
export async function stubDashboard(page) {
  await page.route(url => url.pathname === '/dashboard/', route =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Dashboard (stub)</title>' }));
}
