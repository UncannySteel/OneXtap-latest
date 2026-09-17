/**
 * Opik wrapper — the property under test is "it cannot break anything".
 *
 * Almost every assertion here is about the DISABLED path, because that is the
 * path every developer machine, every CI run, and every deploy without an Opik
 * key takes. If tracing is going to fail, it will fail there, and it will fail
 * as a crash in a code path nobody was looking at. So: no key means no client,
 * no SDK load, and handles that still chain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { sep } from 'node:path';

import {
  isTracingEnabled,
  getOpikClient,
  startTrace,
  flushTracing,
  redactForTrace,
  SpanType,
  MAX_FLUSH_MS,
  __setOpikClientForTests,
} from '../../server/observability/opik.js';

const ENV_KEYS = ['OPIK_API_KEY', 'OPIK_PROJECT_NAME', 'OPIK_WORKSPACE', 'OPIK_URL_OVERRIDE'];

/** Snapshot/restore only the keys we touch, so one test cannot leak into another. */
function saveEnv() {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  return () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    __setOpikClientForTests(null);
  };
}

function disableTracing() {
  const restore = saveEnv();
  for (const k of ENV_KEYS) delete process.env[k];
  __setOpikClientForTests(null);
  return restore;
}

/**
 * Whether the opik package has been evaluated in this process.
 *
 * createRequire().cache is the one CJS module cache shared process-wide, so
 * this sees the SDK regardless of which node_modules resolved it — the root
 * install or server/node_modules.
 *
 * Matches any file inside the package rather than its current dist/ layout: if
 * the SDK reorganises its build and this stops matching, the test does not
 * fail — it silently passes forever, and the one property this whole file
 * exists to pin stops being checked at all.
 */
function opikModuleLoaded() {
  const cache = createRequire(import.meta.url).cache;
  return Object.keys(cache).some((p) => p.includes(`${sep}node_modules${sep}opik${sep}`));
}

// ------------------------------------------------------------------
// The critical test
// ------------------------------------------------------------------
test('with OPIK_API_KEY unset, tracing is inert and the SDK is never loaded', () => {
  const restore = disableTracing();
  try {
    assert.equal(isTracingEnabled(), false);
    assert.equal(getOpikClient(), null);

    const trace = startTrace({ name: 'job_ingest', input: { sources: ['cache'] } });
    assert.ok(trace, 'startTrace must never return null');
    assert.equal(trace.id, null);

    // The whole point: this chains without a single `if (trace)` anywhere.
    const span = trace.span({ name: 'source_fetch', type: SpanType.Tool, input: { source: 'cache' } });
    assert.doesNotThrow(() => span.update({ output: { fetched: 0 } }).end());
    assert.doesNotThrow(() => trace.update({ output: { ok: true } }).end());

    // If any Opik code had run, the package would be in the module cache.
    assert.equal(opikModuleLoaded(), false, 'no key must mean no SDK load at all');
  } finally {
    restore();
  }
});

test('an empty or whitespace-only key is not a key', () => {
  const restore = saveEnv();
  try {
    process.env.OPIK_API_KEY = '';
    assert.equal(isTracingEnabled(), false);

    process.env.OPIK_API_KEY = '   ';
    assert.equal(isTracingEnabled(), false);

    process.env.OPIK_API_KEY = 'k';
    assert.equal(isTracingEnabled(), true);
  } finally {
    restore();
  }
});

test('disabled handles nest arbitrarily deep and always chain', () => {
  const restore = disableTracing();
  try {
    let node = startTrace({ name: 'root' });
    for (let i = 0; i < 50; i += 1) {
      node = node.span({ name: `depth-${i}`, type: SpanType.General, input: { i } });
      assert.ok(node, `depth ${i} returned a falsy handle`);
      assert.equal(node.id, null);
      assert.equal(typeof node.span, 'function');
      assert.equal(typeof node.update, 'function');
      assert.equal(typeof node.end, 'function');
    }
    // update()/end() are chainable in both directions.
    assert.equal(node.update({ output: {} }).end().update({ metadata: {} }), node.end());
  } finally {
    restore();
  }
});

