/**
 * Autofill Section Definitions
 *
 * The autofill panel's section list — label and icon per section — plus the
 * default on/off state for each. `AUTOFILL_SECTION_META` fixes the display
 * order; `DEFAULT_SECTION_TOGGLES` is keyed by the same `key` values, so a
 * section added to one belongs in the other.
 */
export const AUTOFILL_SECTION_META = [
  { key: 'personalInfo', label: 'Personal Info', icon: '👤' },
  { key: 'education', label: 'Education', icon: '🎓' },
  { key: 'workExperience', label: 'Work Experience', icon: '💼' },
  { key: 'openEnded', label: 'Open-ended Answers', icon: '💬' },
  { key: 'coverLetter', label: 'Cover Letter', icon: '📄' },
];

export const DEFAULT_SECTION_TOGGLES = {
  personalInfo: true,
  education: true,
  workExperience: true,
  openEnded: true,
  coverLetter: true,
};
