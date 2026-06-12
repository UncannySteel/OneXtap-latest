import { storage } from './storage';

export const PROFILES_STORAGE_KEY = 'onextap_profiles';
export const ACTIVE_PROFILE_KEY = 'activeProfileId';
export const DEFAULT_PROFILE_ID = 'default';
export const MAX_PROFILE_NAME_LENGTH = 32;
export const MAX_COVER_LETTERS_PER_PROFILE = 10;

const LEGACY_PROFILE_KEY = 'user_profile';

/** @typedef {{ id: string, company: string, role: string, jdSnippet: string, body: string, createdAt: string }} CoverLetterVariant */

/** @typedef {{ id: string, name: string, body: string, createdAt: string, lastUsed?: string, applicationType?: string, variants?: CoverLetterVariant[] }} CoverLetterTemplate */

/**
 * @typedef {Object} StoredProfile
 * @property {string} name
 * @property {boolean} [isDefault]
 * @property {Record<string, unknown>} autofillData
 * @property {CoverLetterTemplate[]} coverLetters
 * @property {Array<{ id: number|string, question: string, answer: string, aiImprovementsLeft?: number }>} savedAnswers
 */

/**
 * @returns {Promise<{ profiles: Record<string, StoredProfile>, activeProfileId: string }>}
 */
export async function loadProfileStore() {
  const stored = await storage.get(PROFILES_STORAGE_KEY);
  if (stored?.profiles && typeof stored.profiles === 'object') {
    const activeId = stored.activeProfileId || Object.keys(stored.profiles)[0] || DEFAULT_PROFILE_ID;
    return { profiles: stored.profiles, activeProfileId: activeId };
  }

  const legacy = await storage.get(LEGACY_PROFILE_KEY);
  const { vault, ...autofillData } = legacy && typeof legacy === 'object' ? legacy : {};
  const defaultProfile = {
    name: 'Default',
    isDefault: true,
    autofillData: autofillData || {},
    coverLetters: [],
    savedAnswers: Array.isArray(vault) ? vault : [],
  };

  const migrated = {
    profiles: { [DEFAULT_PROFILE_ID]: defaultProfile },
    activeProfileId: DEFAULT_PROFILE_ID,
  };
  await saveProfileStore(migrated);
  await syncLegacyUserProfile(migrated);
  return migrated;
}

/**
 * @param {{ profiles: Record<string, StoredProfile>, activeProfileId: string }} store
 */
export async function saveProfileStore(store) {
  await storage.set(PROFILES_STORAGE_KEY, store);
  await syncLegacyUserProfile(store);
}

/**
 * Keep user_profile in sync so content script + existing code keep working.
 * @param {{ profiles: Record<string, StoredProfile>, activeProfileId: string }} store
 */
export async function syncLegacyUserProfile(store) {
  const merged = profileToLegacyUserProfile(store);
  if (merged) {
    await storage.set(LEGACY_PROFILE_KEY, merged);
  }
}

/**
 * @param {{ profiles: Record<string, StoredProfile>, activeProfileId: string }} store
 * @returns {Record<string, unknown>|null}
 */
export function profileToLegacyUserProfile(store) {
  const active = store.profiles?.[store.activeProfileId];
  if (!active) return null;
  return {
    ...(active.autofillData || {}),
    vault: active.savedAnswers || [],
    coverLetters: active.coverLetters || [],
    _activeProfileId: store.activeProfileId,
    _activeProfileName: active.name,
  };
}

/**
 * @param {Record<string, unknown>} legacyProfile
 * @returns {Promise<{ profiles: Record<string, StoredProfile>, activeProfileId: string }>}
 */
export async function saveLegacyUserProfile(legacyProfile) {
  const store = await loadProfileStore();
  const active = store.profiles[store.activeProfileId];
  if (!active) return store;

  const { vault, coverLetters, _activeProfileId, _activeProfileName, ...autofillData } = legacyProfile || {};
  store.profiles[store.activeProfileId] = {
    ...active,
    autofillData,
    savedAnswers: Array.isArray(vault) ? vault : active.savedAnswers,
    coverLetters: Array.isArray(coverLetters) ? coverLetters : active.coverLetters,
  };
  await saveProfileStore(store);
  return store;
}

