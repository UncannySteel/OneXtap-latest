// Who sent a message, in the three kinds docs/extension-protocol.md names:
//
//   'popup'   a page of this extension: the popup, also when it is opened in a
//             tab (the e2e suite does that). Internal: chrome.runtime.onMessage,
//             sender.id is ours and sender.url is under chrome-extension://<id>/.
//   'content' this extension's content script in a web page. Internal, sender.id
//             is ours, and the sender has a tab whose page is not ours.
//   'site'    a web page on an externally_connectable origin. External:
//             chrome.runtime.onMessageExternal, no sender.id, and sender.origin
//             in the build's own allowlist.
//
// Chrome already refuses external messages from origins outside
// `externally_connectable.matches`; checking the origin again here is defence
// in depth. The allowlist is read from the manifest at run time, so a release
// build whose manifest drops the localhost entries narrows it with no change
// here.
//
// Pure: no chrome.* calls. background.js passes the runtime id and the
// manifest's origins in.

/**
 * One `externally_connectable.matches` pattern, parsed down to what decides
 * an origin: scheme, host and port (the path never does).
 * @param {string} pattern e.g. 'https://www.onextap.com/*', 'http://localhost:5173/*'
 * @returns {{ schemes: string[], host: string, anySubdomain: boolean, port: string|null }|null}
 */
function parseMatch(pattern) {
  const m = /^(\*|https?):\/\/(\*|(?:\*\.)?[^/:*]+)(?::(\d+))?\//i.exec(String(pattern || ''));
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const anySubdomain = m[2].startsWith('*.');
  return {
    schemes: scheme === '*' ? ['http', 'https'] : [scheme],
    host: (anySubdomain ? m[2].slice(2) : m[2]).toLowerCase(),
    anySubdomain,
    // A pattern without a port matches any port, as Chrome reads it.
    port: m[3] ?? null,
  };
}

/**
 * The origins this build accepts external messages from.
 * @param {object} manifest chrome.runtime.getManifest()
 * @returns {ReturnType<typeof parseMatch>[]}
 */
export function allowedOrigins(manifest) {
  const matches = manifest?.externally_connectable?.matches;
  return (Array.isArray(matches) ? matches : []).map(parseMatch).filter(Boolean);
}

/**
 * @param {string} origin e.g. 'https://www.onextap.com'
 * @param {ReturnType<typeof allowedOrigins>} origins
 */
export function isAllowedOrigin(origin, origins) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const scheme = url.protocol.replace(/:$/, '');
  const host = url.hostname.toLowerCase();
  return origins.some((o) => o.schemes.includes(scheme)
    && (o.host === '*' || host === o.host || (o.anySubdomain && host.endsWith(`.${o.host}`)))
    && (o.port === null || url.port === o.port));
}

/**
 * @param {chrome.runtime.MessageSender} sender
 * @param {'internal'|'external'} channel onMessage or onMessageExternal
 * @param {{ runtimeId: string, origins: ReturnType<typeof allowedOrigins> }} self
 * @returns {'popup'|'content'|'site'|null} null: not a sender this build knows.
 */
export function senderKind(sender, channel, { runtimeId, origins }) {
  if (!sender || typeof sender !== 'object') return null;

  if (channel === 'internal') {
    if (!runtimeId || sender.id !== runtimeId) return null;
    if (typeof sender.url === 'string' && sender.url.startsWith(`chrome-extension://${runtimeId}/`)) return 'popup';
    return sender.tab ? 'content' : null;
  }

  if (channel === 'external') {
    // Another extension; the manifest lets none connect.
    if (sender.id) return null;
    let origin = sender.origin;
    if (!origin && typeof sender.url === 'string') {
      try {
        origin = new URL(sender.url).origin;
      } catch {
        origin = null;
      }
    }
    return origin && isAllowedOrigin(origin, origins) ? 'site' : null;
  }

  return null;
}
