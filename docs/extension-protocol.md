# Extension protocol v2

How the website and the popup talk to the extension's service worker: every
message, who may send it, what it answers, and what store 1.0.2 (the version
most users have) answers instead. Written in B1 from §3 of
`docs/plans/active/completion-plan.md`; B3 adds its messages here.

The worker's side is `extension/messages/` (one module per message, routed by
`registry.js`, senders classified by `senders.js`). The website's and the
popup's side is `src/extensionClient.js`.

## Messages

A message is an object whose kind is in `type` or `action` (either; 1.0.2
reads both too). Every reply is `{ success: true, ... }` or
`{ success: false, error }`.

| Message | From | Payload | Reply | Since |
| --- | --- | --- | --- | --- |
| `ONEXTAP_SYNC_DATA` | site | `{ payload }`: the active profile, flat `user_profile` shape | `{ success }`. Files the payload into `onextap_profiles` as the active profile (`extension/profileSync.js`) and writes the `user_profile` mirror. No object payload: `{ success: false, error: 'No profile payload' }`. | 1.0.2 |
| `PARSE_RESUME` | site (old sites only) | `{ data: { fileData, fileName, fileType, token } }` | `{ success, data, text }`, proxied to `POST /api/parse-resume`; a refusal is `{ success: false, error, debug: { status } }`. Kept because today's production website sends it; nothing new does (see Resume parsing). | 1.0.2 |
| `SCRAPE_ACTIVE_TAB` | site, popup | none | `{ success, context: { company, description } }`, from `scrapeJobPage()` in the active tab; `'Cannot read this page'` for no tab or a page Chrome will not script. | 1.0.2 |
| `GENERATE_IMPROVED_ANSWER` | popup | `{ data: { token, ...body } }` | `{ success, text }`, proxied to `POST /api/answer-vault/generate` with `token` as the bearer header only. | 1.0.2 |
| `ONEXTAP_HELLO` | site, popup | `{}` | `{ success: true, version, protocol: 2, capabilities }`. `version` is the manifest's. | 1.0.4 |
| `OPEN_COVER_CUSTOMIZER` | content script only | `{ job: { company, role, description, url } }` | `{ success }` | 1.0.4, arrives with B3 |
| `GET_COVER_HANDOFF` | site only | `{ id }` | `{ success, job }`, once; the entry is deleted on read | 1.0.4, arrives with B3 |
| `ONEXTAP_WIPE_LOCAL` | site only | `{}` | `{ success, removed }` | 1.0.4, arrives with B3 |
| `MOUNT_COVER_BUTTON` | popup → content script (`tabs.sendMessage`) | `{}` | `{ mounted }`. Never passes through the worker. | 1.0.4, arrives with B3 |

Anything else: `{ success: false, error: 'Unknown action: <kind>' }`, in
1.0.2's words.

A message from a sender its row does not name:
`{ success: false, error: 'Not accepted from this sender: <kind>' }`. It never
starts with "Unknown action", so the website cannot take a current build for
1.0.2.

`ONEXTAP_HELLO` is accepted from the popup as well as the site (§3 lists the
site only): `getExtensionInfo()` is a `src/` module and runs in the popup too,
and the reply is read-only.

## Senders

The worker sorts every sender into one of three kinds
(`extension/messages/senders.js`) before it looks at the message's row:

- **popup**: a page of this extension, on `chrome.runtime.onMessage`, with
  `sender.id === chrome.runtime.id` and `sender.url` under
  `chrome-extension://<id>/`. The popup counts even when it is opened in a tab.
- **content script**: on `chrome.runtime.onMessage`, `sender.id` ours, in a tab
  whose page is not ours.
