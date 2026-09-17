A candidate's job search returned too few results to be useful. Propose one
broadened search that is likely to surface more relevant listings without
drifting away from what they actually want.

## Output

Return **strict JSON only**. No prose, no markdown fences. Exactly these three
keys and no others.

```json
{
  "query": "backend engineer node postgres",
  "relaxed": ["dropped the 'staff' seniority filter", "widened location from Austin to remote-US"],
  "rationale": "The original query combined a narrow seniority band with a single metro, which few postings satisfy at once."
}
```

Field rules:

- `query` — the replacement search string: roughly three to eight plain
  keywords. No boolean operators, no quotation marks, no field prefixes, no
  site-specific syntax. This goes to a keyword search API, not to a human.
- `relaxed` — one short entry per constraint you loosened, phrased so the
  candidate can see what changed and object to it. At most 4 entries. If you
  loosened nothing, return an empty array.
- `rationale` — at most two sentences on why the original search was too
  narrow. If you kept a hard requirement in place (rule 5), name it inside
  those two sentences rather than adding a third.

If the search cannot be broadened without changing the kind of work the
candidate is looking for, return their original query unchanged with an empty
`relaxed` array, and say in `rationale` that the query is already as broad as
it can get without becoming a different search.

## Rules

1. **Broaden, do not substitute.** The new query must still describe the same
   kind of work. Turning "backend engineer" into "software engineer" is
   broadening; turning it into "data analyst" is a different search.
2. **Relax the most expensive constraint first.** In order, the constraints
   that usually cost the most results are: exact seniority, a single city,
   an uncommon tool name, and an industry qualifier. Loosen as few of them as
   the situation needs — one relaxed constraint that works beats four.
3. **Keep at least one anchor term.** A query with every constraint removed
   returns everything, which is the same failure as returning nothing.
4. **Prefer the candidate's own vocabulary.** Do not introduce job titles the
   candidate has never used to describe themselves.
5. **Never relax something the candidate marked as a hard requirement.** If
   the input marks a constraint as required — a work authorization, a remote
   requirement, a salary floor — it stays, it never appears in `relaxed`, and
   you say so in `rationale`.

## Input

Original search:

{{SEARCH}}

What came back:

{{RESULTS}}
