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

function sessionFor(email) {
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

/* Supabase auth. `answers` sets how the project behaves:
     password: 'ok' (default) | 'wrong'     POST /token?grant_type=password
     signup:   'session' (default) | 'confirm'
               POST /signup; 'confirm' is a project that wants the address
               confirmed first, so no session comes back
   Resolves with the calls made, in order ({ path, grant, body }), to assert
   what was sent. Google's hand-over (/authorize) is a page load: it gets a
   blank page, and the test reads the address. */
export async function stubAuth(page, answers = {}) {
  const calls = [];
  await page.route('**/auth/v1/**', async route => {
    const request = route.request();
    const headers = cors(request);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/auth\/v1/, '');
    const body = request.postData() ? request.postDataJSON() : null;
    calls.push({ path, grant: url.searchParams.get('grant_type'), body });

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

/* The dashboard, as a blank page: for tests that only check a button goes
   there, without booting it. */
export async function stubDashboard(page) {
  await page.route(url => url.pathname === '/dashboard/', route =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Dashboard (stub)</title>' }));
}
