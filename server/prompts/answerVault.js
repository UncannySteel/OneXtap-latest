/**
 * Prompt text for POST /api/answer-vault/generate (server/routes/generate.js):
 * the system instruction, the user message with its Improve block
 * ("EXISTING DRAFT (improve this)") and the rule that rides with it, and the
 * Improve guard's one retry turn.
 */

/** Top vault entries by word overlap with the application question (not full dump). */
export function pickRelevantAnswers(vaultAnswers, question) {
  const q = String(question || '').trim();
  const list = Array.isArray(vaultAnswers) ? vaultAnswers : [];
  if (!q) return '(No question provided.)';
  if (list.length === 0) return '(No saved answers in vault.)';

  const questionWords = new Set(
    q.toLowerCase().split(/\W+/).filter((w) => w.length > 4)
  );

  const scored = list.map((entry) => {
    const eq = String(entry?.question || '');
    const ea = String(entry?.answer || '');
    const entryWords = `${eq} ${ea}`.toLowerCase().split(/\W+/);
    const overlap = entryWords.filter((w) => questionWords.has(w)).length;
    return { question: eq, answer: ea, score: overlap };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((e) => `Q: ${e.question}\nA: ${e.answer}`)
    .join('\n\n');
}

export function buildGroqAnswerSystemInstruction(taskHint, styleHint) {
  const hints = [taskHint, styleHint].filter(Boolean);
  const hintBlock = hints.length
    ? `\n\nFollow for this request:\n${hints.map((h) => `- ${h}`).join('\n')}`
    : '';

  return `You are a job application assistant. Always write complete, polished answers in plain text only.
Never truncate. Never use "..." to stand in for content. Return only the answer text the employer should read—no headings, bullet lists, markdown, labels, or meta commentary.${hintBlock}

Rules:
- Answer the QUESTION in the user message directly; do not answer a different question.
- When job context is provided, tie concrete details to that role (tools, domain). Do not invent employer facts.
- First person ("I"); include specific examples and a measurable or observable result when consistent with context; never fabricate numbers.
- About 160–230 words unless the question clearly needs less.
- Never use placeholders like "company name" or "this role" as stand-ins.`;
}

/**
 * The rule an Improve request carries, under the draft it improves.
 *
 * Improve is where invented figures came from (HANDOVER §7 item 32: one run
 * took a draft from one claim the resume does not back to four). The client's
 * task hint asks for "one concrete example or outcome" and for numbers "when
 * truthful", and with nothing true to hand the model supplied its own. This
 * says what the model may add: wording, structure, relevance. Not facts. It is
 * stated as overriding the hints because the hints arrive first, in the system
 * turn, and read as permission.
 *
 * Naming the organisation and role the application is FOR is allowed: an
 * answer to "why do you want to work here?" has to name "here". What is
 * forbidden is claiming things about the candidate, and the job context's
 * requirements are what the employer wants, not evidence the candidate has
 * them.
 *
 * Answer Studio's Improve only (`improve` below). A cover letter's draft is
 * the user's template, and its task hint asks for the company, the role and
 * the posting's requirements by name; this rule would fight it.
 *
 * "PROFILE" is the resume as this request carries it; the fabrication check
 * behind this rule (server/lib/improveGuard.js) grounds against the resume
 * corpus, the draft, and the organisation and role lines of the job context,
 * the same sources named here.
 */
export const IMPROVE_FACTS_RULE = `When you improve the EXISTING DRAFT, keep its facts and improve how they are said. You may name the organisation and the role this application is for, as the JOB CONTEXT names them. Do not claim any experience, number, percentage, employer, job title, product or tool that appears in neither the PROFILE nor the EXISTING DRAFT: a requirement in the JOB CONTEXT is something the employer wants, not something the candidate has. This overrides any instruction above to add specifics, examples or measurable results: if the draft and the profile do not supply one, leave it out rather than invent it.`;

/**
 * The user message for a request that sends `question` (a `userPrompt` is
 * sent as it is).
 *
 * `improve` (Answer Studio's Improve: `kind: 'answer'` with a draft) adds
 * IMPROVE_FACTS_RULE after the draft. Without it the message is byte-identical
 * to what it was before the rule existed — cover letters, first drafts and
 * clients that send no `kind`.
 */
export function buildAnswerVaultUserContent({ relevantAnswers, profileBlock, jobContext, question, draft, improve = false }) {
  const improveRule = improve === true && draft ? `\n\n${IMPROVE_FACTS_RULE}` : '';
  return `
SAVED ANSWERS FOR CONTEXT:
${relevantAnswers}

${profileBlock}JOB CONTEXT:
${jobContext || 'Not provided'}

QUESTION:
${question}

EXISTING DRAFT (improve this):
${draft || 'None'}${improveRule}
`.trim();
}

/** Claims quoted back in a retry, and the characters kept of each. */
const RETRY_MAX_CLAIMS = 6;
const RETRY_CLAIM_CHARS = 300;

/**
 * The follow-up turn for the one retry the Improve guard may make
 * (server/lib/improveGuard.js). It follows the model's own first answer in the
 * conversation, so "your improved answer" is unambiguous.
 *
 * The claims are the model's own sentences from that answer, sent back to the
 * same model inside the same request. They are never logged.
 *
 * @param {string[]} claims Sentences from the first answer that neither the
 *   resume nor the draft backs.
 * @returns {string}
 */
export function buildImproveRetryMessage(claims) {
  const list = (Array.isArray(claims) ? claims : [])
    .map((claim) => String(claim || '').trim())
    .filter(Boolean)
    .slice(0, RETRY_MAX_CLAIMS)
    .map((claim) => `- "${claim.slice(0, RETRY_CLAIM_CHARS)}"`)
    .join('\n');

  return `These sentences in your improved answer state things that appear in neither the PROFILE nor the EXISTING DRAFT:
${list}

Rewrite the improved answer without those details. Do not replace them with other numbers, employers, job titles or tools. Keep everything that came from the profile or the draft, and you may still name the organisation and role this application is for. Keep the length and tone, and return only the answer text.`;
}
