# Extension protocol v2

How the website and the popup talk to the extension's service worker: every
message, who may send it, what it answers, and what store 1.0.2 (the version
most users have) answers instead. Written in B1 from §3 of
`docs/plans/active/completion-plan.md`; B3 added its messages.

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
| `OPEN_COVER_CUSTOMIZER` | content script only, top frame | `{ job: { company, role, description, url } }`, read off the job page | `{ success: true }`: the job is kept for the dashboard, which opens next to the job's tab. `'No job to hand over'`, `'Only from the top frame'`, `'Could not open the dashboard'`. See the handoff below. | 1.0.4 |
| `GET_COVER_HANDOFF` | site only | `{ id }` | `{ success: true, job }`, once: the entry is deleted on read. Unknown, already read or expired: `{ success: false, error: 'This job has expired or was already opened' }`. | 1.0.4 |
| `ONEXTAP_WIPE_LOCAL` | site only | `{}` | `{ success, removed }`: every key in `src/localKeys.js` is removed from `chrome.storage.local`; `removed` names the ones that held something. Capability `wipe-local`. See The wipe. | 1.0.4 |
| `MOUNT_COVER_BUTTON` | popup → content script (`tabs.sendMessage`) | `{}` | `{ success: true, mounted }`: whether the "Customize cover letter" button is on the page now. Never passes through the worker, which answers it "Unknown action". | 1.0.4 |

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

A button on the job page takes the job to the dashboard's Cover Letter
workspace, filled in.

**The button** (`public/content.js`). `content.js` mounts one "Customize
cover letter" button when the popup sends `MOUNT_COVER_BUTTON` (it does on
opening over an http(s) tab) and after `AUTOFILL_TRIGGERED`, if the page is
not the Onextap site itself (an `externally_connectable` origin, where the
button would lead back to the page it is on) and has a cover-letter field:
found by `findCoverLetterField()`, the function
`FILL_COVER_LETTER` fills through, by its keywords only (filling also falls
back to the largest empty textarea; the button does not, or it would sit
under any textarea on any page). The host element is appended to `body`,
never inside the form, and is `position: fixed` with a closed shadow root:
it takes no room in the page and moves nothing, the page's styles and scripts
do not reach it, and every word in it is the extension's own. It sits under
the field's left edge and follows it (scroll, resize, `ResizeObserver`, and a
`MutationObserver` on the field's own `disabled`, `readonly`, `hidden`,
`style` and `class`); it hides while the field is hidden or disabled, while
the field is in the top layer, or while something the page pins in place (a
sticky header, a modal) is where it would go, and it goes when the field does. Mounting again keeps one button, also after an extension reload
left an older copy's host behind. The button is a `<button type="button">`
with an `aria-label` naming Onextap; × hides it until the page loads again.

**The button's known limits.**
- A form in the top layer (a `<dialog>` opened with `showModal()`, an open
  popover, a fullscreen element) gets no button: that layer draws over
  `<body>`, where the host is, and the host is not moved into the page's own
  elements.
- A `transform` or `filter` on `html` or `body` makes `position: fixed`
  relative to the body instead of the viewport, so after a scroll the button
  can sit away from its field.
- It hides wherever a fixed or sticky element that does not contain the field
  covers its spot, a sticky bar inside the same form included.
- A class toggled on one of the field's ancestors that hides it without
  changing its size is noticed at the next scroll or resize.

**The click.** `scrapePageContext()` reads the company and description, the
button's own `scrapeRole()` the role (a job-title heading, else the title;
the worker's `scrapeJobPage()` has no role, so nothing mirrors it), and the
page's address is the `url`. Then `OPEN_COVER_CUSTOMIZER`. A failure shows in
the button's own UI: the page could not be read, the extension was updated
since the page loaded (reload it), or the dashboard did not open.

**The worker** (`extension/messages/openCoverCustomizer.js`) stores
`chrome.storage.session["coverHandoff:<uuid>"] = { job, createdAt }`, which
expires after 30 minutes, and opens
`${DASHBOARD_URL}?view=cover&handoff=<uuid>&extensionId=<runtime id>` next to
the job tab (`index + 1`, its window, the job tab as opener). Session storage
because content scripts cannot read it and it empties when the browser
closes; each new handoff also sweeps the expired ones. The job text is
stripped of markup (with the contents of `script`, `style` and the like),
control and bidirectional-override characters, and capped (company 120, role
160, description 20,000 characters, company and role on one line); `url` must
be http(s), at most 2,048 characters, and loses any credentials. Nothing
leaves the device: job text isn't profile data, there's no new destination,
and the privacy page needs no change (CLAUDE.md rule 8).

**The read** (`extension/messages/getCoverHandoff.js`). `GET_COVER_HANDOFF`
takes an id of `crypto.randomUUID()`'s shape (anything else is refused
without reading storage), deletes the entry on that first read, expired or
not, and gives the job only if it is under 30 minutes old. Two reads at once
get it once. Unknown, used and expired get the same answer.

