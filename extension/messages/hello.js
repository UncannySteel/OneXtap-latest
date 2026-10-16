// ONEXTAP_HELLO {} → { success: true, version, protocol: 2, capabilities }
//
// The handshake: getExtensionInfo() in src/extensionClient.js sends it to
// tell a current extension from 1.0.2 (which answers "Unknown action") and
// from none at all. New in protocol 2.
//
// Also accepted from the popup, beyond the site: getExtensionInfo() is a src/
// module and runs there too, and this reply is read-only.

/** The protocol this build speaks; docs/extension-protocol.md. */
export const PROTOCOL = 2;

export default {
  kind: 'ONEXTAP_HELLO',
  from: ['site', 'popup'],

  async handle(_msg, { chrome, capabilities }) {
    return {
      success: true,
      version: chrome.runtime.getManifest().version,
      protocol: PROTOCOL,
      capabilities: [...capabilities],
    };
  },
};