test('startTrace survives being called with nothing at all', () => {
  const restore = disableTracing();
  try {
    assert.doesNotThrow(() => startTrace().span().update().end());
    assert.doesNotThrow(() => startTrace({}).span({}).update({}).end());
  } finally {
    restore();
  }
});

// ------------------------------------------------------------------
// flushTracing
// ------------------------------------------------------------------
test('flushTracing resolves when tracing is disabled', async () => {
  const restore = disableTracing();
  try {
    await assert.doesNotReject(() => flushTracing());
  } finally {
    restore();
  }
});

test('flushTracing resolves when the client throws synchronously', async () => {
  const restore = saveEnv();
  try {
    process.env.OPIK_API_KEY = 'test-key';
    __setOpikClientForTests({
      flush() { throw new Error('boom'); },
      trace() { throw new Error('boom'); },
    });
    await assert.doesNotReject(() => flushTracing());
  } finally {
    restore();
  }
});

test('flushTracing resolves when the client rejects', async () => {
  const restore = saveEnv();
  try {
    process.env.OPIK_API_KEY = 'test-key';
    __setOpikClientForTests({ flush: () => Promise.reject(new Error('network down')) });
    await assert.doesNotReject(() => flushTracing());
  } finally {
    restore();
  }
});

test('flushTracing is bounded — a hung endpoint does not hang the request', async () => {
  const restore = saveEnv();
  try {
    process.env.OPIK_API_KEY = 'test-key';
    // Never settles. Without the MAX_FLUSH_MS race this test would hang forever,
    // which is exactly what it would do to an ingest run in production.
    __setOpikClientForTests({ flush: () => new Promise(() => {}) });

    const startedAt = Date.now();
    await flushTracing();
    const ms = Date.now() - startedAt;

    assert.ok(ms >= MAX_FLUSH_MS - 50, `returned too early (${ms}ms)`);
    assert.ok(ms < MAX_FLUSH_MS + 1500, `not bounded (${ms}ms)`);
  } finally {
    restore();
  }
});

// ------------------------------------------------------------------
// Enabled path (against a stand-in client — no key, no network)
// ------------------------------------------------------------------
test('an enabled trace forwards to the client and reports its id', () => {
  const restore = saveEnv();
  try {
    process.env.OPIK_API_KEY = 'test-key';

    const calls = [];
    const node = (id) => ({
      data: { id },
      span(opts) { calls.push(['span', opts]); return node(`${id}.s`); },
      update(patch) { calls.push(['update', patch]); },
      end() { calls.push(['end']); },
    });
    __setOpikClientForTests({
      trace(opts) { calls.push(['trace', opts]); return node('trace-1'); },
      flush: async () => {},
    });

    const trace = startTrace({ name: 'job_ingest', input: { sources: ['cache'] }, tags: ['ingest'] });
    assert.equal(trace.id, 'trace-1');

    const span = trace.span({ name: 'source_fetch:cache', type: SpanType.Tool, input: { source: 'cache' } });
    assert.equal(span.id, 'trace-1.s');
    span.update({ output: { fetched: 3 } }).end();
    trace.update({ output: { ok: true } }).end();

    assert.deepEqual(calls.map((c) => c[0]), ['trace', 'span', 'update', 'end', 'update', 'end']);
    assert.equal(calls[0][1].name, 'job_ingest');
    assert.deepEqual(calls[0][1].input, { sources: ['cache'] });
    assert.equal(calls[1][1].type, 'tool');
  } finally {
    restore();
  }
});

