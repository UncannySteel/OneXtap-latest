/**
 * Test fixtures. All company, product and person names are invented; there is
 * no PII here and none may be added.
 */

/** A full posting with the header structure the state machine keys off. */
export const FULL_JD = `Senior Backend Engineer at Norwick Labs

About the role
We are building the payments layer behind Norwick Pay and need someone to own it end to end.

Requirements:
Strong experience with Python and PostgreSQL in production.
5+ years building REST APIs at scale.
Hands-on with Docker and Kubernetes.
Solid understanding of system design and distributed systems.

Nice to have:
Exposure to Kafka and event driven architecture.
Familiarity with Terraform.
Some React for internal tooling.

Responsibilities
Design and ship services used by thousands of merchants.
Mentor engineers and run code review.

Benefits
Remote friendly, generous equipment budget.`;

/** Same posting delivered as HTML, the way most boards actually send it. */
export const HTML_JD = `<div class="jd"><h2>Requirements</h2><ul>
<li>Expertise in JavaScript &amp; TypeScript</li>
<li>Must have Node.js and C++ experience</li>
<li>Comfortable with C# &ndash; or willing to learn</li>
</ul><h2>Nice to have</h2><ul><li>Vue or React</li></ul></div>`;

/** Adzuna-style truncated description: ~200 characters, no headers at all. */
export const SNIPPET_JD = {
  title: 'Machine Learning Engineer, Platform',
  description:
    'Join the Kestrel Analytics platform team. You will build data pipelines and deploy models '
    + 'with Python and Docker, working closely with product to ship features that matter to our '
    + 'customers every single wee…',
  quality: 'snippet',
};

/** Remotive-style posting with curated tags. */
export const TAGGED_JD = {
  title: 'Frontend Developer',
  description: 'We need someone to own our web client. Requirements: solid React and CSS.',
  tags: ['React', 'TypeScript', 'Tailwind CSS'],
};

/** Synthetic CV. Invented employers, no real people. */
export const CV = {
  firstName: 'Ada',
  lastName: 'Tester',
  summary: 'Backend engineer focused on payments infrastructure and data pipelines.',
  skills: ['Python', 'PostgreSQL', 'Docker', 'K8s', 'REST APIs', 'System Design'],
  titles: ['Senior Backend Engineer', 'Backend Engineer'],
  yearsExperience: 7,
  experience: [
    {
      company: 'Norwick Labs',
      title: 'Senior Backend Engineer',
      startDate: '2021-03',
      endDate: null,
      description:
        'Led a team of 4 engineers rebuilding the payments ledger.\n'
        + 'Built REST APIs in Python serving 12 million requests per day.\n'
        + 'Migrated the deployment pipeline to Docker and Kubernetes.',
    },
    {
      company: 'Halbrook Systems',
      title: 'Backend Engineer',
      startDate: '2018-01',
      endDate: '2021-02',
      description: 'Maintained PostgreSQL schemas and query performance for the reporting service.',
    },
  ],
  education: [{ school: 'Fernwood University', degree: 'BSc', field: 'Computer Science' }],
  certificates: [{ name: 'Certified Kubernetes Administrator', issuer: 'Linux Foundation' }],
};

/** Raw text form of the CV above, for sourceSpan tests. */
export const CV_TEXT = [
  CV.summary,
  CV.experience[0].description,
  CV.experience[1].description,
].join('\n');