export async function getActiveLegacyProfile() {
  const store = await loadProfileStore();
  return profileToLegacyUserProfile(store);
}

export async function setActiveProfileId(profileId) {
  const store = await loadProfileStore();
  if (!store.profiles[profileId]) return store;
  store.activeProfileId = profileId;
  await saveProfileStore(store);
  return store;
}

export function profileNameExists(profiles, name, excludeId = null) {
  const normalized = String(name || '').trim().toLowerCase();
  return Object.entries(profiles).some(([id, p]) => {
    if (excludeId && id === excludeId) return false;
    return String(p.name || '').trim().toLowerCase() === normalized;
  });
}

export async function createProfile(name) {
  const store = await loadProfileStore();
  const trimmed = String(name || '').trim().slice(0, MAX_PROFILE_NAME_LENGTH);
  if (!trimmed) throw new Error('Profile name is required.');
  if (profileNameExists(store.profiles, trimmed)) {
    throw new Error('A profile with this name already exists.');
  }

  const id = `profile-${Date.now()}`;
  store.profiles[id] = {
    name: trimmed,
    isDefault: false,
    autofillData: {},
    coverLetters: [],
    savedAnswers: [],
  };
  store.activeProfileId = id;
  await saveProfileStore(store);
  return { store, profileId: id };
}

export async function renameProfile(profileId, newName) {
  const store = await loadProfileStore();
  const profile = store.profiles[profileId];
  if (!profile) throw new Error('Profile not found.');
  const trimmed = String(newName || '').trim().slice(0, MAX_PROFILE_NAME_LENGTH);
  if (!trimmed) throw new Error('Profile name is required.');
  if (profileNameExists(store.profiles, trimmed, profileId)) {
    throw new Error('A profile with this name already exists.');
  }
  profile.name = trimmed;
  await saveProfileStore(store);
  return store;
}

export async function deleteProfile(profileId) {
  const store = await loadProfileStore();
  const profile = store.profiles[profileId];
  if (!profile) throw new Error('Profile not found.');
  if (profile.isDefault || profileId === DEFAULT_PROFILE_ID) {
    throw new Error('The Default profile cannot be deleted.');
  }
  if (Object.keys(store.profiles).length <= 1) {
    throw new Error('Cannot delete the only profile.');
  }

  delete store.profiles[profileId];
  if (store.activeProfileId === profileId) {
    store.activeProfileId = DEFAULT_PROFILE_ID in store.profiles
      ? DEFAULT_PROFILE_ID
      : Object.keys(store.profiles)[0];
  }
  await saveProfileStore(store);
  return store;
}

export async function updateActiveProfileData(patch) {
  const store = await loadProfileStore();
  const active = store.profiles[store.activeProfileId];
  if (!active) return store;

  if (patch.autofillData !== undefined) {
    active.autofillData = patch.autofillData;
  }
  if (patch.savedAnswers !== undefined) {
    active.savedAnswers = patch.savedAnswers;
  }
  if (patch.coverLetters !== undefined) {
    active.coverLetters = patch.coverLetters;
  }
  await saveProfileStore(store);
  return store;
}

export function listProfiles(store) {
  return Object.entries(store.profiles).map(([id, p]) => ({
    id,
    name: p.name,
    isDefault: !!p.isDefault || id === DEFAULT_PROFILE_ID,
  }));
}

/** Export full store for backup — includes profile structure. */
export async function exportProfileData() {
  return loadProfileStore();
}

/** Import from exported file — replaces store when valid. */
export async function importProfileData(data) {
  if (!data?.profiles || typeof data.profiles !== 'object') {
    throw new Error('Invalid profile export format.');
  }
  const activeProfileId = data.activeProfileId || Object.keys(data.profiles)[0];
  const store = { profiles: data.profiles, activeProfileId };
  await saveProfileStore(store);
  return store;
}
