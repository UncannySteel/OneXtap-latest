/**
 * Answer Studio Constants
 *
 * Style presets and timeout budgets shared by the AI answer flows. The
 * style options drive the picker; the instructions are the prompt text
 * handed to the model for the selected style, so the two maps are keyed
 * together and must stay in sync.
 *
 * `withTimeout` races any promise against a rejection, used to bound the
 * AI, extension-scrape and credit-API calls above.
 */
export const ANSWER_STYLE_OPTIONS = [
  { value: 'balanced', label: 'Balanced & professional' },
  { value: 'impact', label: 'Impact-driven' },
  { value: 'technical', label: 'Technical depth' },
  { value: 'leadership', label: 'Leadership & ownership' },
];
export const ANSWER_STYLE_INSTRUCTIONS = {
  balanced: 'Balanced and professional: confident, clear, and credible.',
  impact: 'Impact-driven: emphasize outcomes, business value, and measurable results.',
  technical: 'Technical depth: highlight tools, systems, and practical execution detail.',
  leadership: 'Leadership and ownership: show initiative, decision-making, and collaboration.',
};
export const AI_TIMEOUT_SEC = 90;
export const EXTENSION_SCRAPE_TIMEOUT_MS = 10000;
export const CREDIT_API_TIMEOUT_MS = 10000;

export const withTimeout = (promise, ms, message) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