- **site**: a web page on `chrome.runtime.onMessageExternal`, with no
  `sender.id`, and `sender.origin` (or, without it, `sender.url`'s origin) on
  the build's own allowlist.

Chrome already refuses external messages from origins outside
`externally_connectable.matches`; the worker checks again as defence in depth.
The allowlist is read from the running build's manifest
(`chrome.runtime.getManifest()`), so a release manifest without the localhost
entries narrows it with no code change. Today it is `https://www.onextap.com`,
`https://onextap.com` and `http://localhost:5173`.

Nothing else is accepted: another extension, a page off the list, an internal
sender with another id.

## Capabilities

What `ONEXTAP_HELLO` reports, collected from the registered messages (each
module may name one):

| Capability | Means | Arrives |
| --- | --- | --- |
| `profile-sync` | Dashboard edits reach the popup, also after its first open | B1 (`ONEXTAP_SYNC_DATA` into `onextap_profiles`) |
| `cover-handoff` | The job-page button hands a job to the dashboard's cover-letter workspace | B3 |
| `wipe-local` | Deleting the account can clear the extension's storage | B3 |

## The website's view

`getExtensionInfo()` in `src/extensionClient.js` sends `ONEXTAP_HELLO` and
resolves (never rejects) with `{ state, version, protocol, capabilities }`:

- `current`: `ONEXTAP_HELLO` answered, with `version` and `capabilities`.
- `legacy`: the reply is `success: false` with an error starting "Unknown
  action". That is 1.0.2: a sync reaches its popup only before its first open;
  no handoff, no wipe.
- `absent`: no `chrome.runtime` at all (the website without the extension,
  Node), `chrome.runtime.lastError`, any other reply, or no reply within
  1.5 s. Not installed, or not reachable.

It asks on every call: the extension can be installed or updated while the
page is open.

Never infer "synced" from `ONEXTAP_SYNC_DATA`'s success alone: 1.0.2 always
says success. `syncProfileToExtension()` sends the sync to `current` and to
`legacy` (it still helps a fresh install, whose popup reads `user_profile` on
first open) and not to `absent`, and reports `synced` only for a `current`
extension with `profile-sync` that confirmed it. The dashboard's status after
a save (My Profiles):

| State | Status |
| --- | --- |
| `current`, confirmed | "Saved and synced to the extension" |
| `current`, not confirmed | "Saved here — the extension didn’t confirm the sync" |
| `legacy` | "Saved — the extension is out of date: update it", linking to `CHROME_WEB_STORE_URL` |
| `absent` | "Saved on this device" |

## Extension ID (item 29)

`resolveExtensionId()`:

- On the website outside `localhost` and `127.0.0.1`: always
  `EXTENSION_ID_FALLBACK` (the store build), whatever `?extensionId=` says.
- On `localhost` or `127.0.0.1`: `?extensionId=` wins when it is an extension
  ID (32 letters a–p), for unpacked builds; else the store's.
- Inside the extension (the popup at `chrome-extension://<id>/`): itself,
  `chrome.runtime.id`, and messages go by the one-argument `sendMessage`. Never
  the store's ID: an unpacked popup messaging it would reach a different
  extension.

## Resume parsing (item 31)

`src/resumeParse.js` sends every resume straight to `POST /api/parse-resume`,
on every surface: the website with or without the extension, and the popup
(an extension page with host permissions for the API). The website never
sends `PARSE_RESUME`: 1.0.2's reply to it has `data` but no `text`, so every
upload through it lost the transcription. The worker still answers
`PARSE_RESUME` for the websites already deployed.

## What 1.0.2 does differently

Store 1.0.2's worker (`assets/background.js-*.js`) answers the same four
messages, from any sender on either channel, with these differences:

- `ONEXTAP_SYNC_DATA` writes `user_profile` only and always replies
  `{ success: true }`, so once its popup has opened, a sync no longer reaches
  it.
- `PARSE_RESUME` replies `{ success, data }`, without `text`, and falls back to
  a session in its own storage when the message has no token.
- `GENERATE_IMPROVED_ANSWER` sends only `{ prompt }`.
- `SCRAPE_ACTIVE_TAB` injects `content.js` and asks it (`SCRAPE_CONTEXT`)
  rather than running `scrapeJobPage()`.
- It reads `action` before `type`; this build reads `type` first. No sender
  sends both.

## The cover-letter handoff (B3)

The worker stores
`chrome.storage.session["coverHandoff:<uuid>"] = { job, createdAt }`, which
expires after 30 minutes, and opens
`${DASHBOARD_URL}?view=cover&handoff=<uuid>&extensionId=<runtime id>` next to
the job tab. The job text is stripped of markup and capped (company 120, role
160, description 20,000 characters); `url` must be http(s). Nothing leaves the
device: job text isn't profile data, there's no new destination, and the
privacy page needs no change (CLAUDE.md rule 8).

## The wipe (B3)

One exported list of every key Onextap writes to `chrome.storage.local`
(profiles, `user_profile`, resumes, avatar, settings, the
`sb-*-auth-token` session), built from the stores' own key constants. Accepted
only from the site; the dashboard sends it after `DELETE /api/account`
succeeds.

## Tests

- `test/extension/workerCompat.test.js`: the four 1.0.2 messages' replies,
  through `extension/background.js` itself.
- `test/extension/workerRouting.test.js`: the registry, the sender checks,
  `ONEXTAP_HELLO`, the allowlist.
- `test/extension/extensionClient.test.js`: `resolveExtensionId`,
  `getExtensionInfo` (with and without `chrome.*`, the 1.5 s timeout),
  `syncProfileToExtension`.
- `test/extension/resumeParse.test.js`: parsing through the API on every
  surface; nothing in `src/` or `web/` sends `PARSE_RESUME`.
- `web/tests/extension.spec.js` (this build) and
  `web/tests/extension-legacy.spec.js` (store 1.0.2, with
  `E2E_LEGACY_EXTENSION_PATH`): `npm run test:e2e:extension`.