test('a throwing SDK degrades to inert handles instead of propagating', () => {
  const restore = saveEnv();
  try {
    process.env.OPIK_API_KEY = 'test-key';

    __setOpikClientForTests({
      trace() {
        return {
          data: { id: 't' },
          span() { throw new Error('span exploded'); },
          update() { throw new Error('update exploded'); },
          end() { throw new Error('end exploded'); },
        };
      },
      flush: async () => {},
    });

    const trace = startTrace({ name: 'x' });
    assert.doesNotThrow(() => {
      const s = trace.span({ name: 'y', type: SpanType.Tool });
      s.update({ output: { a: 1 } }).end();
      trace.update({ output: {} }).end();
    });
    // The failed span still came back as a usable handle.
    assert.equal(trace.span({ name: 'z' }).id, null);
  } finally {
    restore();
  }
});

test('the live handle and the inert handle expose the same shape', () => {
  const restore = saveEnv();
  try {
    process.env.OPIK_API_KEY = 'test-key';
    const node = () => ({ data: { id: 'n' }, span: () => node(), update() {}, end() {} });
    __setOpikClientForTests({ trace: () => node(), flush: async () => {} });
    const live = startTrace({ name: 'x' });

    delete process.env.OPIK_API_KEY;
    __setOpikClientForTests(null);
    const inert = startTrace({ name: 'x' });

    // What makes `if (trace)` unnecessary is not that both are truthy, it is
    // that both answer the same calls. Add a method to one and not the other
    // and a call site works with a key and throws without one — a failure that
    // only ever shows up in the configuration nobody runs locally.
    assert.deepEqual(Object.keys(live).sort(), Object.keys(inert).sort());
    for (const k of Object.keys(inert)) {
      // `id` is the one key that legitimately differs — a real id with tracing
      // on, null with it off. Every other key must be a callable method on
      // both, or chaining breaks in exactly one configuration.
      if (k === 'id') continue;
      assert.equal(typeof live[k], 'function', `live handle's ${k} is not callable`);
      assert.equal(typeof inert[k], 'function', `inert handle's ${k} is not callable`);
    }
  } finally {
    restore();
  }
});

test('a client that is present but broken degrades to inert handles', async () => {
  const restore = saveEnv();
  try {
    process.env.OPIK_API_KEY = 'test-key';
    // No trace(), no flush() — the shape a half-initialised or version-drifted
    // SDK would present. Nothing here may reach the caller.
    __setOpikClientForTests({});

    const trace = startTrace({ name: 'x' });
    assert.equal(trace.id, null);
    assert.doesNotThrow(() => trace.span({ name: 'y' }).update({ output: {} }).end());
    await assert.doesNotReject(() => flushTracing());
  } finally {
    restore();
  }
});

// ------------------------------------------------------------------
// redactForTrace
// ------------------------------------------------------------------
test('redactForTrace removes every secret key name', () => {
  const out = redactForTrace({
    apiKey: 'sk-live-1',
    api_key: 'sk-live-2',
    token: 'sk-live-3',
    authorization: 'Bearer sk-live-4',
    password: 'hunter2',
    secret: 'sk-live-5',
    serviceRoleKey: 'eyJhbGci-live',
    keep: 'visible',
  });

  for (const k of ['apiKey', 'api_key', 'token', 'authorization', 'password', 'secret', 'serviceRoleKey']) {
    assert.equal(out[k], '[secret]', `${k} was not redacted`);
  }
  assert.equal(out.keep, 'visible');

  // Belt and braces: no fragment of any secret survives anywhere in the output.
  assert.equal(JSON.stringify(out).includes('live'), false);
});

test('redactForTrace redacts secrets nested inside objects and arrays', () => {
  const out = redactForTrace({ a: { b: [{ token: 'sk-live-x' }] } });
  assert.equal(out.a.b[0].token, '[secret]');
});

test('redactForTrace truncates long strings', () => {
  const long = 'x'.repeat(5000);
  const out = redactForTrace(long, { maxChars: 100 });
  assert.equal(typeof out, 'string');
  assert.ok(out.startsWith('x'.repeat(100)));
  assert.ok(out.length < 200, `not truncated: ${out.length}`);
  assert.match(out, /\+4900 chars/);

  // Short strings are left exactly alone.
  assert.equal(redactForTrace('short', { maxChars: 100 }), 'short');
});

