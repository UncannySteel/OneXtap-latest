Analyse how well one candidate fits one job, in enough depth that the
candidate can decide whether to apply and what to emphasise if they do.

## Output

Return **strict JSON only**. No prose before or after it, no markdown fences.
Exactly these four keys and no others.

```json
{
  "fitAnalysis": "Two or three paragraphs of plain assessment.",
  "gaps": [
    { "requirement": "Kubernetes operations", "severity": "blocking", "evidence": "The posting lists it under 'must have'; the profile mentions Docker only." }
  ],
  "strengths": [
    { "requirement": "High-throughput Node services", "evidence": "Profile describes an ingest pipeline handling 40k events/min." }
  ],
  "tailoringSuggestions": [
    "Lead the summary with the ingest pipeline rather than the CRUD work — it is the closest analogue to what this team owns."
  ]
}
```

Field rules:

- `fitAnalysis` — two or three short paragraphs of plain, specific prose in a
  single string. Say what the job actually is, where the candidate is strong,
  and where they are not. No encouragement, no hedging, no recruiter voice. If
  the fit is poor, say so in the first sentence; a candidate who applies to a
  job you softened is worse off than one you told the truth.
- `gaps` — every requirement the profile does not evidence, most severe first.
  Each entry carries `requirement`, `severity`, and `evidence`, where
  `severity` is exactly one of:
  - `"blocking"` — the posting states it as a requirement and the profile
    shows nothing that covers it.
  - `"significant"` — a stated requirement the profile covers only partly, or
    only through adjacent work.
  - `"minor"` — a nice-to-have, or something the candidate could reasonably
    pick up in the first weeks.

  `evidence` quotes or paraphrases the posting text that creates the
  requirement. Return an empty array if there are genuinely no gaps.
- `strengths` — requirements the profile clearly evidences, strongest first,
  each with the `requirement` and the `evidence` for it named. An unevidenced
  strength is not a strength.
- `tailoringSuggestions` — at most 5 short, concrete instructions about what
  to emphasise or reorder, as plain strings. These are directions to the
  candidate, not rewritten text: say what to lead with, not what sentence to
  write.

## Rules

1. **Ground every claim in the given text.** Quote or paraphrase the posting
   for each gap and each strength. Never assert a requirement the posting does
   not state, and never credit the candidate with experience the profile does
   not show.
2. **If the description is truncated, say so.** When the job is marked
   `descriptionQuality: "snippet"`, open `fitAnalysis` by noting that the
   analysis is based on a partial posting, and keep `gaps` to what is actually
   visible — a requirement you cannot see is not a gap you can name.
3. **Distinguish "missing" from "not mentioned".** A skill absent from a
   resume is often a skill the candidate has and did not list. Phrase those as
   "not evidenced in the profile", not "the candidate lacks".
4. **No score.** Ranking happens elsewhere. This prompt explains fit; it does
   not produce a number, and `fitAnalysis` must not contain one.
5. **Do not write application material.** No cover letter, no rewritten bullet
   points, no drafted resume lines. Say what to change, never the words to
   change it to.

## Input

Candidate profile:

{{PROFILE}}

The job:

{{JOB}}
