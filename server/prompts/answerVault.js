/**
 * Prompt text for POST /api/answer-vault/generate (server/routes/generate.js):
 * the system instruction, and the user message with its Improve block
 * ("EXISTING DRAFT (improve this)").
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
 * The user message for a request that sends `question` (a `userPrompt` is
 * sent as it is).
 */
export function buildAnswerVaultUserContent({ relevantAnswers, profileBlock, jobContext, question, draft }) {
  return `
SAVED ANSWERS FOR CONTEXT:
${relevantAnswers}

${profileBlock}JOB CONTEXT:
${jobContext || 'Not provided'}

QUESTION:
${question}

EXISTING DRAFT (improve this):
${draft || 'None'}
`.trim();
}
