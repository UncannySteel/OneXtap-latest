# Job match vs. `jamwithai/observable-job-agent`

Differences between Onextap's job-match feature (`server/jobs/`, `src/matching/`)
and the Job Scout reference implementation it was built against.

`server/jobs/graph.js` calls that project "the baseline" and keeps its node
names deliberately. This document records where the two have **diverged** — the
shared architecture is assumed, not re-argued. No shared source code was found:
the correspondence is design-level, and every implementation below is
independent.

Compared against `observable-job-agent@main` (Part 4 release).

---

## At a glance

| | Job Scout (baseline) | Onextap |
|---|---|---|
| Language / runtime | Python 3.12 | Node + browser |
| Graph | LangGraph `StateGraph` + `MemorySaver` | Five async functions and an `if` |
| Job supply | Live fetch per run | Cron ingest → Supabase pool |
| Pre-LLM filtering | None | Deterministic keyword prefilter |
| On failure | Raises; errors accumulate in state | Never throws; degrades to keyword scores |
| Budget | LLM call count | Call count **and** wall clock |
| Default model | `openai:gpt-4o-mini` | Gemini chain, Groq fallback |
| Rank prompt | ~10 lines, deliberately unoptimized | 105 lines, banded rubric |
| Fabrication check | `difflib`, 3 section thresholds | Containment/trigram, 2 thresholds + numeral gate |
| Sources | 3 live + cache | 7 live + cache |
| License | MIT (Copyright 2026 Jam with AI) | none present |

---

## 1. Orchestration

**Baseline** compiles a real graph and keeps it for the process lifetime:

```python
builder.add_conditional_edges(START, route_entry, ["fetch_jobs", "tailor"])
builder.add_edge("fetch_jobs", "rank_jobs")
builder.add_conditional_edges("rank_jobs", should_reformulate, ["reformulate_query", END])
```

State is an `AgentState` TypedDict persisted by a `MemorySaver` checkpointer,
which is what makes its two-invocation contract work: invocation A (search)
writes `profile` and `ranked_jobs` into the thread; invocation B
(`{"selected_job_id": ...}`) reads them back and runs only the tailor pipeline.

**Onextap** has no runtime, no checkpointer, and therefore no thread
continuity. The graph is five functions with dependencies injected as
`deps = { fetchJobs, callModel, trace }`, which is what makes it testable with
three stubs against an unreachable database.

**Consequences of the divergence:**

- The baseline's search→tailor handoff has no local equivalent. Tailoring here
  is a separate prompt (`suggest_tailoring.md`), not a graph node reading
  checkpointed state.
- Stack traces point at the failing code rather than at a runtime frame.
- The loop cap is enforced by a counter in a `while`, not by a conditional edge.

### Shared constants, different names

| Meaning | `graph.py` | `graph.js` |
|---|---|---|
| Good-fit threshold | `GOOD_FIT_THRESHOLD = 60` | `GOOD_SCORE = 60` |
| Enough matches to stop | `MIN_GOOD_JOBS = 5` | `ENOUGH_GOOD_MATCHES = 5` |
| Loop cap | `MAX_REFORMULATIONS = 2` | `MAX_LOOPS = 2` |
| Env override (lower only) | `SCOUT_MAX_REFORMULATIONS` | `RANK_MAX_LOOPS` |

Both clamp the env override to the hard ceiling. The reasons recorded for
keeping the cap at 2 differ: the baseline says the conditional edge *is* the
lesson; Onextap says the reformulation ladder has three rungs
(`drop_location → relax_remote → widen_terms`) and one loop reaches only the
first.

---

## 2. Where jobs come from

**Baseline** queries live sources on every run, cascading by consumption
priority — a lower source is merged in only when the ones above returned too
few. Since Part 3 the live sources are *queried* concurrently
(`SCOUT_CONCURRENT_SOURCES`) while consumption order stays fixed.

