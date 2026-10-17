/**
 * src/localKeys.js: every key Onextap writes to chrome.storage.local, defined
 * once, which the stores import and ONEXTAP_WIPE_LOCAL removes after the
 * account is deleted (docs/extension-protocol.md, "The wipe").
 *
 * The list is only as good as its coverage, so these tests come at it three
 * ways: every store's writes, run for real against the in-memory backend; the
 * worker's own sync; and a scan of src/ that fails the day a module writes
 * under a key not defined there, or spells one of its keys out itself.
 */
import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

import { canLoadViteModules, registerViteModules, TEST_ENV } from './viteModules.js';

const skip = canLoadViteModules ? false : 'needs module.registerHooks (Node 22.15+)';
const SRC = new URL('../../src/', import.meta.url);

let keys;
let LOCAL_KEYS;
let storage;
let resetStorage;
let profileStore;
let resumeStore;
let applicationTypeStorage;
let consent;
let fileSyncedProfile;
let supabaseStorageKey;

before(async () => {
  if (skip) return;
  // The stores import './storage' and the like with no extension, which only
  // Vite (or these hooks) resolves; the hooks also give src/ an
  // import.meta.env, so the session key is on the list here.
  registerViteModules();
  keys = await import('../../src/localKeys.js');
  ({ LOCAL_KEYS } = keys);
  ({ storage, __resetMemoryStorageForTests: resetStorage } = await import('../../src/storage.js'));
  profileStore = await import('../../src/profileStore.js');
  resumeStore = await import('../../src/resumeStore.js');
  applicationTypeStorage = await import('../../src/applicationTypeStorage.js');
  consent = await import('../../src/consent.js');
  ({ fileSyncedProfile } = await import('../../extension/profileSync.js'));
  ({ supabaseStorageKey } = await import('../../src/supabaseSessionKey.js'));
});

/** Every key written through src/storage.js while `fn` runs. */
async function keysWrittenBy(fn) {
  const written = new Set();
  const { set, setStrict } = storage;
  storage.set = (key, value) => { written.add(key); return set(key, value); };
  storage.setStrict = (key, value) => { written.add(key); return setStrict(key, value); };
  try {
    await fn();
  } finally {
    storage.set = set;
    storage.setStrict = setStrict;
  }
  return [...written];
}

beforeEach(() => resetStorage?.());

test('the list: strings, no repeats, frozen', { skip }, () => {
  assert.ok(LOCAL_KEYS.length > 0);
  assert.ok(LOCAL_KEYS.every((k) => typeof k === 'string' && k.length > 0));
  assert.equal(new Set(LOCAL_KEYS).size, LOCAL_KEYS.length);
  assert.ok(Object.isFrozen(LOCAL_KEYS));
});

test('it holds every key constant defined beside it, and the session', { skip }, () => {
  const constants = Object.entries(keys).filter(([name]) => name !== 'LOCAL_KEYS');
  assert.deepEqual(constants.map(([name]) => name).sort(), [
    'ANALYTICS_CONSENT_KEY', 'APPLICATION_TYPE_KEY', 'COOKIE_NOTICE_SEEN_KEY',
    'LEGACY_PROFILE_KEY', 'LEGACY_TUTORIAL_SEEN_KEY', 'PROFILES_STORAGE_KEY', 'RESUMES_STORAGE_KEY',
  ]);
  assert.deepEqual([...LOCAL_KEYS].sort(),
    [...constants.map(([, value]) => value), supabaseStorageKey(TEST_ENV.VITE_SUPABASE_URL)].sort());
  // What those constants say today, so a rename is a decision someone sees.
  assert.deepEqual([...LOCAL_KEYS].sort(), [
    'onextap_analytics_consent', 'onextap_application_type', 'onextap_cookie_notice_seen',
    'onextap_profiles', 'onextap_resumes', 'onextap_tutorial_seen', 'sb-supabase-auth-token', 'user_profile',
  ]);
  // The resume store still hands its key to the tests that corrupt it.
  assert.equal(resumeStore.RESUMES_STORAGE_KEY, keys.RESUMES_STORAGE_KEY);
});

test('store 1.0.2\'s tour flag is on the list, though nothing in src/ writes it now', { skip }, () => {
  // 1.0.2's popup wrote it to chrome.storage.local; a 1.0.2 install that
  // updates keeps it there until the wipe takes it.
  assert.equal(keys.LEGACY_TUTORIAL_SEEN_KEY, 'onextap_tutorial_seen');
  assert.ok(LOCAL_KEYS.includes(keys.LEGACY_TUTORIAL_SEEN_KEY));
  const users = sourcesUnder(SRC)
    .filter((url) => relative(url) !== 'localKeys.js' && /\bLEGACY_TUTORIAL_SEEN_KEY\b/.test(readFileSync(url, 'utf8')));
  assert.deepEqual(users.map(relative), []);
});

