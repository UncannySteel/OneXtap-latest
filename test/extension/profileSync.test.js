import test from 'node:test';
import assert from 'node:assert/strict';

import { fileSyncedProfile } from '../../extension/profileSync.js';
import { storage, __resetMemoryStorageForTests } from '../../src/storage.js';
import { loadProfileStore, getActiveLegacyProfile, listProfiles } from '../../src/profileStore.js';

// The contract is the popup's view. After the service worker files a
// dashboard save, src/profileStore.js (what the popup reads profiles with)
// has to hand back that save. So each test writes the worker's output into
// the in-memory storage backend and reads it back through profileStore.

/** Write what the worker writes, the way background.js does. */
async function syncAsWorker(payload) {
  const out = fileSyncedProfile(await storage.get('onextap_profiles'), payload);
  await storage.set('onextap_profiles', out.onextap_profiles);
  await storage.set('user_profile', out.user_profile);
  return out;
}

// The dashboard's Default profile, as getActiveLegacyProfile() sends it.
// Invented person; no PII.
const dashboardDefault = () => ({
  firstName: 'Ada',
  lastName: 'Tester',
  email: 'ada@example.com',
  vault: [{ id: 1, question: 'Why us?', answer: 'The payments work.' }],
  coverLetters: [{ id: 'cl-1', name: 'General', body: 'Dear team,', createdAt: '2026-09-27T00:00:00.000Z' }],
  _activeProfileId: 'default',
  _activeProfileName: 'Default',
});

// A store the popup has written: its own Default, plus a Work profile it
// has made active.
async function seedPopupStore() {
  await storage.set('onextap_profiles', {
    profiles: {
      default: { name: 'Default', isDefault: true, autofillData: { firstName: 'Old' }, coverLetters: [], savedAnswers: [] },
      'profile-1': { name: 'Work', isDefault: false, autofillData: { firstName: 'Worky' }, coverLetters: [], savedAnswers: [] },
    },
    activeProfileId: 'profile-1',
  });
}

test('a popup that has opened before sees the dashboard save (the bug this fixes)', async () => {
  __resetMemoryStorageForTests();
  await loadProfileStore();   // the popup's first run creates the store
  await syncAsWorker(dashboardDefault());

  const seen = await getActiveLegacyProfile();
  assert.equal(seen.firstName, 'Ada');
  assert.equal(seen.email, 'ada@example.com');
  assert.deepEqual(seen.vault, dashboardDefault().vault);
  assert.deepEqual(seen.coverLetters, dashboardDefault().coverLetters);
  assert.equal(seen._activeProfileId, 'default');
});

test('before the popup has ever opened, the store is made, and cover letters stay cover letters', async () => {
  // Writing only the mirror left this to profileStore's first-run migration,
  // which files everything but `vault` as autofill fields: the synced cover
  // letters ended up inside autofillData and the profile's own list was empty.
  __resetMemoryStorageForTests();
  await syncAsWorker(dashboardDefault());

  const store = await loadProfileStore();
  assert.deepEqual(Object.keys(store.profiles), ['default']);
  const profile = store.profiles.default;
  assert.equal(profile.isDefault, true);
  assert.deepEqual(profile.coverLetters, dashboardDefault().coverLetters);
  assert.equal('coverLetters' in profile.autofillData, false);
  assert.equal('_activeProfileId' in profile.autofillData, false);
});

test('the mirror is exactly what profileStore would write for the active profile', async () => {
  __resetMemoryStorageForTests();
  await seedPopupStore();
  const out = await syncAsWorker(dashboardDefault());
  assert.deepEqual(out.user_profile, await getActiveLegacyProfile());
});

test('the synced profile becomes active, and the other profiles in the popup are untouched', async () => {
  __resetMemoryStorageForTests();
  await seedPopupStore();
  const work = (await storage.get('onextap_profiles')).profiles['profile-1'];

  await syncAsWorker(dashboardDefault());
  const store = await loadProfileStore();
  assert.equal(store.activeProfileId, 'default');
  assert.equal(store.profiles.default.autofillData.firstName, 'Ada');
  assert.deepEqual(store.profiles['profile-1'], work);
});

test('a profile made on the dashboard is added under its id, with its name', async () => {
  __resetMemoryStorageForTests();
  await seedPopupStore();
  await syncAsWorker({ ...dashboardDefault(), firstName: 'Des', _activeProfileId: 'profile-9', _activeProfileName: 'Design' });

  const store = await loadProfileStore();
  assert.equal(store.activeProfileId, 'profile-9');
  assert.deepEqual(listProfiles(store).map((p) => p.name).sort(), ['Default', 'Design', 'Work']);
  assert.equal(store.profiles['profile-9'].isDefault, false);
  assert.equal((await getActiveLegacyProfile()).firstName, 'Des');
});

test('a profile made separately on each side is matched by name, not duplicated', async () => {
  __resetMemoryStorageForTests();
  await seedPopupStore();
  await syncAsWorker({ ...dashboardDefault(), firstName: 'New', _activeProfileId: 'profile-2', _activeProfileName: ' work ' });

  const store = await loadProfileStore();
  assert.deepEqual(Object.keys(store.profiles).sort(), ['default', 'profile-1']);
  assert.equal(store.activeProfileId, 'profile-1');
  assert.equal(store.profiles['profile-1'].autofillData.firstName, 'New');
});

test('a rename on the dashboard carries over, unless the name is taken here', async () => {
  __resetMemoryStorageForTests();
  await seedPopupStore();
  await syncAsWorker({ ...dashboardDefault(), _activeProfileId: 'profile-1', _activeProfileName: 'Engineering' });
  assert.equal((await loadProfileStore()).profiles['profile-1'].name, 'Engineering');

  // 'Default' is the other profile's name, so profile-1 keeps its own.
  await syncAsWorker({ ...dashboardDefault(), _activeProfileId: 'profile-1', _activeProfileName: 'Default' });
  const store = await loadProfileStore();
  assert.equal(store.profiles['profile-1'].name, 'Engineering');
  assert.equal(store.profiles.default.name, 'Default');
});

test('a payload without ids is the Default profile; a junk store is replaced, not crashed on', async () => {
  __resetMemoryStorageForTests();
  await storage.set('onextap_profiles', 'not a store');
  const { vault, coverLetters, _activeProfileId, _activeProfileName, ...bare } = dashboardDefault();
  await syncAsWorker(bare);

  const store = await loadProfileStore();
  assert.equal(store.activeProfileId, 'default');
  assert.equal(store.profiles.default.name, 'Default');
  assert.deepEqual(store.profiles.default.savedAnswers, []);
  assert.deepEqual(store.profiles.default.coverLetters, []);
  assert.equal((await getActiveLegacyProfile()).firstName, 'Ada');
});

test('a payload without vault or cover letters keeps the ones already stored', async () => {
  __resetMemoryStorageForTests();
  await syncAsWorker(dashboardDefault());
  const { vault, coverLetters, ...fieldsOnly } = dashboardDefault();
  await syncAsWorker({ ...fieldsOnly, firstName: 'Ada B.' });

  const seen = await getActiveLegacyProfile();
  assert.equal(seen.firstName, 'Ada B.');
  assert.deepEqual(seen.vault, dashboardDefault().vault);
  assert.deepEqual(seen.coverLetters, dashboardDefault().coverLetters);
});
