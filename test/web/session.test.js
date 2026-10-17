// The landing page's "signed in?" check (web/src/app/session.js) and the
// Supabase client it has to agree with (src/supabaseClient.js).
//
// The landing page decides between "Log in" and "Dashboard" before Supabase's
// SDK has loaded, so it cannot ask the client for its storage key; it reads it
// from src/supabaseSessionKey.js, which src/supabaseClient.js passes to the
// client as its `storageKey` (the extension's wipe on account deletion lists
// the same key, src/localKeys.js). These tests are what keep that honest:
// the key must be supabase-js's own default, which is where every session
// signed in before the key was named still sits, and src/supabaseClient.js
// must take its key from that function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { supabaseStorageKey, hasStoredSession } from '../../web/src/app/session.js';
import { supabaseStorageKey as sharedStorageKey } from '../../src/supabaseSessionKey.js';

const CLIENT_SOURCE = new URL('../../src/supabaseClient.js', import.meta.url);

/** A client configured as src/supabaseClient.js configured it before it named
 *  its key: supabase-js picks the default. Auto-refresh and URL detection are
 *  off here only so nothing runs in the background of a test; neither has any
 *  bearing on the storage key. */
function clientFor(url, extra = {}) {
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
      ...extra,
    },
  });
}

const fakeStorage = (entries) => ({ getItem: (key) => (key in entries ? entries[key] : null) });

const URLS = [
  'https://e2e.invalid',                       // the e2e runs (web/playwright.config.js)
  'https://abcdefghijklmnopqrst.supabase.co',  // a hosted project
  'http://127.0.0.1:54321',                    // the Supabase CLI's local stack
];

test('src/supabaseClient.js takes its storageKey from src/supabaseSessionKey.js', () => {
  const source = readFileSync(CLIENT_SOURCE, 'utf8');
  assert.match(source, /import\s*\{\s*supabaseStorageKey\s*\}\s*from\s*'\.\/supabaseSessionKey(\.js)?'/);
  assert.match(source, /const storageKey = supabaseStorageKey\(supabaseUrl\);/);
  assert.match(source, /\.\.\.\(storageKey \? \{ storageKey \} : \{\}\)/);
});

test('the landing page reads the shared key, not a copy of it', () => {
  assert.equal(supabaseStorageKey, sharedStorageKey);
});

test('the named key is supabase-js\'s default: sessions from before it was named stay signed in', () => {
  for (const url of URLS) {
    const client = clientFor(url);
    assert.equal(supabaseStorageKey(url), client.auth.storageKey, url);
    assert.equal(supabaseStorageKey(url), client.storageKey, url);
  }
});

test('a client given the named key keeps its session under it', () => {
  for (const url of URLS) {
    const client = clientFor(url, { storageKey: supabaseStorageKey(url) });
    assert.equal(client.auth.storageKey, supabaseStorageKey(url), url);
    assert.equal(client.auth.storageKey, clientFor(url).auth.storageKey, url);
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