```
JSearch → Adzuna → Remotive → committed cache
```

**Onextap** ingests into `public.job_listings` on a cron-guarded route and
ranks out of that pool. The cascade still exists, but it runs at ingest time,
not at request time.

```
adzuna, arbeitnow, ats, himalayas, jobicy, remoteok, remotive → cache
```

Only **Adzuna, Remotive and the cache** are common to both. JSearch is absent
here; the ATS adapter (Greenhouse/Lever-shaped boards) has no baseline analogue.

**Downstream effects of pooling:**

- The bound moved from "how much we fetch" to "how much we rank"
  (`PREFILTER_LIMIT = 30`, six batches).
- Pooled listings often carry truncated descriptions, which is why `rank.md`
  has a `descriptionQuality: "snippet"` rule the baseline prompt has no need of.
- Ingest carries its own budget the baseline has no equivalent for:
  `INGEST_BUDGET_MS` 45 s, `PER_ADAPTER_TIMEOUT_MS` 10 s, `MAX_PAGES_PER_RUN` 6,
  plus a resumable cursor written immediately after each page's upsert.

### `cached_jobs.json` — same name, different file

| | Baseline | Onextap |
|---|---|---|
| Size | ~362 KB | ~56 KB |
| Content | Snapshotted real listings (`scripts/snapshot_jobs.py`) | Synthetic fixtures, hand-edited |
| Companies / URLs | Real | Invented / `example.com` |
| Served in production | Yes, as last resort | Never |

### Failure reporting

Both refuse to let a dead source look like a quiet job market, but report it
differently. The baseline logs a human-readable reason (`HTTP 429 (quota
exhausted)`, `timed out`). Onextap returns a closed enum on every adapter —
`timeout | quota | bad_key | parse | network | disabled` — persisted to
`job_ingest_state.last_error` and surfaced in the ingest API response.

---

## 3. Ranking

Both batch jobs, score 0–100, run batches concurrently, and never re-score a
job that a previous loop already scored. Beyond that they diverge sharply.

### The prompt

The baseline's `RANK_JOBS_PROMPT` is about ten lines and says so on purpose:

> *"this prompt is intentionally left unoptimized (it is the target of the
> Phase 3 prompt optimizer). Keep it to clear instructions and the correct
> output schema — no few-shot examples or chain-of-thought scaffolding."*

`server/jobs/prompts/rank.md` is 105 lines and takes the opposite position:

- A **five-band score table** (85–100 / 70–84 / 55–69 / 35–54 / 0–34) so a 72
  means the same thing across two jobs, two runs, and two models.
- Two rules governing the bands themselves (evidence not enthusiasm; use the
  whole range).
- Five scoring rules, including "score only what the text says" and "never
  invent candidate experience."
- A **snippet rule** for truncated descriptions — score conservatively, rarely
  above ~70, name the limitation in the gap sentence.
- A strict-JSON contract: one object per input job, in input order, five keys
  exactly, ids copied verbatim.

### Output shape

| Baseline (`JobScore`) | Onextap |
|---|---|
| `job_id` | `jobId` |
| `fit_score` | `score` |
| `fit_explanation` (2–4 sentences) | `gapSummary` (**exactly one** sentence) |
| `matched_skills` | `matchedSignals` (≤ 6 noun phrases) |
| `gaps` | `missingSignals` (≤ 6 noun phrases) |

Onextap also has a **separate `explain.md` prompt**; the baseline produces its
explanation inside the ranking call only.

### Failure behaviour — the sharpest difference

The baseline raises. `ensure_budget` throws `LLMBudgetExceededError`; node
errors accumulate in `state["errors"]`.

`server/jobs/rank.js` holds the opposite rule: **every job that goes in comes
out, exactly once.** A model that returns eleven objects for ten jobs,
renumbers ids, emits `"high"` as a score, truncates mid-array, or 404s because
the account lost a model — none of it may remove a job from the list. Anything
unscored falls through to `fallbackScoreJob()` and is marked
`scoredBy: 'keyword'`. The whole graph resolves to a list with `degraded: true`
and a `reformulations[]` record rather than an error.

