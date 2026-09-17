# Onextap — Application Flows

Every user-facing path through the product, traced to the code that runs it.
Describes the system at commit `9b01adb` (2026-09-09).

**Related:** [`prd.md`](prd.md) · [`trd.md`](trd.md) ·
[`ui-ux-design.md`](ui-ux-design.md) · [`backend-schema.md`](backend-schema.md)

---

## 0. Entry points

The same React app (`src/popup.jsx` → `OnextapDashboard.jsx`, the `App` root) boots into one
of four states, decided at load:

| Condition | View | Notes |
|---|---|---|
| `?mode=extension-bridge` | `ExtensionBridge` | Renders nothing; postMessage RPC. **No caller in this repo.** |
| `chrome.runtime.id` present, no `?mode=dashboard` | `PopupView` | Forces a 400×600 document |
| Otherwise, signed out | `PublicLandingPage` | Marketing + auth section |
| Otherwise, signed in | `DashboardView` | Sidebar shell, full width |

`?view=vault` / `?view=cover` deep-links the dashboard to a tab.
`?extensionId=<id>` tells the dashboard which extension to message.
A splash screen shows for 2s on dashboard boot only.

---

## 1. First run

```text
Install from Chrome Web Store
        │
        ▼
Click the toolbar icon ──► PopupView, checking = true
        │
        ├─ loadProfileStore()          (migrates legacy user_profile if present)
        ├─ getActiveLegacyProfile()
        └─ hasProfile = firstName || email || vault.length
                │
        ┌───────┴────────┐
        │                │
     false            true
        │                │
        ▼                ▼
 "Open Dashboard"   Full popup (tabs, autofill)
   empty state
        │
        ▼
 chrome.tabs.create(DASHBOARD_URL + ?extensionId=<runtime.id>)
```

The popup deliberately refuses to be a profile editor. With no profile it
shows one route out: open the dashboard.

---

## 2. Sign-up and sign-in

```text
Landing page ──► #auth section ──► [Sign in | Create account]
        │
        ├─ Email + password
        │   └─ signup: getPasswordStrength() must not be 'weak'
        │      (≥8 chars, upper + lower + number; 'strong' at ≥12 with a symbol)
        │          │
        │          ▼
        │      supabase.auth.signUp({ data: { full_name } })
        │          │
        │          ├─ session returned ──► signed in
        │          └─ null session      ──► "Check your email for a confirmation link."
        │
        └─ Google
            ├─ web:       supabase.auth.signInWithOAuth  (redirect)
            └─ extension: signInWithOAuth → skipBrowserRedirect
                          → chrome.identity.launchWebAuthFlow
                          → parse access_token/refresh_token from the URL hash
                          → supabase.auth.setSession(...)
```

**On the database side**, `on_auth_user_created` fires and inserts a
`profiles` row with 3 credits plus an `initial` credit transaction. If that
trigger is missing, `getProfile()` backfills the row on first API call.

**Session storage** differs by surface: `localStorage` on the web,
`chrome.storage.local` in the extension via the adapter in
`supabaseClient.js`.

**After sign-in:**

- `onAuthStateChange` sets the user and stops the auth spinner (a 5s fallback
  timer guarantees the UI never blocks on it).
- A lazy, non-blocking `verifyPremium()` runs once, keyed on `user.id`.
- The guided tour fires only for accounts created in the **last 2 minutes**
  and only if `onextap_tutorial_seen` is unset. Older accounts get the flag
  set silently so it never appears.

**Sign-out** clears `user_profile` and `onextap_profiles` from both storage
backends and remounts the content.

---

## 3. Building a profile

### 3.1 By hand

```text
Dashboard ──► My Profiles ──► edit fields ──► Save
                                                │
                                    saveLegacyUserProfile(profile)
                                                │
                                    ┌───────────┴───────────┐
                                    ▼                       ▼
                          storage (local)      ONEXTAP_SYNC_DATA → extension
                                                            │
                                              ┌─────────────┴─────────────┐
                                          success                     failure
                                              │                         │
                                     "Saved & Synced!"          "Saved (sync failed)"
```

