# Procedural Memory (Tier 4)

Procedures are the how-to layer. Hot memory (`CLAUDE.md`) says what the
rules are. Semantic memory says how the system works. Procedural memory says
what to do, step by step, for a specific kind of task.

This is the tier where an agent stops improvising a workflow every time and
starts running one that has already been proven to work.

## What makes a procedure

A procedure is not notes. It has four parts, and the four parts are what
make it reusable:

**A version and a validation date.** `v1.0, last validated: 2026-09-09`.
Procedures rot. The date tells you whether these steps have been run against
the current system or against the one from a year ago. Bump the version when
the steps change, and update the date every time you actually follow the
procedure end to end and it worked.

**When to use.** Including when not to use. A procedure applied to the wrong
task is worse than no procedure, because it looks authoritative.

**Steps.** Ordered, specific, and written so someone can follow them without
knowing why. Steps that say "carefully consider" are not steps.

**What done looks like.** Observable conditions, not a feeling. "The
extension was rebuilt, reloaded, and the field filled on a real posting" is
checkable. "The code is clean" is not.

## Procedures in this folder

None yet. This folder is scaffolding.

## Where procedures come from

You do not write these up front. You write one when a lesson in
`memory/episodic/` has appeared three times and the fix is longer than one
sentence. One occurrence is noise. Two is a pattern. Three means you are
going to keep paying for it.

## Likely first candidates for this repo

Not written yet — listed because the gaps are already visible, not because
anyone has hit them three times:

- **Ship a change to the extension.** Build, reload at `chrome://extensions/`,
  verify on a real job posting, check the service-worker console. There is no
  test suite, so this manual loop *is* the verification story.
- **Change an API route.** Auth, the credit path, error shape, and the fact
  that the same code runs standalone in dev and serverless on Vercel.
- **Add a field to autofill.** Touches `public/content.js` matching,
  `profileStore.js` shape, and the dashboard form — three places, easy to
  half-finish.
- **Apply a schema change.** No migration tool exists; `supabase/schema.sql`
  is run by hand and re-running it recreates a live trigger.

Delete any of these that turn out not to matter. A list of procedures nobody
writes is worse than an empty folder.

## Keeping them honest

Every time you follow a procedure end to end, update its validation date. If
you skipped a step because it no longer applies, edit the procedure and bump
the version. If a procedure has not been validated in six months, either run
it or archive it.