### Budgets

| | Baseline | Onextap |
|---|---|---|
| Call budget | `MAX_LLM_CALLS_PER_RUN`, checked per node | implicit: `(1 + MAX_LOOPS) × 30 / batch` |
| Time budget | none | `RANK_BUDGET_MS = 40_000` |
| Batch knob | `SCOUT_RANK_BATCH` | `RANK_BATCH_SIZE` |
| Parallelism | `MAX_PARALLEL_BATCHES = 4` | bounded in `rank.js` |

The wall-clock budget exists because call count and time stopped tracking each
other once providers began rate-limiting: 18 completions is ~20 s against a
healthy account and ~200 s against a 429ing one. It is sized under the smallest
ceiling above it (Vercel Hobby's 60 s), gates whether *another* loop starts, and
never interrupts one in flight.

---

## 4. Reformulation

| | Baseline | Onextap |
|---|---|---|
| Returns | bare query text | JSON `{query, relaxed[], rationale}` |
| Prompt length | ~6 lines | 61 lines, five rules |
| User visibility | none | `relaxed[]` rendered in the run footer |
| Broadening strategy | "synonyms, adjacent titles, less specific" | ranked ladder + lexicon adjacency |

Onextap's version is auditable by design: `relaxed` carries one short entry per
loosened constraint "phrased so the candidate can see what changed and object
to it," and rule 5 forbids relaxing anything marked a hard requirement.

It also broadens along a **category adjacency map** rather than a flat union —
`ADJACENT_CATEGORIES` in `graph.js`, borrowed terms weighted at `0.35`, capped
at 60. A backend profile broadened into `cloud`/`data` still gets backend-shaped
jobs; broadened into `design` it would get noise wearing the same score.

---

## 5. Fabrication / grounding

Same intent — deterministic, zero-LLM, diff generated text against the
candidate's own corpus, flag what cannot be grounded, never auto-repair. Three
real differences in the algorithm.

### Similarity metric

| | Baseline | Onextap |
|---|---|---|
| Primitive | `difflib.SequenceMatcher` ratio | `max(token containment, trigram Jaccard)` |
| Why | stdlib | Node has no `difflib` |

The `max` rather than an average is deliberate: a faithful one-line paraphrase
of a long bullet has near-total containment but poor trigram overlap, and a
reworded claim reusing the bullet's phrasing scores the reverse. Averaging would
fail both.

### Thresholds

| Baseline | | Onextap | |
|---|---|---|---|
| `SCOUT_FAB_BULLET_RATIO` | 0.65 | `MIN_SIM` | 0.62 |
| `SCOUT_FAB_LETTER_RATIO` | 0.55 | `STRICT_SIM` | 0.85 |
| `SCOUT_FAB_SKILL_RATIO` | 0.85 | `MIN_CLAIM_TOKENS` | 4 |

The baseline splits thresholds **by section** (bullets / letter / skills).
Onextap splits them **by claim kind**: `isStrictClaim()` classifies a claim as
strict if it carries a number, year, percentage, currency amount, or a
multi-word proper-noun run, and strict claims must clear `STRICT_SIM`. Section
boundaries do not enter into it.

### The numeral gate — a documented baseline gap, closed

The baseline's own docstring concedes the false negative:

> *"a fabricated detail inside an otherwise-copied bullet can still pass (the
> remaining false negative)."*

`fabrication.js` closes it. It collects every numeral appearing anywhere in the
corpus and gates separately on it: a number the CV never states is ungrounded
no matter how well the surrounding sentence matches.

> *"A fuzzy similarity score can never catch 'a team of 40' against 'a team of
> 4' — the two strings differ by one character, so containment and trigram
> overlap both stay near 1.0 — yet that single digit is the entire fabrication."*