A failed sync is reported, never fatal — the local write already succeeded.

### 3.2 From a resume

```text
Choose file (PDF or image)
    │
    ├─ fileToBase64()
    ├─ getAccessToken()  ──► null → "Not authenticated. Please sign in first."
    ├─ GET /api/me       ──► !ok  → "Session token rejected… sign out and back in."
    ├─ chrome.runtime available? ──► no → "Extension not installed"
    ├─ getExtensionId()          ──► null → "Open the dashboard from the popup"
    │
    ▼
PARSE_RESUME ──► service worker ──► POST /api/parse-resume
                                            │
                                     Gemini flash → (fallback) pro
                                            │
                                     parseJsonLenient()
                                            │
                                     fails? one repair pass at temp 0
                                            │
                                            ▼
                                     { data: <structured> }
    │
    ▼
Merge over the existing profile — never replace:
  • scalar fields only when the model found something
  • education/experience only when non-empty
  • skills unioned via Set
  • address deep-merged; country match sets the dial code
```

The pre-flight to `/api/me` is there so an expired token fails in a second
rather than after a 90-second upload.

### 3.3 Switching profiles

`ProfileSwitcher` (dashboard sidebar and popup header) creates, renames,
deletes and switches. Every mutation writes the store *and* re-mirrors the
active profile into `user_profile`, so the content script always reads the
one the user last selected.

Guards: unique trimmed names (case-insensitive, ≤32 chars); `Default` and the
last remaining profile cannot be deleted; deleting the active profile falls
back to `Default`.

---

## 4. Autofill — the core flow

```text
User opens an application form, clicks the Onextap icon
        │
        ▼
PopupView mounts
        ├─ getApplicationType()
        ├─ loadProfileStore() + refreshProfileState()
        └─ detectSectionsOnPage()
                ├─ chrome.scripting.executeScript({ files: ['content.js'] })
                └─ DETECT_SECTIONS ──► { personalInfo, education,
                                          workExperience, openEnded, coverLetter }
                        │
                        ▼
        "What to fill" shows toggles for detected sections only
        (coverLetter also requires ≥1 saved template)
        │
        ▼
Click "Autofill Application"
        ├─ getActiveLegacyProfile()  ──► null → "No Profile - Open Dashboard"
        ├─ inject content.js         ──► throws → "Error: Cannot access this page"
        │
        ▼
AUTOFILL_TRIGGERED { profile, sections }
        │
        ▼  public/content.js → autofill()
   buildIntents(profile)         ordered, specific before generic
        │
   for each input / textarea / select:
        skip: wrong input type · invisible · disabled · readonly · already filled
        sig = name + id + placeholder + aria-label + autocomplete + label text
        first matching intent wins
        SELECT → fillSelect (exact value → exact text → substring)
        else   → setNativeValue + dispatch input & change
        │
        ▼
   { success: true, filled: N }  ──►  "Filled N fields"  (resets after 2s)
```

**Ordering rules that make matching work:** `first name` before `full name`;
`phone number` before `phone`; `address line 1` before generic address;
`postal code` before `country`; `current company` / `employer name` before
bare `company`. Bare `name` is deliberately never an intent keyword — it
would hit company-name and school-name fields.

**Known gap:** `sections` is sent but `autofill()` ignores it. Toggling a
section off changes the button label only; every matching field is still
filled.

### Refusals

| Condition | Message |
|---|---|
| `chrome:`, `chrome-extension:`, `edge:`, `about:`, Web Store | "Cannot read this page" (scrape) / "Cannot access this page" (fill) |
| No active tab | "Error: No active tab" |
| No profile | "No Profile - Open Dashboard" |
| Every section toggled off | Button disabled, tooltip "Select at least one section to fill." |

---

## 5. Answer Studio

