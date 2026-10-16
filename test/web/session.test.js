// The landing page's "signed in?" check (web/src/app/session.js) and the
// Supabase client it has to agree with (src/supabaseClient.js).
//
// The landing page decides between "Log in" and "Dashboard" before Supabase's
// SDK has loaded, so it cannot ask the client for its storage key; it works
// the key out. These tests are what keep that honest: a real client, built
// with the options src/supabaseClient.js uses, must keep its session under the
// key the landing page reads, and src/supabaseClient.js must not have started
// choosing a key of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { supabaseStorageKey, hasStoredSession } from '../../web/src/app/session.js';

const CLIENT_SOURCE = new URL('../../src/supabaseClient.js', import.meta.url);

/** A client configured as src/supabaseClient.js configures it on the web.
 *  Auto-refresh and URL detection are off here only so nothing runs in the
 *  background of a test; neither has any bearing on the storage key. */
function clientFor(url) {
  const memory = new Map();
  return createClient(url, 'test-anon-key', {
    auth: {
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      storage: {
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => { memory.set(key, value); },
        removeItem: (key) => { memory.delete(key); },
      },
    },
  });
}

const fakeStorage = (entries) => ({ getItem: (key) => (key in entries ? entries[key] : null) });

test('src/supabaseClient.js leaves the storage key to supabase-js', () => {
  const source = readFileSync(CLIENT_SOURCE, 'utf8');
  assert.equal(
    /\bstorageKey\b/.test(source), false,
    'src/supabaseClient.js now chooses its own storageKey: make supabaseStorageKey() in ' +
    'web/src/app/session.js return the same key, or the landing page stops seeing sessions'
  );
});

test('the landing page reads the key a real client keeps its session under', () => {
  for (const url of [
    'https://e2e.invalid',                       // the e2e runs (web/playwright.config.js)
    'https://abcdefghijklmnopqrst.supabase.co',  // a hosted project
    'http://127.0.0.1:54321',                    // the Supabase CLI's local stack
  ]) {
    const client = clientFor(url);
    assert.equal(supabaseStorageKey(url), client.auth.storageKey, url);
    assert.equal(supabaseStorageKey(url), client.storageKey, url);
  }
});

test('the e2e address gives the key the e2e specs plant a session under', () => {
  assert.equal(supabaseStorageKey('https://e2e.invalid'), 'sb-e2e-auth-token');
});

test('no Supabase address, or one that does not parse, means no key', () => {
  for (const url of [undefined, null, '', '   ', 'not a url', 42]) {
    assert.equal(supabaseStorageKey(url), null, String(url));
  }
});

test('a stored session with a refresh token counts as signed in', () => {
  const key = 'sb-e2e-auth-token';
  const session = { access_token: 'a', refresh_token: 'r', expires_at: 0 };
  assert.equal(hasStoredSession(fakeStorage({ [key]: JSON.stringify(session) }), key), true);
  // The shape older supabase-js versions wrote.
  assert.equal(hasStoredSession(fakeStorage({ [key]: JSON.stringify({ currentSession: session }) }), key), true);
});

test('anything else is signed out, and never throws', () => {
  const key = 'sb-e2e-auth-token';
  const throwing = { getItem: () => { throw new Error('storage blocked'); } };
  const cases = [
    [fakeStorage({}), key],                                                   // nothing stored
    [fakeStorage({ [key]: '{not json' }), key],                               // corrupt
    [fakeStorage({ [key]: 'null' }), key],
    [fakeStorage({ [key]: JSON.stringify({ access_token: 'a' }) }), key],     // no refresh token
    [fakeStorage({ 'sb-other-auth-token': JSON.stringify({ refresh_token: 'r' }) }), key],  // another project's
    [throwing, key],                                                          // storage refused
    [fakeStorage({ [key]: JSON.stringify({ refresh_token: 'r' }) }), null],   // Supabase not configured
    [null, key],
  ];
  for (const [storage, k] of cases) assert.equal(hasStoredSession(storage, k), false);
});
