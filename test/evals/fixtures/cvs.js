/**
 * Hand-labelled CV fixtures for the eval harness.
 *
 * EVERY NAME, EMPLOYER, SCHOOL, EMAIL AND PHONE NUMBER HERE IS INVENTED. There
 * is no PII in this directory and none may be added — these files are checked
 * into a public repo and get pasted into bug reports. Emails use the reserved
 * example.com / .net / .org domains and phone numbers use reserved 555 ranges
 * for the same reason.
 *
 * Each fixture carries three things:
 *
 *   cvText  the resume as plain text, the way it would arrive from a PDF
 *   labels  what a human says the correct extraction is — the ground truth
 *   parsed  a RECORDED parser output for that CV, in the schema
 *           /api/parse-resume returns
 *
 * `parsed` is a recording, not a live parse: extraction runs through Gemini,
 * and an eval that needs an API key is an eval nobody runs. The harness scores
 * the recording against the labels, which makes ProfileFieldAccuracy a
 * snapshot gate — it moves when someone re-records these after changing the
 * parser or the model. Two recordings carry deliberate, realistic parser
 * mistakes (a transposed phone digit, a dropped education field, a skill the
 * model missed) so the metric has a real number to report instead of a
 * tautological 1.0.
 */

/** Data engineer. Recorded parse drops `education[0].field`. */
export const CV_DATA_ENGINEER = {
  id: 'data-engineer',
  cvText: `Mira Kellwood
mira.kellwood@example.com · +1 (555) 0134 · Portland, OR

Summary
Data engineer building batch and streaming pipelines for retail analytics.

Experience
Senior Data Engineer at Vantridge Retail Group — 2021-04 to present
Rebuilt the nightly inventory pipeline, cutting its runtime from 6 hours to 40 minutes.
Owned the Airflow deployment running 180 scheduled DAGs.
Mentored 3 junior engineers through their first on-call rotation.

Data Engineer at Corrin Analytics — 2018-06 to 2021-03
Built ingestion jobs in Python for 12 partner data feeds.
Maintained the Snowflake warehouse used by the finance team.

Education
BSc in Computer Science, Ashmoor University

Certifications
AWS Certified Data Analytics, Amazon Web Services

Skills
Python, SQL, Airflow, Snowflake, dbt, Kafka`,

  labels: {
    firstName: 'Mira',
    lastName: 'Kellwood',
    email: 'mira.kellwood@example.com',
    phone: '+1 (555) 0134',
    currentJob: { title: 'Senior Data Engineer' },
    experience: [{
      company: 'Vantridge Retail Group',
      title: 'Senior Data Engineer',
      startDate: '2021-04',
      endDate: '',
    }],
    education: [{ school: 'Ashmoor University', degree: 'BSc', field: 'Computer Science' }],
    skills: ['Python', 'SQL', 'Airflow', 'Snowflake', 'dbt', 'Kafka'],
  },

  parsed: {
    firstName: 'Mira',
    lastName: 'Kellwood',
    email: 'mira.kellwood@example.com',
    phone: '+1 (555) 0134',
    summary: 'Data engineer building batch and streaming pipelines for retail analytics.',
    currentJob: { company: 'Vantridge Retail Group', title: 'Senior Data Engineer' },
    experience: [
      {
        company: 'Vantridge Retail Group',
        title: 'Senior Data Engineer',
        startDate: '2021-04',
        endDate: '',
        description:
          'Rebuilt the nightly inventory pipeline, cutting its runtime from 6 hours to 40 minutes.\n'
          + 'Owned the Airflow deployment running 180 scheduled DAGs.\n'
          + 'Mentored 3 junior engineers through their first on-call rotation.',
      },
      {
        company: 'Corrin Analytics',
        title: 'Data Engineer',
        startDate: '2018-06',
        endDate: '2021-03',
        description:
          'Built ingestion jobs in Python for 12 partner data feeds.\n'
          + 'Maintained the Snowflake warehouse used by the finance team.',
      },
    ],
    // The model returned the degree but not the subject — a common failure on
    // one-line education entries.
    education: [{ school: 'Ashmoor University', degree: 'BSc', field: '' }],
    certificates: [{ name: 'AWS Certified Data Analytics', issuer: 'Amazon Web Services' }],
    skills: ['Python', 'SQL', 'Airflow', 'Snowflake', 'dbt', 'Kafka'],
  },
};

