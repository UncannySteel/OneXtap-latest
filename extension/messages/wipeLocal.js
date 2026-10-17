// ONEXTAP_WIPE_LOCAL {} → { success, removed }
//
// The dashboard sends it once DELETE /api/account has succeeded: the account
// is gone, so this browser's extension drops its copy too (the owner's
// decision, completion plan D10). Every key Onextap writes to
// chrome.storage.local goes, from the one list in src/localKeys.js; anything
// else in the extension's storage stays. `removed` names the keys that held
// something. New in protocol 2; store 1.0.2 answers "Unknown action", and the
// dashboard tells the user its copy stays.
//
// The site only: no page of the extension, and no content script, has any
// business clearing it. Logging out does not send it (signing out leaves the
// extension's copy alone, as it always has).
//
// The one message that reaches into src/, for key names only: src/localKeys.js
// defines them for the stores and for this list, and imports nothing but
// src/supabaseSessionKey.js (docs/repo-structure.md, rule 2;
// test/extension/workerImports.test.js).

import { LOCAL_KEYS } from '../../src/localKeys.js';

export default {
  kind: 'ONEXTAP_WIPE_LOCAL',
  from: ['site'],
  // Deleting the account can clear the extension's storage.
  capability: 'wipe-local',

  async handle(_msg, { chrome, log }) {
    const keys = [...LOCAL_KEYS];
    const held = await chrome.storage.local.get(keys);
    const removed = keys.filter((key) => Object.prototype.hasOwnProperty.call(held, key));
    await chrome.storage.local.remove(keys);
    // Key names only, and only how many: what they held is the user's.
    log.info('local data wiped after the account was deleted', { count: removed.length });
    return { success: true, removed };
  },
};