### Other grounding differences

- **`corpus_ref` contract.** Baseline bullets each carry a reference that must
  resolve to a corpus item; an unresolvable ref is itself a flag. Onextap
  searches the whole corpus for the nearest item instead.
- **Canonicalization.** Baseline canonicalizes units before comparing
  (`10M ≈ 10 million`, `/day ≈ per day ≈ daily`). Onextap strips thousands
  separators but does not expand suffixes.
- **Skills.** Baseline checks skills as their own class, with a containment
  rule ("AWS" grounded by "basic AWS") and a fallback when no skills section
  parsed. Onextap has no separate skills pass.
- **Cover letters.** Baseline skips the first and last sentence, tests
  `_looks_factual`, and retries a miss against two-reference combinations.
  Onextap's strict/non-strict split covers the same ground differently.
- **Corpus sources.** Baseline builds from CV text *plus* an optional LinkedIn
  data-export ZIP, with German heading support. Onextap builds from CV text
  only.

---

## 6. Models and providers

| | Baseline | Onextap |
|---|---|---|
| Default | `openai:gpt-4o-mini` | Gemini rotation chain |
| Fallback | Groq / Ollama / `SCOUT_MODEL` | Groq (`GROQ_ANSWER_MODEL` → `GROQ_FALLBACK_MODEL`) |
| Abstraction | LangChain `init_chat_model` | injected `callModel({system, user, ...}) => string` |
| Separate tailor model | `SCOUT_TAILOR_MODEL` | no |
| Structured output | `.with_structured_output(JobScores)` | `parseJsonArrayLenient` + clamping |

The rotation chain is not a design preference — it is a quota shape. Gemini is
rationed per-model per-day on this account, so rotating across model ids
multiplies the daily ceiling; Groq's free tier caps tokens per minute, which
made it the fallback rather than the primary.

Neither `rankBatch` nor the graph constructs a client. `createGroqModelCaller()`
is the only thing in `rank.js` that knows Groq exists.

---

## 7. Observability

Both trace to Opik and both degrade to no-ops without a key. The stances differ.

| | Baseline | Onextap |
|---|---|---|
| Integration | `OpikTracer` via LangChain callbacks | hand-rolled spans (`startTrace`/`span`) |
| Disabled path | functions become no-ops | SDK **not even loaded**; zero cold-start cost |
| Handle when off | `None` returned, callers branch | inert frozen handle; **never null** |
| Broken config | — | warns once, degrades permanently, never breaks the request |
| Trace metadata | git sha, cost, CV attached to trace | request id (`X-Request-Id`) |
| Prompt registry | local constants mirrored to Opik | prompts are `.md` files on disk |

The null-safe handle is the load-bearing choice: call sites never grow
`if (trace)`, because that branch is what rots when someone adds a span inside
the conditional and the instrumentation only works in the configuration nobody
runs locally.

Note the retention asymmetry, which matters here and not there: Opik **retains**
recorded traces, so profile-derived text reaching a trace is a disclosure, not a
local-only operation.

---

## 8. Evaluation

Three of four metric names carry over verbatim. What they run against does not.

| Baseline | Onextap | Ground truth |
|---|---|---|
| `ProfileFieldAccuracy` | `profileFieldAccuracy.test.js` | `expected_profiles.yaml` → `test/evals/fixtures/cvs.js` |
| `FabricationRate` | `fabricationRate.test.js` | wraps the validator on both sides |
| `fit_explanation_quality` (G-Eval) | `fitExplanationQuality.test.js` | LLM judge on both sides |
| `ranking_calibration.csv` | `rankCalibration.test.js` | `test/evals/fixtures/rankPairs.js` |
| `Hallucination`, `AnswerRelevance` | — | Opik built-ins, not ported |

Structural differences:

