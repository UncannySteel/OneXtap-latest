# Onextap — Campaign Concept Deck: Content

Copy for `Campaign-Concept.pptx`. Your template has 6 slides; this is 15,
because four topics (ATS mechanics, problems, all features, competitive
comparison) don't compress into six. Slides marked **[T#]** map onto an
existing template slide; the rest are new and need a duplicated layout.

Every product claim here is traceable to the repo. Three things I deliberately
did **not** write — see "Claims to avoid" at the bottom before you present this.

---

## Slide 1 — Title **[T1]**

> **Title:** Onextap
>
> **Subtitle:** The application layer between you and every hiring system.
>
> **Footer:** ONEXTAP · 2026

**Alternate subtitles**, pick by audience:

- *Investor / partner:* "One click between a job posting and a finished application."
- *User-facing:* "Stop retyping your life into every job form."
- *Technical:* "Local-first autofill, grounded AI, and honest job matching."

**Speaker note:** Don't open with the product. Open with the question the next
two slides answer: *why does applying to 50 jobs take 50 hours when the
information never changes?*

---

## Slide 2 — How ATS Works: The Pipeline **[T2]**

> **Title:** How does an ATS actually work?
>
> **Standfirst:** An Applicant Tracking System is not a reader. It's a database
> with a form bolted to the front. Understanding the difference explains every
> frustrating thing about applying for a job.

**Six stages, one row each** (template slide 2 has room for a diagram — this is
the diagram):

| # | Stage | What actually happens |
|---|---|---|
| 1 | **Requisition → schema** | The company opens a role. The ATS generates the application form from that record. Every question is a typed database column — string, enum, date, boolean, file blob. Your application is a row. |
| 2 | **Parse** | You upload a PDF. A resume parser converts it to structured fields. It reads the PDF's *text layer in document order* — not in the visual order you designed. |
| 3 | **Confirm** | The form makes you re-enter everything it just parsed. This is not redundancy. It's the parser's error-correction layer, pushed onto you. |
| 4 | **Knockout** | Structured questions applied as hard filters *before* a human sees anything: work authorization, sponsorship, location, years of experience, degree, salary. |
| 5 | **Index & search** | Your row is tokenised into a searchable index. Recruiters query it with boolean searches. Matching is token-level. |
| 6 | **Rank & review** | A recruiter opens a filtered, ranked list. Your application competes for seconds of attention. |

**Speaker note:** Stage 3 is the one the room will react to. Say it plainly:
*the reason you upload a resume and then type the same resume in again is that
the vendor knows their parser is unreliable, and making you fix it is cheaper
than making it better.*

---

## Slide 3 — How ATS Works: Where Applications Die *(new)*

> **Title:** Three failure modes, none of them mysterious

**Block 1 — The parse is lossy**

Resume parsers read a PDF's text layer sequentially. That breaks on:

- **Two-column layouts** — the parser interleaves your skills column into your
  experience column, sentence by sentence.
- **Tables and text boxes** — collapse into unreadable runs, or vanish.
- **Text inside graphics** — a skills chart is an image. There is no text to read.
- **Scanned PDFs** — no text layer at all. Without OCR, the parser sees an empty document.
- **Non-standard headings** — "My Journey" instead of "Experience" means the
  parser never binds those dates to employment records.
- **Creative date formats** — "Summer '24 – present" doesn't parse as a date range.

Result: your skills exist in the file and don't exist in the database.

**Block 2 — Knockouts are absolute**

Knockout questions are enums and booleans. There is no fuzzy matching and no
benefit of the doubt. "5 years" when the field wants 6 is a rejection with no
human in the loop. This is where most applications actually end.

**Block 3 — You're not in the result set**

Recruiters find candidates by searching the index. Token-level matching means:

- `K8s` does not match `Kubernetes` — not without a synonym dictionary the
  company had to configure.
- `Led a team of 6` does not match a search for `leadership`.
- A skill the parser filed under "Education" is not found by a skills search.

You were never rejected. You were never retrieved.

> **Pull quote for the slide:**
> "The robot didn't reject you. It never found you."

**Speaker note — say this, it makes the deck credible:** The popular story is
"an AI scored my resume 62% and binned it." That's mostly wrong. Most ATS don't
auto-reject on a match score. What actually filters people is a lossy parse,
absolute knockouts, and never appearing in the recruiter's query. That's better
news than the myth — a mechanical problem has a mechanical fix. It's also the
honest version, and honesty is the whole positioning.

---

## Slide 4 — The Challenge **[T3]**

> **Eyebrow:** THE CHALLENGE
> **Title:** What's Holding You Back?