**The dashboard.** `web/dashboard/js/main.js` moves `handoff` from the
address into the tab's `sessionStorage` (`onextap_cover_handoff`) before the
sign-in check, with `history.replaceState`, so a signed-out visitor goes
through sign-in (which carries the rest of the address as `next`) and comes
back to it; a waiting handoff opens the Cover Letter workspace even without
`?view=cover`. Once the account is confirmed, the workspace
(`web/dashboard/js/ws/cover-letter.js`) takes the id and asks
`GET_COVER_HANDOFF` only when `getExtensionInfo()` says `current` with
`cover-handoff`. It fills company, role and description and says "Filled
from the job page: check it before personalising"; personalising is still
the user's click. Expired or used: "The job page's details have expired",
with what to do. No extension that can answer: it says so, and to paste the
description.

**Top frame only.** `content.js` is injected into the tab's top frame
(`activeTab` with `scripting`, no `allFrames`), so a cover-letter field inside
an iframe gets no button, and the worker refuses `OPEN_COVER_CUSTOMIZER` from
any other frame. That leaves out a form a careers page embeds from its
applicant-tracking system's own site: `activeTab` grants the tab's top origin
only, and reaching the embed would take host permissions for those sites,
which the extension does not ask for (and a permission change is an
escalation, CLAUDE.md).

**Tests.** `test/extension/coverHandoff.test.js`: sanitising, the expiry, the
one-time read, the sender checks, through the registry and through the
worker, and what can be checked of the button's code without a browser.
`web/tests/cover-handoff.spec.js` (`npm run test:e2e:extension`): a job page
with a cover-letter field, the popup, the button, the dashboard filled in,
personalising (stubbed), saving, the version in the popup's Cover tab, and
Fill into the page; the same arrival signed out, through sign-in; and no
button on a page without a cover-letter field, or on the site itself.

## The wipe (B3)

Deleting the account also clears the extension's copy in this browser (the
owner's decision, completion plan D10). Logging out does not: it leaves the
extension alone, as it always has.

**The keys.** `src/localKeys.js` defines every key Onextap writes to
`chrome.storage.local`, once: the stores import their key from it, and
`LOCAL_KEYS` lists them all: the profile store (`onextap_profiles`)
and its `user_profile` mirror, the resume library (`onextap_resumes`), the
settings (`onextap_application_type`, and `src/consent.js`'s two flags, which
nothing writes yet), store 1.0.2's first-run tour flag
(`onextap_tutorial_seen`: its popup wrote it here, nothing in `src/` does
now, and an updated 1.0.2 install may still hold it), and the Supabase
session, `sb-<ref>-auth-token`. The
session key comes from `src/supabaseSessionKey.js`, which
`src/supabaseClient.js` passes as its `storageKey`; its value is supabase-js's
own default, so naming it moved no session. The avatar is not on the list: the
dashboard keeps it in the website's `localStorage`, never in the extension.
`test/extension/localKeys.test.js` runs every store's writes against the list,
and fails when a module in `src/` writes under a key it lacks.

**The worker** (`extension/messages/wipeLocal.js`) removes every key on the
list, leaves anything else in its storage, and replies
`{ success: true, removed }`, `removed` naming the keys that held something.
From the site only; the popup and content scripts are refused. It is the one
message module that imports from `src/`, and only for the key names:
`src/localKeys.js` is a leaf that imports nothing but
`src/supabaseSessionKey.js`, which imports nothing, so no store's code runs in
the worker (`docs/repo-structure.md`, rule 2;
`test/extension/workerImports.test.js`).

**The dashboard** (`deleteAccount()` in `web/dashboard/js/services.js`) sends
it only after `DELETE /api/account` has succeeded, and only to a `current`
extension that reports `wipe-local`; then it clears its own `localStorage` and
signs out, and the page goes home once (the dashboard's `SIGNED_OUT` handler).
The wipe never undoes or blocks the deletion. When it was promised and didn't
happen (no reply within 5 s, `success` not true, or a throw), it is logged and
the dashboard says so before it leaves: an error toast, held about five
seconds, that the account is deleted but the extension couldn't clear its
copy, and that removing the extension clears it. The delete dialog's copy
follows `extensionWipeState()`:

| Extension | The dialog says |
| --- | --- |
| `current` with `wipe-local` | it is cleared too |
| `legacy` (1.0.2), or `current` without it | its copy stays until the extension is removed |
| `absent` | an extension used elsewhere keeps its copy until removed there |

Only `chrome.storage.local` is cleared. Not cleared: a pending cover-letter
handoff in `chrome.storage.session` (job text, not profile data), which
expires on its own; and store 1.0.2's `onextap_dark_mode`, a display setting
(not profile data) that its popup kept in the popup page's own
`localStorage`, which a service worker cannot reach.

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
- `test/extension/coverHandoff.test.js`: the handoff's sanitising, expiry,
  one-time read and sender checks, and static checks on the button in
  `content.js`.
- `test/extension/wipeLocal.test.js` and `test/extension/localKeys.test.js`:
  the wipe, and that its key list covers every key the stores write.
- `test/extension/workerImports.test.js`: the worker reaches into `src/` for
  the key list's two leaf modules only; `content.js` imports nothing.
- `web/tests/extension.spec.js` and `web/tests/cover-handoff.spec.js` (this
  build), and `web/tests/extension-legacy.spec.js` (store 1.0.2, with
  `E2E_LEGACY_EXTENSION_PATH`): `npm run test:e2e:extension`.
