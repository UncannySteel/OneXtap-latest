# Agent Memory

Four tiers, adapted from the [q-agent-harness](https://github.com/kju4q/q-agent-harness)
pattern. Only Tier 1 is always in context; the rest are read when a task
needs them.

| Tier | Lives in | Holds | Loaded |
|---|---|---|---|
| 1 — Hot | `CLAUDE.md` (repo root) | Rules the agent applies without being reminded | Always |
| 2 — Episodic | `memory/episodic/` | One entry per completed task: what was tried, what happened | On demand |
| 3 — Semantic | `memory/semantic/` | How this system works and why it was built that way | When a task touches the area |
| 4 — Procedural | `memory/procedural/` | Step-by-step procedures for recurring kinds of task | When the task matches |

Tier 1 is `CLAUDE.md` at the repo root rather than a file in here, because
that is the filename Claude Code loads automatically. `memory/MAINTENANCE-hot.md`
is the guide for keeping it small.

## How the tiers feed each other

Write an episodic entry when a task ends, while you still remember what went
wrong. Most entries teach nothing, and a blank `lesson` field is fine.

When the same lesson shows up three times, promote it. One occurrence is
noise, two is a pattern, three means you will keep paying for it:

- Fix is one sentence → add a rule to `CLAUDE.md`
- Fix is a workflow → write a procedure in `memory/procedural/`
- It is background rather than instruction → `memory/semantic/`

Promotion is the point. Logs that never get read are just cost.

## Current state

Templates only — every file here is scaffolding with no project content yet.
Fill them in as real tasks generate real lessons rather than seeding them
with guesses.

What is here today:

- `episodic/TASK-LOG-template.md` — copy to `task-log.md` and append entries
- `semantic/PROJECT-KNOWLEDGE-template.md` — fill in as decisions get made
- `procedural/PROCEDURES-README.md` — what a procedure is; folder is empty
- `MAINTENANCE-hot.md` — monthly review process for `CLAUDE.md`

The system map and dependency rules that would normally seed Tier 3 are
already written up in `docs/repo-structure.md`. Use the semantic tier for the
*why* — decisions, rejected alternatives, domain rules — not for repeating
the layout.