Your template has two cards. Keep the two you wrote, tightened:

**Card 1 — The keywords**
> The system matches tokens, not meaning. Every posting words the same skill
> differently, so every application needs its own vocabulary. Multiply that by
> fifty roles and you are doing manual search-engine optimisation on your own
> life story.

**Card 2 — Repetitive forms**
> Upload your resume. Now type your resume. Education, then experience, then
> certifications, then the same three open-ended questions in slightly
> different words. The information never changes. The typing never stops.

---

## Slide 5 — The Challenge, continued *(new, 2×3 grid)*

> **Title:** And four more nobody builds for

**1 — Tailoring doesn't scale**
Generic answers are fast and ignorable. Tailored answers work and take twenty
minutes each. Every applicant picks one and loses the other.

**2 — AI writes things you didn't do**
A model asked to "make this sound impressive" invents an employer, a metric, a
team size. You find out in the interview, and it costs you the offer.

**3 — Finding the right roles is its own job**
Before you can apply well, you have to know what's worth applying to. Job
boards optimise for listings viewed, not for fit.

**4 — Everyone wants your profile on their server**
Every tool that autofills for you keeps a copy of your identity, your work
history, and your salary expectations. You've traded a data breach for a
saved afternoon.

**Speaker note:** These four are the ones that justify building something new.
The first two slides describe a problem everyone already knows. These are the
ones competitors haven't solved.

---

## Slide 6 — Strategy: Onextap **[T4]**

> **Eyebrow:** STRATEGY
> **Title:** Onextap
>
> **Lead:** A Chrome extension and web dashboard that fills any application
> form in one click, writes answers grounded in your real experience, and
> ranks live job listings against your resume — without your profile ever
> leaving your device.

**Replace the template's three "Target / Rollout / Mitigate" pillars with:**

| Pillar | Line |
|---|---|
| **Fill** | One click fills any application form on any site. Keyword field matching, not a per-site integration. |
| **Write** | Answers and cover letters rewritten against the job description on your screen — and checked against your own CV before you see them. |
| **Find** | Live listings from seven job boards, ranked against your resume. Free, unmetered, and honest about what it couldn't find. |

**Replace "Key Strategic Pillars" with the four product principles:**

1. **Personal data never leaves the device.** Enforced in code — the storage
   module has no network path — not in a privacy policy.
2. **We fill what's already open.** Onextap does not submit applications, does
   not represent an employer, and does not auto-apply on your behalf.
3. **Grounded beats impressive.** Generated text is diffed against your own CV
   before you see it. Unsupported claims are flagged, not shipped.
4. **Failures degrade, they don't break.** When a model is rate-limited, the
   ranking falls back to deterministic keyword scoring. You always get a list.

---

## Slide 7 — Feature: Autofill *(new)*

> **Eyebrow:** THE PRODUCT
> **Title:** One click, any form

- **Works on any site.** Fields are matched by signature — label text, `name`,
  `id`, `placeholder`, `aria-label`, `autocomplete` — so there's no per-ATS
  integration to maintain and no site that's "not supported yet."
- **Survives modern forms.** Values are set through the native property
  descriptor and both `input` and `change` events are dispatched, so React and
  Vue applications register the fill. Most autofill tools silently fail here.
- **Reads labels the way a person does.** Explicit `label[for]`, implicit
  wrapping labels, and normalised text matching — so `first__name`,
  `First Name` and `Given name` all resolve to the same thing.
- **Skips what it shouldn't touch.** Hidden, disabled and read-only fields are
  left alone. Fixed-position fields are still filled.
- **Custom fields.** Add your own label/value pairs; they're matched through
  the same normaliser as the built-ins.
- **Full field coverage.** Name, email, phone (split or combined), address
  lines 1–3, city, state, postal code, country, LinkedIn, GitHub, portfolio,
  and the demographic/EEO fields US applications require.
- **Section detection.** The extension reports which sections it found on the
  page — personal info, education, work experience, open-ended questions,
  cover letter.

---

## Slide 8 — Feature: Answer Studio & Cover Letters *(new)*

> **Title:** The part that actually takes time

**Answer Vault**
A library of question/answer pairs per profile. Every application asks the same
three or four questions. Answer them once.

**Answer Studio — AI rewriting**

- **Reads the job you're looking at.** Context is scraped from your active tab
  automatically, or pasted by hand. With neither, you're told the answer is
  untailored rather than being quietly given a generic one.
- **Four tone presets:** Balanced & professional · Impact-driven · Technical
  depth · Leadership & ownership.
