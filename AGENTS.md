# AGENTS.md

This file is the front door for agents working in the Onextap repository.

It should stay short. Use it as a map, not as an encyclopedia.

## Mission

Onextap autofills job applications. A Chrome MV3 extension fills forms on
any site from a locally stored profile; a web dashboard manages those
profiles, a saved-answer vault, and AI answer generation; an Express backend
guards credits, premium status, and the AI providers.

Correctness here means: the user's personal data stays local, credits cannot
be manipulated from the client, and a change to the shared React source
works both inside the extension and on the plain web dashboard.

## How to work here

1. Read the relevant docs before making changes.
2. Prefer small, reviewable changes over large rewrites.
3. Follow the documented architecture instead of inventing new structure
   during implementation.
4. Verify by building and exercising the path. This repo has **no test
   suite and no linter** — verification is manual, so say what you actually
   ran.
5. Escalate when an action is destructive, ambiguous, or requires judgment
   beyond the written rules.

## Start here

- Hot rules, commands, escalation list: `CLAUDE.md`
- Repo structure and import rules: `docs/repo-structure.md`
- Setup, environment variables, troubleshooting: `README.md`
- Database schema, RLS, triggers: `supabase/schema.sql`
- Active plans: `docs/plans/active/`
- Agent memory tiers: `memory/README.md`

### Reference documents

Written from the code, not from intent. Each one records what the system
actually does and flags where the shipped UI and the implementation disagree.

| Document | Covers |
|---|---|
| `docs/prd.md` | Problem, users, features, pricing, requirements, known divergences |
| `docs/trd.md` | Runtimes, interface contracts, data flow, security, operations, risks |
| `docs/app-flow.md` | Every user flow traced to the code that runs it |
| `docs/ui-ux-design.md` | Design tokens, surfaces, components, motion, accessibility |
| `docs/backend-schema.md` | Tables, RLS, triggers, local data shapes, full API reference |

There is no `docs/architecture.md`. `docs/repo-structure.md` covers layout
and import rules; `docs/trd.md` covers architecture. Do not create empty
stubs for missing filenames — put content where it already belongs.

## Non-negotiables

- Do not guess data shapes at boundaries. The three boundaries that matter
  are `chrome.runtime` messaging, the JWT-authenticated HTTP API, and the
  Supabase row shapes. Validate rather than assume.
- Do not bypass the import rules in `docs/repo-structure.md` for
  convenience — especially `src/` ⟷ `server/`, which must stay HTTP-only.
- Do not move credit or premium logic to the client.
- Do not run destructive actions without approval. Against the production
  Supabase project, that includes re-running `supabase/schema.sql`.
- Do not add a dependency without checking `package.json` and
  `server/package.json` first; the two are kept in step for the Vercel build.
- Do not leave a change unverified when verification is possible. "It should
  work" is not a result.

## Preferred workflow

1. Understand the task.
2. Find the relevant docs and code.
3. Make the smallest coherent change.
4. Build the surfaces you touched (`npm run build`, `npm run build:dashboard`,
   `npm run server:dev`) and exercise the path.
5. Summarize what changed and any remaining risks.

## Two surfaces, one source

The single most common way to get this repo wrong: `src/` ships to both the
extension and the web dashboard. Code that assumes `chrome.*` exists breaks
the dashboard; code that assumes it does not breaks the extension. Guard
with `typeof chrome !== 'undefined'` and check both before finishing.

## If information is missing

If the repository does not contain enough context to complete the task
safely, stop guessing and surface what is missing:

- missing documentation
- missing architecture rule
- missing tool or permission
- missing test or observability signal (this repo has a lot of these — name
  the gap rather than inventing a check that does not exist)

When possible, add the missing context back into the repository so future
runs can use it: a rule in `CLAUDE.md`, a decision in `memory/semantic/`, a
procedure in `memory/procedural/`, or an entry in `memory/episodic/`.