test('the profile store writes only keys on the list: first-run migration and every mutator', { skip }, async () => {
  const written = await keysWrittenBy(async () => {
    await storage.set(keys.LEGACY_PROFILE_KEY, { firstName: 'Ada', vault: [] });
    await profileStore.loadProfileStore();
    const { profileId } = await profileStore.createProfile('Second');
    await profileStore.renameProfile(profileId, 'Another');
    await profileStore.setActiveProfileId(profileId);
    await profileStore.updateActiveProfileData({ autofillData: { firstName: 'Ada' }, coverLetters: [], savedAnswers: [] });
    await profileStore.saveLegacyUserProfile({ firstName: 'Augusta', vault: [] });
    await profileStore.deleteProfile(profileId);
  });
  assert.ok(written.length > 0);
  for (const key of written) assert.ok(LOCAL_KEYS.includes(key), key);
});

test('the resume store writes only keys on the list', { skip }, async () => {
  const written = await keysWrittenBy(async () => {
    const { resumeId } = await resumeStore.addResume({ name: 'CV', fileName: 'cv.pdf', sourceHash: 'ab', cvText: 'Python engineer' });
    await resumeStore.saveParsedResume({ fileName: 'other.pdf', sourceHash: 'cd', cvText: 'Go engineer' });
    await resumeStore.renameResume(resumeId, 'Main CV');
    await resumeStore.setActiveResumeId(resumeId);
    await resumeStore.rederiveIfStale(resumeId);
    await resumeStore.deleteResume(resumeId);
  });
  assert.ok(written.length > 0);
  for (const key of written) assert.ok(LOCAL_KEYS.includes(key), key);
});

test('the settings write only keys on the list: application type and consent', { skip }, async () => {
  const written = await keysWrittenBy(async () => {
    await applicationTypeStorage.setApplicationType('job');
    await consent.markCookieNoticeSeen();
    await consent.setAnalyticsConsent(false);
  });
  assert.equal(written.length, 3);
  for (const key of written) assert.ok(LOCAL_KEYS.includes(key), key);
});

test('the worker\'s sync writes only keys on the list', { skip }, () => {
  const out = fileSyncedProfile(undefined, { firstName: 'Ada' });
  for (const key of Object.keys(out)) assert.ok(LOCAL_KEYS.includes(key), key);
});

test('the session key is the one the Supabase client keeps its session under', { skip }, () => {
  const url = TEST_ENV.VITE_SUPABASE_URL;
  const client = createClient(url, 'test-anon-key', {
    auth: {
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      storageKey: supabaseStorageKey(url),
      storage: { getItem: () => null, setItem() {}, removeItem() {} },
    },
  });
  assert.ok(LOCAL_KEYS.includes(client.auth.storageKey));
  // And src/supabaseClient.js passes exactly that key (test/web/session.test.js
  // holds the key to supabase-js's own default, so no session is lost).
  const source = readFileSync(new URL('supabaseClient.js', SRC), 'utf8');
  assert.match(source, /import\s*\{\s*supabaseStorageKey\s*\}\s*from\s*'\.\/supabaseSessionKey(\.js)?'/);
  assert.match(source, /storageKey\b/);
});

// ---------- Nothing in src/ writes a key the list does not know ----------

function sourcesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) out.push(...sourcesUnder(url));
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(url);
  }
  return out;
}

const relative = (url) => url.href.slice(SRC.href.length);

test('every storage write in src/ uses a key constant imported from src/localKeys.js', { skip }, () => {
  const writes = [];
  for (const url of sourcesUnder(SRC)) {
    const source = readFileSync(url, 'utf8');
    for (const m of source.matchAll(/\bstorage\.(?:set|setStrict)\(\s*([^,)]+)/g)) {
      writes.push({ file: relative(url), source, arg: m[1].trim() });
    }
  }
  assert.ok(writes.length >= 6, 'the scan found the stores\' writes');
  for (const { file, source, arg } of writes) {
    // A string literal, or a key made up on the spot, could never be on the
    // list: define the key in src/localKeys.js and import it from there.
    assert.match(arg, /^[A-Z][A-Z0-9_]*$/, `${file} writes storage under ${arg}: use a key constant from src/localKeys.js`);
    const imports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/localKeys(?:\.js)?'/g)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim()));
    assert.ok(imports.includes(arg), `${file} must import ${arg} from './localKeys.js'`);
    assert.ok(LOCAL_KEYS.includes(keys[arg]), `${arg} ("${keys[arg]}") is missing from LOCAL_KEYS`);
  }
});

test('one string, one place: no module in src/ but localKeys.js spells out a key on the list', { skip }, () => {
  const literals = LOCAL_KEYS.filter((k) => !k.startsWith('sb-'));
  for (const url of sourcesUnder(SRC)) {
    if (relative(url) === 'localKeys.js') continue;
    const source = readFileSync(url, 'utf8');
    for (const key of literals) {
      assert.ok(!source.includes(`'${key}'`) && !source.includes(`"${key}"`),
        `${relative(url)} spells out '${key}': import it from src/localKeys.js`);
    }
  }
});

test('only the storage wrapper and the Supabase session adapter touch chrome.storage or localStorage in src/', { skip }, () => {
  const direct = sourcesUnder(SRC)
    .filter((url) => /chrome\.storage\.local\.set|localStorage\.setItem/.test(readFileSync(url, 'utf8')))
    .map(relative)
    .sort();
  assert.deepEqual(direct, ['storage.js', 'supabaseClient.js']);
});