- **The prompt is built, not dumped.** It carries the question, your draft, the
  job context, a short profile summary (current role, top 8 skills, two most
  recent roles) and the three most word-overlapping answers already in your
  vault — not the entire vault.
- **Constrained output:** 160–240 words, first person, plain prose, and an
  explicit instruction never to invent an employer fact or a number.

**Cover Letters**

- Up to 10 templates per profile.
- Personalisation preserves your voice and holds length within ±10% of your
  original — it rewrites, it doesn't replace.
- Save the result as a named variant against the template, copy it, or push it
  straight into the page's cover-letter field.

**Credit rule, stated plainly on the slide:** One credit buys a generation
*plus three revisions of it*. Credits are deducted only after a successful
generation — a failed call costs nothing.

---

## Slide 9 — Feature: Job Matching *(new)*

> **Title:** Ranked against your resume, not against their inventory

- **Seven live sources.** Adzuna, Arbeitnow, ATS boards, Himalayas, Jobicy,
  RemoteOK and Remotive, ingested on a schedule into a shared pool.
- **Two-stage ranking.** A deterministic keyword prefilter narrows hundreds of
  listings to the thirty worth spending a model call on; an LLM then scores fit
  and explains the gaps. Cheap work first, expensive work only where it counts.
- **It searches again when it comes up short.** If too few strong matches
  surface, the pipeline reformulates the query and re-runs — up to a bounded
  number of attempts — instead of handing you a padded list.
- **A hard floor at 50%.** Nothing below a real match is ever rendered. When
  nothing clears the bar you're told exactly that — *"we scored 340 listings
  and none reached 50%"* — because that's a fact about the market, not a
  setting for you to go and lower.
- **It tells you what it relaxed.** If a listing only matched because your
  location or remote filter was dropped, the card says so.
- **Requirements, counted.** Every match shows how many things the role lists
  against how many your resume actually evidences.
- **Gap explanations on demand.** Ask any single role why it scored what it
  scored; it reads the full description against your profile.
- **Filter and sort:** remote / on-site / any, location, source, best-match or
  newest, plus an instant client-side minimum-match slider.
- **Searching is free.** Ranking costs no credits, on any plan, deliberately —
  charging per search would make you ration the feature that makes the rest of
  the product worth having.

**Speaker note:** The 50% floor is the single most differentiating thing on this
slide. Every competitor pads. Say why it exists: with no floor, a real
measurement of the live pool showed 26 of 30 results under 50% match, including
a 10% listing rendered as a "match." An empty page with an explanation is a
better product than a full page of noise.

---

## Slide 10 — Feature: Trust *(new)*

> **Eyebrow:** THE DIFFERENCE
> **Title:** Grounded, local, and tamper-proof

**1 — Your data stays on your device**
Personal details, saved answers and cover letters live in `chrome.storage.local`
in the extension and `localStorage` on the web. They are never written to our
database. The storage module has no network path at all — this is an
architectural guarantee, not a policy promise.

**2 — Generated text is checked against your real CV**
Every claim in a generated answer is diffed against a corpus built from your own
resume. It's deterministic — no model grading its own homework — and it runs
identically every time. Claims asserting numbers, employers or skills your CV
doesn't support are flagged before you send them.

**3 — Billing you can't tamper with, and neither can we**
Credits and premium status are server-managed and authenticated on every
request. The client never computes a balance. Row-level security makes the
transaction ledger writable only by the service role.

**4 — Nothing is submitted on your behalf**
Onextap fills the form you're looking at. It does not mass-apply, does not
represent an employer, and never puts your name on something you didn't read.

> ⚠️ **Read "Claims to avoid" below before using bullet 1 as-is.** There is a
> real qualifier you need to include.

---

## Slide 11 — Feature: Everything Else *(new, 2×3 grid)*

> **Title:** The rest of the surface

**Multiple profiles** — Unlimited, each with its own details, answers and cover
letters, switchable in one control. Apply as a designer and as a PM without
maintaining two accounts.

**Resume parsing** — Upload a PDF or an image; Google Gemini extracts structured
profile data. Your fields are filled in for you.

**Resume library** — Hold several resumes and switch between them. The original
file is never stored, but a content hash lets Onextap recognise the same file
when you re-select it.

**Four application types** — Job, College/University, Scholarship, Internship.
The same tool relabels itself: "Cover Letter" becomes "Personal Statement" or
"Scholarship Essay."

**Two surfaces, one product** — A Chrome extension popup for when you're
mid-application, and a full web dashboard for setup and job matching. The
dashboard syncs to the extension by direct browser messaging — not through a
server.