```text
Dashboard ──► Answer Studio  (or popup ──► "Open Answer Studio" ──► ?view=vault)
        │
        ├─ load profile + vault (aiImprovementsLeft normalised to a number)
        └─ loadCredits(): isPremium() then getCreditsWithStatus()
        │
        ▼
Type a question (+ optional draft), pick a tone, click "Improve with AI"
        │
   ┌────┴─────────────────────────────────────────────┐
   │ Pre-checks                                        │
   │  • question empty        → "Enter a question first."│
   │  • consumesCredit = !premium && improvementsLeft≤0 │
   │  • consumesCredit && credits ≤ 0 → "No credits remaining."│
   └────┬─────────────────────────────────────────────┘
        ▼
SCRAPE_ACTIVE_TAB (10s timeout) ──► { company, description }
        │  pasted text, when present, wins over the scrape
        ▼
Build the request:
   question · draft · jobContext (6000 chars) · profileContext
   · top-3 overlapping vault answers · taskHint · styleHint · model
        │
        ▼
POST /api/answer-vault/generate  (90s timeout)
        │
   Groq primary ──(404/429/5xx/empty/blocked)──► Groq fallback
        │
   server rejects: empty · <8 non-space chars · finish_reason === 'length'
        │
   ┌────┴────┐
 fail      success
   │          │
 no charge    ├─ answer replaces the editor text
              │
              ├─ premium? ─ yes → done, no counter
              │
              └─ no ──┬─ consumesCredit → deductCredit() (10s)
                      │      ok   → credits = remaining, improvements = 3
                      │      fail → improvements = 0 + a warning; answer kept
                      │
                      └─ else → improvements -= 1
                      │
                      └─ persist answer + counter to the active vault item
```

**Context messaging.** No job context: "Generated without job-page context.
Open a job listing and click Improve again to tailor it." Pasted description:
"Generated using pasted job description context."

**Credit model in one line:** one credit buys one generation plus three
follow-up improvements on that same answer.

**Saving** de-duplicates against existing questions *and* answers
(case-insensitive) when adding new; editing an existing entry updates in
place. Every save writes the store and re-syncs to the extension.

---

## 6. Cover letters

```text
Add template (name + body)          max 10 per profile
        │
        ▼
Select template ──► "Personalize"
        │
        ├─ no template body → "Add a cover letter template first."
        ├─ not signed in    → "Sign in to use AI personalization."
        │
        ▼
SCRAPE_ACTIVE_TAB (scrape wins over the typed company/role when present)
        │
        └─ still no description → "Open an application page or paste a description below."
        │
        ▼
POST /api/answer-vault/generate
   question: "<Document label> for this application"
   draft:    the template body
   taskHint: rewrite for this opportunity, preserve voice,
             name the organisation, weave in 2–4 requirements,
             stay within ±10% of the original length
        │
        ▼
Suggestion shown beside the original
        │
        ├─ Copy
        ├─ Save as variant  → { company, role, jdSnippet(500), body, createdAt }
        └─ Fill into page   → FILL_COVER_LETTER
                                │
                       keyword pass over visible textareas / text inputs
                       (cover letter · personal statement · statement of
                        purpose · motivation · essay · additional information)
                                │  overwrites existing content
                       fallback: largest empty textarea by rows
                                │
                       none matched → { success: false }
```

Personalising stamps `lastUsed` on the template. Cover-letter generation does
**not** consume a credit today — it calls the generation endpoint directly
without a deduct.

---

## 7. Upgrade to Premium

```text
Upgrade button (landing pricing · overview · account modal · out-of-credits toast)
        │
        ▼
PremiumModal — $5.00/month
        │
        ▼
POST /api/create-checkout-session
        ├─ already active at Dodo → 400 "You already have an active Premium subscription."
        └─ create session with metadata.supabaseUserId
        │
        ▼
window.location.href = session.checkout_url     (the app unmounts here)
        │
        ▼
Dodo hosted checkout ──► return_url = CLIENT_URL?payment=success
        │
        ├── in parallel ──► Dodo webhook ──► POST /api/webhook
        │                        signature verified over the raw body
        │                        resolveUserId: metadata → dodo_customer_id → email
        │                        subscription.active → is_premium = true, premium_since = now
        ▼
Dashboard sees ?payment=success
        ├─ strips payment/session_id/payment_id/status/email/license_key from the URL
        ├─ toast: "Payment received! Activating your Premium subscription..."
        └─ poll verifyPremium() every 8s, up to 15 attempts (2 minutes)
                ├─ premium → "Premium activated! You now have unlimited AI credits."
                └─ timeout → "Premium may take a moment to activate — please refresh shortly."

?payment=cancelled → "Payment cancelled."
```

