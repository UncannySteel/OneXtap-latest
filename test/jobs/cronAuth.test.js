/**
 * requireCronSecret — the only thing between a scheduled job and the internet.
 *
 * Two properties matter more than the rest:
 *   1. FAIL CLOSED. An unset CRON_SECRET is 503, never a pass. The tempting
 *      alternative turns a forgotten env var into a public endpoint that
 *      anyone can use to burn the Adzuna quota, and nothing about the deploy
 *      looks wrong.
 *   2. NO THROW on a wrong-length secret. timingSafeEqual throws on buffers of
 *      unequal length, so without the length guard every wrong-length guess
 *      would be a 500 with a stack trace instead of a 401.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'error';

const { requireCronSecret } = await import('../../server/cronAuth.js');

const SECRET = 'correct-horse-battery-staple';

function mkRes() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function mkReq(headers = {}) {
  return { headers, path: '/api/jobs/ingest', method: 'GET' };
}

/** Runs the middleware and reports what happened. */
function run(req) {
  const res = mkRes();
  let nextCalls = 0;
  requireCronSecret(req, res, () => { nextCalls += 1; });
  return { res, nextCalls };
}

function withSecret(value, fn) {
  const saved = process.env.CRON_SECRET;
  if (value === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = value;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
}

test('an unset CRON_SECRET is 503, not an open door', () => {
  withSecret(undefined, () => {
    const { res, nextCalls } = run(mkReq({ authorization: `Bearer ${SECRET}` }));
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: 'Cron secret not configured' });
    assert.equal(nextCalls, 0, 'a missing secret must never pass through');
  });
});

test('an empty-string CRON_SECRET is treated as unset', () => {
  withSecret('', () => {
    const { res, nextCalls } = run(mkReq({ 'x-cron-secret': '' }));
    assert.equal(res.statusCode, 503);
    assert.equal(nextCalls, 0);
  });
});

test('no credential at all is 401', () => {
  withSecret(SECRET, () => {
    const { res, nextCalls } = run(mkReq({}));
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'Unauthorized' });
    assert.equal(nextCalls, 0);
  });
});

test('a wrong secret of the same length is 401', () => {
  withSecret(SECRET, () => {
    const wrong = 'x'.repeat(SECRET.length);
    assert.equal(wrong.length, SECRET.length, 'this case must exercise the compare, not the guard');
    const { res, nextCalls } = run(mkReq({ authorization: `Bearer ${wrong}` }));
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalls, 0);
  });
});

test('a secret of a DIFFERENT length is 401 and does not throw', () => {
  withSecret(SECRET, () => {
    // timingSafeEqual throws on mismatched buffer lengths. Without the length
    // guard this is a 500, and every short guess becomes a server error.
    for (const wrong of ['short', `${SECRET}-with-a-tail`, 'a', 'z'.repeat(4096)]) {
      assert.notEqual(wrong.length, SECRET.length);

      const viaBearer = run(mkReq({ authorization: `Bearer ${wrong}` }));
      assert.equal(viaBearer.res.statusCode, 401, `bearer, length ${wrong.length}`);
      assert.equal(viaBearer.nextCalls, 0);

      const viaHeader = run(mkReq({ 'x-cron-secret': wrong }));
      assert.equal(viaHeader.res.statusCode, 401, `header, length ${wrong.length}`);
      assert.equal(viaHeader.nextCalls, 0);
    }
  });
});

test('the correct secret as an Authorization Bearer calls next()', () => {
  withSecret(SECRET, () => {
    // This is the shape Vercel Cron sends when CRON_SECRET is a project env var.
    const { res, nextCalls } = run(mkReq({ authorization: `Bearer ${SECRET}` }));
    assert.equal(nextCalls, 1);
    assert.equal(res.statusCode, 0, 'next() ran, so nothing was written to the response');
  });
});

test('the correct secret as X-Cron-Secret calls next()', () => {
  withSecret(SECRET, () => {
    // The manual-curl path, kept separate so it does not collide with the
    // Supabase JWT that normally occupies Authorization.
    const { res, nextCalls } = run(mkReq({ 'x-cron-secret': SECRET }));
    assert.equal(nextCalls, 1);
    assert.equal(res.statusCode, 0);
  });
});

test('either header alone is enough; a bad one does not poison a good one', () => {
  withSecret(SECRET, () => {
    const good = run(mkReq({ authorization: 'Bearer wrong-value-here', 'x-cron-secret': SECRET }));
    assert.equal(good.nextCalls, 1);

    const alsoGood = run(mkReq({ authorization: `Bearer ${SECRET}`, 'x-cron-secret': 'nope' }));
    assert.equal(alsoGood.nextCalls, 1);
  });
});

test('a raw Authorization value without the Bearer prefix is rejected', () => {
  withSecret(SECRET, () => {
    const { res, nextCalls } = run(mkReq({ authorization: SECRET }));
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalls, 0);
  });
});

test('non-string header values are rejected without throwing', () => {
  withSecret(SECRET, () => {
    for (const value of [42, null, undefined, {}, ['a']]) {
      const { res, nextCalls } = run(mkReq({ 'x-cron-secret': value }));
      assert.equal(res.statusCode, 401);
      assert.equal(nextCalls, 0);
    }
  });
});

test('a request with no headers object at all does not throw', () => {
  withSecret(SECRET, () => {
    const res = mkRes();
    let nextCalls = 0;
    assert.doesNotThrow(() => {
      requireCronSecret({ path: '/api/jobs/ingest' }, res, () => { nextCalls += 1; });
    });
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalls, 0);
  });
});

test('the secret is read at call time, not at module load', () => {
  // Vercel can surface env vars after the module graph is built, and the tests
  // above mutate process.env between cases. A value captured at import time
  // would make every one of them lie.
  withSecret('first-secret-value', () => {
    assert.equal(run(mkReq({ 'x-cron-secret': 'first-secret-value' })).nextCalls, 1);
  });
  withSecret('second-secret-value', () => {
    assert.equal(run(mkReq({ 'x-cron-secret': 'first-secret-value' })).res.statusCode, 401);
    assert.equal(run(mkReq({ 'x-cron-secret': 'second-secret-value' })).nextCalls, 1);
  });
});