- Baseline evals run as Opik **experiments** (`scripts/run_evals.py`, CI gates
  in `gates/test_eval_gates.py`, annotation queues for human agreement).
  Onextap's run under `node --test` as ordinary test files.
- Onextap's `rankCalibration` gates a model before it joins the rotation chain —
  a step that exists because of the rotation, which the baseline doesn't have.
- Baseline ships 230 tests with mocked LLMs and network. Onextap's automated
  coverage is narrower: pure functions in `src/matching/` and `src/corpus.js`,
  plus `test/jobs/` and `test/observability/`. Everything else is verified by
  hand in a browser.

---

## 9. In the baseline, absent here

- LangGraph runtime, `MemorySaver` checkpointer, thread continuity
- `tailor` and `validate_tailoring` as graph nodes, with the `corpus_ref`
  grounding contract *(Onextap has `suggest_tailoring.md` and a cover-letter
  page, but they are not nodes and carry no ref contract)*
- Profile extraction as a distinct traced step (`profile.py`)
- LaTeX/tectonic PDF rendering with a `.tex` + Overleaf fallback
  (`renderer.py`, `templates/cv.tex.j2`)
- The entire Jobvis voice console — ElevenLabs agents, WebRTC barge-in,
  Next.js 16 + Three.js orb, hand tracking (`web/`, `voice/`)
- Gradio wizard (`app.py`), FastAPI backend (`api.py`)
- Teaching notebooks for each phase, and the scripts around them: prompt
  optimizer, annotation-queue setup, eval-dataset builders, batch runners
- LinkedIn data-export ZIP ingestion into the corpus
- Research tool (`tools/research.py`)
- A committed `LICENSE`

## Here, absent in the baseline

- The product itself: Chrome MV3 autofill extension, web dashboard, one React
  source tree shipping as both
- Accounts, credits, premium gating, Dodo payment webhooks, Supabase auth
- Cron-driven ingest into a persistent job pool with a resumable cursor
  (`ingest.js`, `job_ingest_state`)
- Rank cache **and** rate limiter behind one three-method interface with two
  substitutable stores (`rankCache.js`)
- The deterministic matching layer: `prefilter.js`, `lexicon.js`,
  `extractKeywords.js`, `fallbackScore.js`, `stopwords.js` — roughly 1,900 lines
  with no baseline analogue
- Category adjacency broadening (`ADJACENT_CATEGORIES`)
- A separate `explain.md` prompt
- Device-only profile storage (`chrome.storage.local` / `localStorage`, never
  Supabase)
- Four per-runtime loggers with mirrored redaction key lists
- `X-Request-Id` correlation across server, service worker and client

---

## 10. Attribution

`observable-job-agent` is MIT licensed, Copyright (c) 2026 Jam with AI.

This repo has no `LICENSE` file, and the only record of the lineage anywhere is
the comment block at the top of `server/jobs/graph.js`.

No copied source was found, so MIT's notice requirement is likely not triggered.
But the graph shape, the three constants, the node names and three of four
eval-metric names are traceably the same design, and that currently lives in one
file header. Worth a deliberate decision rather than a default.

---

## How this was compared

Local files read on disk: `server/jobs/{graph,rank,rankCache,ingest,query}.js`,
`server/jobs/adapters/index.js`, `server/jobs/prompts/*.md`,
`server/observability/opik.js`, `src/matching/*.js`, `src/corpus.js`,
`test/evals/`.

Baseline read from `api.github.com` and `raw.githubusercontent.com` at
`main` (Part 4): `graph/{graph,state}.py`, `graph/nodes/{rank_jobs,
reformulate_query}.py`, `graph/prompts/{rank_jobs,reformulate}.py`,
`validation.py`, `corpus.py`, `tracing.py`, `tools/jobs_api.py`, `llm.py`,
`config.py`, `evals/metrics.py`, `LICENSE`, `README.md`.

Static comparison only — nothing was built or executed on either side.