**Free to start** — Three AI credits on signup, unlimited autofill and unlimited
profiles forever. Premium is $5/month for unlimited generation. Cancellation
takes effect immediately.

---

## Slide 12 — Coming Soon: Consultation *(new)*

> **Eyebrow:** COMING SOON
> **Title:** When software isn't enough, talk to a person

Everything else in Onextap is automation. This is the opposite, deliberately.

- **Resume review.** A consultant reads your actual resume and tells you what a
  recruiter would see in six seconds — and what the parser in Slide 2 will
  quietly lose.
- **LinkedIn profile optimisation.** The profile recruiters search before they
  search anything else, rewritten to be found.
- **Cover letter help.** A human writes with you on the applications that
  matter most — the five you actually want, not the fifty you're grinding
  through.
- **Strategy, not templates.** Which roles you're realistically competitive for,
  and what's missing between you and the ones you're not.

**Positioning line for the slide:**
> Automation for the fifty. A human for the five.

**Speaker note:** Mark this clearly as forthcoming on the slide itself — a
"Coming Soon" badge, not a footnote. Everything else in the deck ships today,
and the deck's credibility depends on the audience knowing which is which.

---

## Slide 13 — "Why should I use yours?" **[T5]**

> **Headline (keep yours — it's good):**
> "I have so many websites like this. Why should I use yours?"
>
> **Answer line beneath it:**
> Because every one of them solves a quarter of the problem and keeps your data
> as the fee.

**Replace the 60% / 2.5x stat blocks.** You have no analytics and no
testimonials — see "Claims to avoid." Use product facts instead, which are
verifiable and land harder in a room that's heard invented percentages before:

| Stat | Label | Sub-line |
|---|---|---|
| **0** | Bytes of your profile on our servers | Personal data is device-local by architecture — there is no upload path to disable |
| **7** | Live job sources, ranked against your resume | Ingested continuously, scored two ways, free to search |
| **50%** | The floor we won't show you a match below | When nothing clears it, we say so instead of padding the list |
| **1** | Click to fill any application form | No per-site integration, no "unsupported site" |

Pick two for the template's two slots — **0** and **50%** are the strongest pair.
The first is the trust claim; the second is the honesty claim. They're the two
things competitors structurally cannot copy.

---

## Slide 14 — How everyone else works *(new)*

> **Title:** Six ways to solve a quarter of this

| Category | What it does | Where it stops |
|---|---|---|
| **Browser password managers** | Fill name, email, phone | Knows nothing about work history, answers or cover letters. Stops at the identity fields — the fast part. |
| **ATS account imports** ("import from LinkedIn") | Pre-fill one vendor's form | Per-vendor, and still makes you confirm every field. Your Workday profile does nothing on Greenhouse. |
| **Generic AI chat in another tab** | Writes an answer if you paste in the job and your resume | No memory of the page, no vault, no grounding. It will invent an employer and let you send it. |
| **Auto-apply bots** | Mass-submit hundreds of applications | Optimises for volume against fit. Puts your name on applications you never read, at companies you'd have skipped. |
| **Job boards with "match scores"** | Rank their own inventory | Scores are opaque and never shown a floor. Their incentive is listings viewed, not roles you'd get. |
| **Resume builders / ATS score checkers** | Give you a number out of 100 | That number corresponds to no real ATS. The score exists to sell the rewrite. |

**The common thread, as a pull quote:**
> Every one of them requires your profile on their server, and none of them
> covers more than one step of the loop.

---

## Slide 15 — Why us **[T6]**

> **Eyebrow:** WHY US
> **Title:** The whole loop. Free where it counts. Nobody's adversary.

*(Shorter alternative if the title crowds the layout: "The whole loop — and no
one's enemy.")*

Replace the template's three numbered cards:

**1 — The only one that covers the full loop**
Find the role → see how you actually score against it → fill the form → write
the answer → check it's true. Everything else does one of those five and hands
you back to the copy-paste for the rest.

**2 — What actually matters is free, and stays free**
Unlimited autofill. Unlimited profiles. Job matching ranked against your own
resume at **zero credits on every account** — because looking for work is the
thing this product is *for*, and metering it would make you ration the feature
that makes the rest worth having. Filtering, sorting and re-checking a list you
already ran cost nothing at all.

The only thing we charge for is AI writing at volume. Three generations free —
each one buying three revisions of itself — then $5 a month if you want it
unlimited. That's the entire pricing page. There is no annual lock-in, no seat
minimum, and cancelling takes effect the moment you click it.

**3 — We're not competing with companies. We're trying to work with them.**
Onextap sits on top of the hiring system instead of fighting it:

- **We never auto-apply.** Nothing is submitted on your behalf, ever. Every
  employer on the other end gets an application a human actually read — not one
  of four hundred a bot fired off overnight.
- **We don't replace job boards, we read them.** Seven sources ingested
  continuously, every listing linking back to where it came from. We send them
  traffic; we don't scrape them for a walled garden.
- **We don't try to beat the ATS.** We fill its form correctly and completely,
  which is the outcome it was built to want in the first place.
- **We flag inflated claims before an employer ever sees them.** Generated text
  is diffed against your real CV, and anything it can't ground gets surfaced to
  you first.

A tool that mass-submits is a cost to the company receiving it. This one is the
opposite: better-formed applications, from candidates who read the posting,
saying only things they can defend in the room.

**Closing line:**
> Onextap doesn't apply for you, and it doesn't work against anyone. It makes
> applying cost what it should — one click, and the truth.

---

## Claims to avoid

Three things in your current deck or your shipped copy that this content
deliberately works around. Each is documented in `docs/prd.md` §11.

**1 — Don't invent statistics.** Template slide 5 carries `60%` and `2.5x`
placeholders. There is no analytics or usage instrumentation in the codebase
and there are no customers, testimonials or case studies yet. Any market
percentage on this slide would be fabricated, and it's the one thing in a
campaign deck that gets checked. Slide 13 above replaces them with product facts
that are true and verifiable.

**2 — Qualify the privacy claim.** "Your data never leaves your device" is true
of *stored* profile data and false as an unqualified sentence. Resume text and
job context transit to Google Gemini and Groq on each request, and the
observability layer retains traces when configured. The accurate and still very
strong claim is:

> "Your profile is stored only on your device — never on our servers. Text you
> generate is processed by our AI providers per request and not retained by us."

Use that wording. The codebase itself carries a standing rule against writing
the stronger version.

**3 — Three shipped marketing claims have no implementation.** Keep them out of
this deck until they're built or removed from the site:

- **"Smart Field Mapping — map it once, Onextap remembers."** There is no
  per-field memory. Matching is keyword-based and stateless.
- **"Encrypted cloud backup & sync."** Not implemented, and it contradicts the
  local-only architecture that Slide 10 and Slide 15 are built on. Claiming both
  in one deck is a contradiction an audience will catch.
- **Premium "two-pass AI rewrites / priority processing / deeper
  personalisation."** The generation path is identical for free and premium
  accounts; only the credit check differs. Slide 11 sells premium on unlimited
  generation, which is true.

**4 — Say "free", not "unlimited", about job matching.** Ranking genuinely costs
zero credits on every account, which is why Slide 15 leads with it. But it is
rate-limited to **ten fresh ranking runs per hour** per user. Cached results and
client-side filtering/sorting don't touch that budget, so it's invisible in
normal use — but "unlimited job matching" is a claim someone can disprove in an
afternoon. The copy on Slide 15 says "zero credits on every account" for exactly
this reason. Don't upgrade it to "unlimited" on stage.

One more, smaller: the "what to fill" section toggles in the popup are sent but
not honoured — every matching field is filled regardless of the toggles. Slide 7
describes section *detection*, which is real, and avoids implying partial fills.

---

## Source map

| Slide | Grounded in |
|---|---|
| 2–3 (ATS mechanics) | **General industry knowledge, not your repo.** Verify vendor specifics before presenting to a technical audience. |
| 4–5 (problems) | `PRODUCT.md` § Product Purpose, Users |
| 6 (strategy) | `PRODUCT.md` § Product Principles |
| 7 (autofill) | `public/content.js`, `src/autofillSections.js` |
| 8 (Answer Studio) | `docs/prd.md` §5.4–5.5, `src/answerStudio.js` |
| 9 (job matching) | `server/jobs/graph.js`, `server/jobs/adapters/`, `src/components/dashboard/JobMatchesPage.jsx` |
| 10 (trust) | `src/matching/fabrication.js`, `src/storage.js`, `supabase/schema.sql` |
| 11 (everything else) | `README.md`, `docs/prd.md` §5–6, `src/resumeStore.js`, `src/applicationTypes.js` |
| 12 (consultation) | Your brief. Not in the repo — marked Coming Soon throughout. |
| 13–14 (comparison) | `PRODUCT.md` § Positioning |
| 15 (why us) | `PRODUCT.md` § Positioning & Principles, `docs/prd.md` §6 (pricing), `server/index.js` (rank route is credit-free), `server/jobs/rankCache.js` |