### Webhook events handled

| Event | Effect on `profiles` |
|---|---|
| `subscription.active` | `is_premium = true`, subscription + customer ids, `status = active`, `premium_since = now()` |
| `subscription.renewed` | `is_premium = true`, `status = active` |
| `subscription.on_hold` | `status = on_hold`, `payment_failed = true`, `last_failed_payment = now()` |
| `subscription.cancelled` | `is_premium = false`, `status = cancelled`, `cancelled_at = now()` |
| `subscription.failed` | `is_premium = false`, `status = failed` |
| `payment.failed` | `payment_failed = true`, `last_failed_payment = now()` |

Unresolvable users are logged and skipped — the webhook still returns
`{ received: true }` so Dodo does not retry forever.

### Cancellation

Account Settings → Cancel subscription → `POST /api/cancel-subscription` →
Dodo `subscriptions.update(status: 'cancelled')` → local `is_premium = false`,
`status = cancelled`, `cancelled_at = now()`. Immediate; no proration.

---

## 8. Account settings

```text
Avatar / Settings ──► AccountSettingsModal
        ├─ verifyPremium() + getCreditsWithStatus()
        ├─ Credits: number, or ∞ for premium, or an inline error with "Try again"
        ├─ Subscription: upgrade, or cancel
        └─ Danger zone: type DELETE
                └─ clears local storage, signs out, reloads
                   ⚠ does NOT delete the Supabase auth user or profiles row
```

---

## 9. Application types

Selecting a type (popup header or dashboard sidebar) persists to
`onextap_application_type` and immediately:

| Type | Cover-letter label | Studio label |
|---|---|---|
| Job | Cover Letter | Answer Studio |
| College / University | Personal Statement | Application Essays |
| Scholarship | Scholarship Essay | Essay Answers |
| Internship | Cover Letter | Answer Studio |

If the active tab is not enabled for the new type, the view falls back to
Overview (dashboard) or the first allowed tab (popup). Every type currently
enables every feature, so this fallback is dormant.

---

## 10. Error and recovery paths

| Where | Trigger | What the user sees |
|---|---|---|
| Any React render | Thrown error | `ErrorBoundary` recovery screen with "Copy diagnostics" |
| Credits panel | `/api/credits` fails | Inline amber block, the underlying error, config hints, "Try again" |
| Answer Studio | Generation fails | Inline error; no credit spent |
| Answer Studio | Generation succeeds but deduct fails | Answer kept, warning shown, improvements set to 0 |
| Resume upload | Any pre-flight failure | A specific status string naming the cause |
| Popup autofill | Restricted page | "Error: Cannot access this page" |
| Extension sync | Worker unreachable | "Saved (sync to extension failed)" — local data is safe |
| Server 500 | Unhandled route error | `errorLogger` responds; `X-Request-Id` ties the report to the log |

---

## 11. State that persists

| Key | Backend | Contents |
|---|---|---|
| `onextap_profiles` | local | `{ profiles: { id: { name, isDefault, autofillData, coverLetters, savedAnswers } }, activeProfileId }` |
| `user_profile` | local | Flat mirror of the active profile — what the content script reads |
| `onextap_application_type` | local | `job` / `college` / `scholarship` / `internship` |
| `onextap_tutorial_seen` | local | Guided-tour suppression |
| `onextap_dark_mode` | `localStorage` | Theme, defaulting to `prefers-color-scheme` |
| Supabase session | `chrome.storage.local` (ext) / `localStorage` (web) | JWT + refresh token |
| `profiles` row | Postgres | Account, credits, premium and Dodo ids — **never profile content** |