/** Frontend engineer. Recorded parse transposes a phone digit and misses a skill. */
export const CV_FRONTEND = {
  id: 'frontend',
  cvText: `Tomas Hargreave
t.hargreave@example.net | (555) 0177 | Leeds, UK

Profile
Frontend engineer focused on design systems and accessibility.

Experience
Frontend Engineer, Bellcastle Media (2020-09 to present)
Shipped a component library now used by 9 product teams.
Raised Lighthouse accessibility scores from 71 to 96 across the marketing site.
Led the migration from Webpack to Vite.

Junior Developer, Ovenfield Studio (2018-02 to 2020-08)
Built landing pages and email templates for 20 client campaigns.

Education
BA in Graphic Communication, Northwarren College

Skills
React, TypeScript, CSS, Vite, Storybook, Accessibility`,

  labels: {
    firstName: 'Tomas',
    lastName: 'Hargreave',
    email: 't.hargreave@example.net',
    phone: '(555) 0177',
    currentJob: { title: 'Frontend Engineer' },
    experience: [{
      company: 'Bellcastle Media',
      title: 'Frontend Engineer',
      startDate: '2020-09',
      endDate: '',
    }],
    education: [{ school: 'Northwarren College', degree: 'BA', field: 'Graphic Communication' }],
    skills: ['React', 'TypeScript', 'CSS', 'Vite', 'Storybook', 'Accessibility'],
  },

  parsed: {
    firstName: 'Tomas',
    lastName: 'Hargreave',
    email: 't.hargreave@example.net',
    // Transposed digits — the classic OCR-ish failure on a phone line.
    phone: '(555) 0117',
    summary: 'Frontend engineer focused on design systems and accessibility.',
    currentJob: { company: 'Bellcastle Media', title: 'Frontend Engineer' },
    experience: [
      {
        company: 'Bellcastle Media',
        title: 'Frontend Engineer',
        startDate: '2020-09',
        endDate: '',
        description:
          'Shipped a component library now used by 9 product teams.\n'
          + 'Raised Lighthouse accessibility scores from 71 to 96 across the marketing site.\n'
          + 'Led the migration from Webpack to Vite.',
      },
      {
        company: 'Ovenfield Studio',
        title: 'Junior Developer',
        startDate: '2018-02',
        endDate: '2020-08',
        description: 'Built landing pages and email templates for 20 client campaigns.',
      },
    ],
    education: [{ school: 'Northwarren College', degree: 'BA', field: 'Graphic Communication' }],
    certificates: [],
    // "Storybook" was dropped.
    skills: ['React', 'TypeScript', 'CSS', 'Vite', 'Accessibility'],
  },
};

/** Operations lead. Recorded parse is clean — the harness needs a 1.0 case too. */
export const CV_OPERATIONS = {
  id: 'operations',
  cvText: `Anouk Delaris
anouk.delaris@example.org • (555) 0192 • Lyon, France

Summary
Operations lead for marketplace logistics, focused on supplier onboarding.

Experience
Operations Lead at Pellorin Marketplace — 2022-01 to present
Onboarded 48 suppliers in the first year without adding headcount.
Cut average dispute resolution time from 9 days to 4 days.

Operations Analyst at Grendale Freight — 2019-05 to 2021-12
Reconciled shipment exceptions across 5 regional carriers.

Education
MSc in Supply Chain Management, Trevanne Business School

Skills
Supplier onboarding, SQL, Process design, Looker, Logistics`,

  labels: {
    firstName: 'Anouk',
    lastName: 'Delaris',
    email: 'anouk.delaris@example.org',
    phone: '(555) 0192',
    currentJob: { title: 'Operations Lead' },
    experience: [{
      company: 'Pellorin Marketplace',
      title: 'Operations Lead',
      startDate: '2022-01',
      endDate: '',
    }],
    education: [{ school: 'Trevanne Business School', degree: 'MSc', field: 'Supply Chain Management' }],
    skills: ['Supplier onboarding', 'SQL', 'Process design', 'Looker', 'Logistics'],
  },

  parsed: {
    firstName: 'Anouk',
    lastName: 'Delaris',
    email: 'anouk.delaris@example.org',
    phone: '(555) 0192',
    summary: 'Operations lead for marketplace logistics, focused on supplier onboarding.',
    currentJob: { company: 'Pellorin Marketplace', title: 'Operations Lead' },
    experience: [
      {
        company: 'Pellorin Marketplace',
        title: 'Operations Lead',
        startDate: '2022-01',
        endDate: '',
        description:
          'Onboarded 48 suppliers in the first year without adding headcount.\n'
          + 'Cut average dispute resolution time from 9 days to 4 days.',
      },
      {
        company: 'Grendale Freight',
        title: 'Operations Analyst',
        startDate: '2019-05',
        endDate: '2021-12',
        description: 'Reconciled shipment exceptions across 5 regional carriers.',
      },
    ],
    education: [{ school: 'Trevanne Business School', degree: 'MSc', field: 'Supply Chain Management' }],
    certificates: [],
    skills: ['Supplier onboarding', 'SQL', 'Process design', 'Looker', 'Logistics'],
  },
};

export const CVS = [CV_DATA_ENGINEER, CV_FRONTEND, CV_OPERATIONS];

/** @param {string} id @returns {typeof CV_DATA_ENGINEER} */
export function cvById(id) {
  const found = CVS.find((cv) => cv.id === id);
  if (!found) throw new Error(`No CV fixture named "${id}"`);
  return found;
}