test('redactForTrace caps long arrays', () => {
  const out = redactForTrace(Array.from({ length: 500 }, (_, i) => i));
  assert.ok(Array.isArray(out));
  assert.ok(out.length < 100, `array not capped: ${out.length}`);
  assert.match(String(out[out.length - 1]), /more/);
});

test('redactForTrace is total against anything callers might pass', () => {
  assert.equal(redactForTrace(null), null);
  assert.equal(redactForTrace(undefined), undefined);
  assert.equal(redactForTrace(42), 42);
  assert.equal(redactForTrace(Number.NaN), 'NaN');
  assert.equal(redactForTrace(Infinity), 'Infinity');
  assert.equal(redactForTrace(true), true);
  assert.deepEqual(redactForTrace([]), []);
  assert.deepEqual(redactForTrace({}), {});
  assert.equal(redactForTrace(() => {}), '[function]');
  assert.equal(redactForTrace(10n), '10');

  // Bad options must not matter either.
  assert.doesNotThrow(() => redactForTrace('abc', null));
  assert.doesNotThrow(() => redactForTrace('abc', { maxChars: -5 }));
  assert.doesNotThrow(() => redactForTrace('abc', { maxChars: 'nonsense' }));
});

test('redactForTrace survives a circular reference', () => {
  const a = { name: 'a' };
  a.self = a;
  a.children = [{ parent: a }];

  const out = redactForTrace(a);
  assert.equal(out.name, 'a');
  assert.equal(out.self, '[circular]');
  // And the result is actually serializable, which is the reason this matters —
  // the SDK will JSON-stringify whatever we hand it.
  assert.doesNotThrow(() => JSON.stringify(out));
});

test('redactForTrace output is always JSON-serializable', () => {
  const nasty = {
    err: new Error('nope'),
    when: new Date('2020-01-01T00:00:00.000Z'),
    fn: function named() {},
    big: 9007199254740993n,
    set: new Set([1, 2]),
    map: new Map([['k', 'v']]),
    deep: { a: { b: { c: { d: { e: { f: { g: 'too deep' } } } } } } },
  };
  const out = redactForTrace(nasty);
  assert.doesNotThrow(() => JSON.stringify(out));
  assert.equal(out.when, '2020-01-01T00:00:00.000Z');
  assert.equal(out.err.message, 'nope');
});

test('redactForTrace summarises binary instead of expanding it byte by byte', () => {
  // A Buffer is not an Array, so the array cap does not apply to it. Without a
  // branch of its own it falls through to the object walk and becomes one key
  // PER BYTE — a megabyte request body turns into a million-key object on its
  // way to Opik, which is a size failure the caps exist to make impossible.
  const out = redactForTrace({ body: Buffer.alloc(4096, 7) });
  assert.equal(typeof out.body, 'string');
  assert.match(out.body, /4096 bytes/);
  assert.ok(JSON.stringify(out).length < 200, `binary was expanded: ${JSON.stringify(out).length} chars`);

  assert.match(String(redactForTrace(new Uint8Array(10))), /10 bytes/);
  assert.match(String(redactForTrace(new ArrayBuffer(8))), /8 bytes/);
});

test('one hostile property does not cost the whole payload', () => {
  // Reading every value up front means a single throwing getter takes the
  // entire span payload down to '[unredactable]' — losing all the context the
  // span was added to capture along with the one bad field.
  const out = redactForTrace({ ok: 1, get boom() { throw new Error('nope'); }, alsoOk: 'kept' });
  assert.equal(out.ok, 1);
  assert.equal(out.alsoOk, 'kept');
  assert.equal(out.boom, '[unreadable]');

  // A value that cannot even be enumerated still degrades to a string.
  const hostile = new Proxy({}, { ownKeys() { throw new Error('no keys'); } });
  assert.doesNotThrow(() => JSON.stringify(redactForTrace({ hostile })));
});

test('SpanType mirrors the SDK values ingest.js relies on', () => {
  assert.deepEqual(SpanType, { General: 'general', Tool: 'tool', Llm: 'llm', Guardrail: 'guardrail' });
});
