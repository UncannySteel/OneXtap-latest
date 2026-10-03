// Dashboard → extension profile sync: filing an ONEXTAP_SYNC_DATA payload into
// the extension's profile store.
//
// ═══ WHY THE MIRROR ALONE WAS NOT ENOUGH ═══
//
// The popup reads profiles from the profile store, `onextap_profiles`, through
// src/profileStore.js. `user_profile` is only a flat mirror of that store's
// active profile, and profileStore reads it once: to seed the store the first
// time the popup opens. The worker used to write the payload to the mirror and
// nothing else, so once the popup had opened a single time, a profile saved on
// the web dashboard never reached autofill, while the dashboard said "Saved
// and synced".
//
// So the payload (the dashboard's active profile, in the mirror's flat shape)
// is filed into the store as well, becomes the active profile there, and the
// mirror is rebuilt from the store. The extension's other profiles are left
// as they are.
//
// Which profile it is filed under: the same id if the extension has it (the
// Default profile is 'default' on both sides), else a profile with the same
// name (one made separately on each side), else a new one under the
// dashboard's id.
//
// Pure: it takes what is stored and returns what to store; background.js does
// the chrome.storage calls. The worker cannot import src/
// (docs/repo-structure.md, rule 2), so the store's shape is restated here from
// profileStore.js, and a change to that shape belongs here too.
// test/extension/profileSync.test.js reads the result back through
// profileStore.js to hold the two together.

const DEFAULT_PROFILE_ID = 'default';

/**
 * @param {unknown} stored The current `onextap_profiles` value; anything
 *   without a `profiles` object (unset, junk) counts as no store yet.
 * @param {Record<string, unknown>} payload The dashboard's active profile in
 *   the flat `user_profile` shape: autofill fields plus `vault`,
 *   `coverLetters`, `_activeProfileId` and `_activeProfileName`.
 * @returns {{ onextap_profiles: { profiles: Record<string, object>, activeProfileId: string },
 *   user_profile: Record<string, unknown> }} Both keys, to be written together.
 */
export function fileSyncedProfile(stored, payload) {
  const { vault, coverLetters, _activeProfileId, _activeProfileName, ...autofillData } = payload;
  const profiles = stored && typeof stored === 'object' && stored.profiles && typeof stored.profiles === 'object'
    ? { ...stored.profiles }
    : {};

  const name = typeof _activeProfileName === 'string' ? _activeProfileName.trim() : '';
  const hasName = (id) => !!name && String(profiles[id]?.name || '').trim().toLowerCase() === name.toLowerCase();
  const dashboardId = typeof _activeProfileId === 'string' && _activeProfileId ? _activeProfileId : null;
  const id = (dashboardId && profiles[dashboardId] ? dashboardId : null)
    || Object.keys(profiles).find(hasName)
    || dashboardId
    || DEFAULT_PROFILE_ID;

  const existing = profiles[id] || {};
  // A rename on the dashboard carries over, unless another profile here
  // already has the name: profile names are unique within a store.
  const nameTaken = Object.keys(profiles).some((other) => other !== id && hasName(other));
  profiles[id] = {
    ...existing,
    name: (name && !nameTaken ? name : existing.name) || 'Default',
    isDefault: typeof existing.isDefault === 'boolean' ? existing.isDefault : id === DEFAULT_PROFILE_ID,
    autofillData,
    savedAnswers: Array.isArray(vault) ? vault : (existing.savedAnswers || []),
    coverLetters: Array.isArray(coverLetters) ? coverLetters : (existing.coverLetters || []),
  };

  const active = profiles[id];
  return {
    onextap_profiles: { profiles, activeProfileId: id },
    // As profileToLegacyUserProfile() in src/profileStore.js builds it.
    user_profile: {
      ...active.autofillData,
      vault: active.savedAnswers,
      coverLetters: active.coverLetters,
      _activeProfileId: id,
      _activeProfileName: active.name,
    },
  };
}
