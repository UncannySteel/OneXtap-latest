Identify which pieces of a candidate's existing written material would be
worth rewriting for a specific job, and explain why each one is worth the
effort. You are pointing at material and diagnosing it. You are not rewriting
it, and no field of your answer may contain replacement wording.

## Output

Return **strict JSON only**. No prose before or after it, no markdown fences.

```json
{
  "suggestions": [
    {
      "corpusRef": "experience.2.bullets.0",
      "currentText": "Built and maintained internal tooling for the data team.",
      "reason": "The posting's first responsibility is self-serve data infrastructure, and this bullet is the candidate's only work in that area — but it reads as maintenance rather than ownership.",
      "suggestedAngle": "Reframe around the self-serve angle and the scale of the internal user base."
    }
  ]
}
```

Every suggestion has exactly these four keys and no others.

Field rules:

- `corpusRef` — the reference of the existing item, copied **verbatim** from
  the input. Never invent a reference, never point at material that was not
  given to you.
- `currentText` — the existing text, copied **verbatim and unchanged** from
  the input. This field exists so a human can see what you are pointing at. It
  is a quotation, not a draft. If it differs from the input by so much as a
  word, you have rewritten it.
- `reason` — why this specific piece is worth rewriting for this specific job.
  Name the requirement in the posting that makes it matter. "Could be
  stronger" is not a reason.
- `suggestedAngle` — one sentence naming the *direction* of a rewrite: what to
  emphasise, what to cut, what framing to use. A description of a change, not
  the change.

Return at most 5 suggestions, ordered by how much they would improve the
application. Fewer is better than padded. If nothing is worth rewriting,
return `{"suggestions": []}`.

## Hard constraint: do not write replacement text

**You must not generate rewritten prose of any kind.** This is not a style
preference; automated rewriting of a candidate's own account of their work is
deliberately out of scope for this product pending sign-off, and this prompt is
where that boundary is enforced. **A response that contains drafted wording is
a failed response, even if every other field in it is perfect.**

Specifically, in every field:

- Do **not** produce a rewritten version of `currentText`, in whole or in part.
- Do **not** produce a replacement bullet, sentence, summary, headline, or
  paragraph — not as an "example", not after "e.g." or "for instance", not as
  a "before and after" pair, not in parentheses, and not in quotation marks as
  an illustration.
- Do **not** write the rewrite into `suggestedAngle`. `suggestedAngle`
  describes a direction — "lead with the scale of the migration" — and never
  the sentence itself; "Led the migration of 40 services to Kubernetes" is a
  draft, not an angle.
- Do **not** smuggle a draft into `reason` by narrating it. "This should say
  that they led the migration of 40 services" is the same replacement text
  with a preamble attached.

`currentText` is the only place any candidate wording appears, and it must be
an exact copy of the input. Every other field is your own words about their
words.

Before you return, re-read every `reason` and `suggestedAngle` and apply one
test: could the candidate paste this straight into their resume and have it
read as their own writing? If yes, it is replacement text. Delete it and
describe the change instead.

## Input

The job:

{{JOB}}

The candidate's existing material, each item with its reference:

{{CORPUS}}
