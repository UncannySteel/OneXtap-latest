// ONEXTAP_SYNC_DATA { payload } → { success }
//
// The dashboard pushes its active profile here after a save. Since 1.0.2.
// 1.0.2 wrote the payload to `user_profile` only and always said success, so
// the website never reads "synced" from this reply alone (it asks
// ONEXTAP_HELLO for `profile-sync` first).

import { fileSyncedProfile } from '../profileSync.js';

export default {
  kind: 'ONEXTAP_SYNC_DATA',
  from: ['site'],
  // Dashboard edits reach the popup, even after its first open.
  capability: 'profile-sync',

  async handle(msg, { chrome }) {
    const payload = msg.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { success: false, error: 'No profile payload' };
    }
    // Into the profile store the popup reads, not only the user_profile
    // mirror, which it ignores once the store exists: see profileSync.js.
    const { onextap_profiles: stored } = await chrome.storage.local.get('onextap_profiles');
    await chrome.storage.local.set(fileSyncedProfile(stored, payload));
    return { success: true };
  },
};
