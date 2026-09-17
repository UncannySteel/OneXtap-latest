/**
 * Application type configuration — controls labels and visible features
 * in the dashboard and extension popup.
 *
 * Every type must declare every `features` key. A missing key reads as
 * `undefined`, which is falsy, so a forgotten flag silently hides a tab rather
 * than failing loudly — `jobMatches` is the flag most recently added, and it is
 * false for college and scholarship because the ranked pool holds job postings
 * only. Nav filtering and the fallback to Overview live in DashboardView.
 */
export const DEFAULT_APPLICATION_TYPE = 'job';

export const APPLICATION_TYPES = [
  {
    id: 'job',
    label: 'Job',
    shortLabel: 'Job',
    description: 'Job applications, cover letters, and role-specific answers.',
    features: { profiles: true, vault: true, coverLetter: true, autofill: true, jobMatches: true },
    coverLetterLabel: 'Cover Letter',
    vaultLabel: 'Answer Studio',
    documentLabel: 'Cover letters',
  },
  {
    id: 'college',
    label: 'College / University',
    shortLabel: 'College',
    description: 'Undergraduate and graduate school applications.',
    features: { profiles: true, vault: true, coverLetter: true, autofill: true, jobMatches: false },
    coverLetterLabel: 'Personal Statement',
    vaultLabel: 'Application Essays',
    documentLabel: 'Personal statements',
  },
  {
    id: 'scholarship',
    label: 'Scholarship',
    shortLabel: 'Scholarship',
    description: 'Scholarship essays, statements, and supporting documents.',
    features: { profiles: true, vault: true, coverLetter: true, autofill: true, jobMatches: false },
    coverLetterLabel: 'Scholarship Essay',
    vaultLabel: 'Essay Answers',
    documentLabel: 'Essays',
  },
  {
    id: 'internship',
    label: 'Internship',
    shortLabel: 'Internship',
    description: 'Internship applications with tailored cover letters.',
    features: { profiles: true, vault: true, coverLetter: true, autofill: true, jobMatches: true },
    coverLetterLabel: 'Cover Letter',
    vaultLabel: 'Answer Studio',
    documentLabel: 'Cover letters',
  },
];

export function getApplicationTypeConfig(typeId) {
  return APPLICATION_TYPES.find((t) => t.id === typeId) || APPLICATION_TYPES[0];
}
