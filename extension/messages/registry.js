// Every message the service worker answers, and the one place it routes them.
// The contract is docs/extension-protocol.md.
//
// One module per message, each a plain object:
//   kind        the message's name, sent as `type` or `action` (both, as 1.0.2)
//   from        who may send it: 'site', 'popup', 'content' (./senders.js)
//   capability  optional: what ONEXTAP_HELLO reports this build can do
//   handle(msg, context) → the reply, { success: true, ... } or
//               { success: false, error }
//
// A new message is a module and a line in MESSAGES. (B3 adds
// OPEN_COVER_CUSTOMIZER, GET_COVER_HANDOFF and ONEXTAP_WIPE_LOCAL here;
// MOUNT_COVER_BUTTON goes from the popup to the content script and never
// passes through the worker.)

import { senderKind } from './senders.js';
import syncData from './syncData.js';
import parseResume from './parseResume.js';
import scrapeActiveTab from './scrapeActiveTab.js';
import generateImprovedAnswer from './generateImprovedAnswer.js';
import hello from './hello.js';

export const MESSAGES = [
  // 1.0.2's four. Today's production website sends the first three, so their
  // replies stay as they are (test/extension/workerCompat.test.js).
  syncData,
  parseResume,
  scrapeActiveTab,
  generateImprovedAnswer,
  // Protocol 2.
  hello,
];

const BY_KIND = new Map(MESSAGES.map((m) => [m.kind, m]));

/** What ONEXTAP_HELLO reports: the capabilities of the registered messages. */
export const CAPABILITIES = Object.freeze([...new Set(MESSAGES.map((m) => m.capability).filter(Boolean))]);

/** The message's kind: `type` or `action`, whichever it carries. */
export const kindOf = (msg) => (msg && typeof msg === 'object' ? msg.type || msg.action : undefined);

/**
 * Answer one message. Never rejects: every outcome is a reply.
 *
 * @param {unknown} msg As received.
 * @param {chrome.runtime.MessageSender} sender
 * @param {'internal'|'external'} channel onMessage or onMessageExternal.
 * @param {{ runtimeId: string, origins: object[], log: object }} context
 *   Everything a handler needs (chrome, fetch, apiUrl, log, scrapeJobPage),
 *   plus what the sender check reads; background.js builds it once.
 * @returns {Promise<object>}
 */
export async function dispatch(msg, sender, channel, context) {
  const kind = kindOf(msg);
  const { log } = context;
  try {
    const message = BY_KIND.get(kind);
    if (!message) {
      log.warn('unknown message kind', { kind });
      // 1.0.2's words. The website reads "Unknown action" in reply to
      // ONEXTAP_HELLO as a 1.0.2 install; a current build never sends it for
      // a message it knows.
      return { success: false, error: `Unknown action: ${kind}` };
    }

    const from = senderKind(sender, channel, context);
    if (!from || !message.from.includes(from)) {
      log.warn('message refused from this sender', { kind, channel, sender: from || 'unrecognised' });
      return { success: false, error: `Not accepted from this sender: ${kind}` };
    }

    return await message.handle(msg, { ...context, capabilities: CAPABILITIES });
  } catch (err) {
    // Safety net — never let an exception escape without a response
    log.error('unhandled error in message handler', err, { kind });
    return { success: false, error: err?.message || 'Unexpected error' };
  }
}
