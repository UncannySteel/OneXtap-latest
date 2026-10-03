/**
 * What personalising a cover letter costs.
 *
 * One credit buys a personalisation plus COVER_LETTER_FREE_RERUNS free re-runs
 * of it: Answer Studio's rule (one credit buys an answer plus three
 * improvements), with one re-run instead of three. Premium never pays. The
 * credit itself is the server's: callers deduct through
 * creditManager.deductCredit() after a successful generation, as Answer
 * Studio does, and nothing here touches a balance (CLAUDE.md rule 6).
 *
 * A re-run is the same template aimed at the same job description again.
 * Editing the template, the company or the role does not make it a new
 * application; a different job description does. So the allowance is stored
 * on the template (`aiRerunsLeft`, `aiRerunKey`), keyed to the description it
 * was bought for, and travels with the template to the extension like the
 * rest of the profile.
 *
 * Shared by the dashboard's Cover Letter workspace and the popup's
 * CoverLetterPanel. Pure, with no imports, so `node --test` covers it
 * (test/credits/coverLetterCredits.test.js).
 */

/** Free re-runs one paid personalisation buys. */
export const COVER_LETTER_FREE_RERUNS = 1;

/** How much of a job description both front ends send as context. */
const DESCRIPTION_CHARS = 6000;

/**
 * Which application a personalisation is for: a short hash of the part of the
 * job description that is sent (its first DESCRIPTION_CHARS characters),
 * ignoring case and runs of whitespace, so the popup and the dashboard key the
 * same description alike. Not a security boundary: a re-run is worth less
 * than a credit, and the balance is the server's.
 * @param {string} description
 * @returns {string} Eight hex digits (FNV-1a, 32-bit).
 */
export function applicationKey(description) {
  const text = String(description || '').slice(0, DESCRIPTION_CHARS).toLowerCase().replace(/\s+/g, ' ').trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Whether personalising `template` for the application `key` spends a credit.
 * @param {{ premium: boolean, template: object|null|undefined, key: string }} args
 * @returns {boolean} False on Premium, and for a free re-run of the same
 *   template and description.
 */
export function consumesCredit({ premium, template, key }) {
  if (premium) return false;
  return !(template?.aiRerunKey === key && Number(template?.aiRerunsLeft) > 0);
}

/**
 * The allowance to store on the template after a successful personalisation.
 * @param {{ premium: boolean, charged: boolean, deducted: boolean,
 *   template: object|null|undefined, key: string }} args `charged`: this one
 *   spent a credit (consumesCredit() said so); `deducted`: the server
 *   confirmed the deduction. A charge the server did not confirm buys no
 *   re-run, as a failed deduction gives no improvements in Answer Studio.
 * @returns {{ aiRerunsLeft: number, aiRerunKey: string|null }}
 */
export function allowanceAfter({ premium, charged, deducted, template, key }) {
  if (premium) return { aiRerunsLeft: 0, aiRerunKey: null };
  if (charged) return { aiRerunsLeft: deducted ? COVER_LETTER_FREE_RERUNS : 0, aiRerunKey: key };
  return { aiRerunsLeft: Math.max(0, Number(template?.aiRerunsLeft || 0) - 1), aiRerunKey: key };
}
