// Navigation + workspace registry. Add a workspace here and it appears on
// the dashboard, in the dock list, and gets a route at #/<id>; its view is
// the module of the same id in js/ws/ (see js/workspaces.js).

export const overview = { id: 'overview', label: 'Overview', icon: 'overview' };

export const workspaces = [
  {
    id: 'job-matches',
    label: 'Job Matches',
    icon: 'briefcase',
    description: 'Roles matched to your resume, ranked by fit.',
  },
  {
    id: 'my-profiles',
    label: 'My Profiles',
    icon: 'user',
    description: 'The details autofill uses: who you are, where you have worked, what you know.',
  },
  {
    id: 'answer-studio',
    label: 'Answer Studio',
    icon: 'pen',
    description: 'Draft and save answers to common application questions.',
  },
  {
    id: 'cover-letter',
    label: 'Cover Letter',
    icon: 'file',
    description: 'Cover letters tailored to each application.',
  },
];

// Links from outside the dashboard name a workspace the old way: the
// extension popup opens it with ?view=vault / cover / jobs / profiles.
export const legacyViews = {
  jobs: 'job-matches',
  profiles: 'my-profiles',
  vault: 'answer-studio',
  cover: 'cover-letter',
};

// Plans, as the landing page prices them (web/src/features/pricing, where they
// are "Free" and "Premium"). `id` is what services.js reports as user.plan.
// Only what the product actually does: the plans differ in the AI's credit
// limit and nothing else.
export const plans = [
  {
    id: 'standard',
    name: 'Standard',
    price: '$0',
    period: 'forever',
    features: ['Unlimited autofill applications', '3 AI credits for written answers, cover letters and fit explanations', 'Profiles and answers kept on your device'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$5',
    period: 'per month',
    features: ['Unlimited AI answers and cover letters', 'Unlimited fit explanations on job matches', 'Cancel anytime, it runs to the end of your month'],
  },
];
