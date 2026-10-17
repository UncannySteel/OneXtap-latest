// GET_COVER_HANDOFF { id } → { success: true, job } | { success: false, error }
//
// The dashboard's half of the cover-letter handoff: the job the page button
// left with OPEN_COVER_CUSTOMIZER (./openCoverCustomizer.js), read once. The
// entry is deleted on that read, expired or not, so a link with the id in it
// is good for one prefill. New in protocol 2.
//
// From the site only. The dashboard asks only an extension whose
// ONEXTAP_HELLO lists `cover-handoff`.

import { HANDOFF_PREFIX, isExpired, sanitiseJob } from './openCoverCustomizer.js';

/** crypto.randomUUID()'s shape. Anything else names no handoff. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// One answer for "never was", "already read" and "too old": the dashboard says
// the same thing to all three, and the site learns nothing about the others.
const GONE = 'This job has expired or was already opened';

// The ids being read right now. Between the read and the delete, a second
// request for the same id would get the job too; this makes it the second.
const reading = new Set();

export default {
  kind: 'GET_COVER_HANDOFF',
  from: ['site'],
  capability: 'cover-handoff',

  async handle(msg, { chrome }) {
    const id = typeof msg.id === 'string' ? msg.id.trim().toLowerCase() : '';
    if (!UUID.test(id) || reading.has(id)) return { success: false, error: GONE };

    reading.add(id);
    try {
      const key = `${HANDOFF_PREFIX}${id}`;
      const session = chrome.storage.session;
      const { [key]: entry } = await session.get(key);
      if (entry === undefined) return { success: false, error: GONE };
      await session.remove(key);
      if (isExpired(entry, Date.now())) return { success: false, error: GONE };
      // Kept sanitised; sanitised again, in case anything else wrote the key.
      const job = sanitiseJob(entry.job);
      return job ? { success: true, job } : { success: false, error: GONE };
    } finally {
      reading.delete(id);
    }
  },
};
