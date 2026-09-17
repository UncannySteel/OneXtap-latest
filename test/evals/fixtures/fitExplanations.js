/**
 * Fixtures for the FitExplanationQuality eval.
 *
 * Each entry is a job the ranker might surface, the candidate it was surfaced
 * for, and the one-paragraph "why this fits you" the product shows next to the
 * score. `label` is the human verdict:
 *
 *   good  specific, grounded in this candidate's actual resume, honest about
 *         the gap where there is one
 *   poor  the failure modes that make a ranked list worthless — prose that
 *         would fit any candidate, flattery with no evidence, or a claim the
 *         resume does not support
 *
 * Invented employers and people only; see the header of ./cvs.js.
 */

/** @type {Array<{id: string, cv: string, job: {title: string, company: string, description: string}, explanation: string, label: 'good'|'poor', why: string}>} */
export const FIT_EXPLANATIONS = [
  {
    id: 'de-good',
    cv: 'data-engineer',
    job: {
      title: 'Staff Data Engineer',
      company: 'Harrowgate Logistics',
      description:
        'Own our batch and streaming pipelines. Heavy Airflow and Snowflake. '
        + 'You will lead the migration of nightly jobs onto dbt and mentor two engineers.',
    },
    explanation:
      'You already run the Airflow deployment behind 180 scheduled DAGs and rebuilt a nightly '
      + 'pipeline from six hours to forty minutes, which is the same job this role describes. '
      + 'Snowflake and dbt are both on your resume. The one stretch is scope: this is a staff '
      + 'role leading two engineers, and your mentoring so far has been three juniors on-call '
      + 'rather than formal reports.',
    label: 'good',
    why: 'Cites specific resume evidence, names the gap instead of hiding it.',
  },
  {
    id: 'de-poor-generic',
    cv: 'data-engineer',
    job: {
      title: 'Staff Data Engineer',
      company: 'Harrowgate Logistics',
      description:
        'Own our batch and streaming pipelines. Heavy Airflow and Snowflake. '
        + 'You will lead the migration of nightly jobs onto dbt and mentor two engineers.',
    },
    explanation:
      'This is an excellent match for your background. Your skills and experience align well '
      + 'with what the team is looking for, and you would bring a lot of value to this role. '
      + 'It is a great opportunity to grow your career.',
    label: 'poor',
    why: 'Fits any candidate and any job; cites nothing.',
  },
  {
    id: 'fe-good',
    cv: 'frontend',
    job: {
      title: 'Design Systems Engineer',
      company: 'Calderwood Health',
      description:
        'Maintain and extend our component library across six product teams. '
        + 'Accessibility is a hard requirement — we ship to public-sector customers.',
    },
    explanation:
      'You shipped a component library used by nine product teams and raised Lighthouse '
      + 'accessibility scores from 71 to 96, which maps directly onto the accessibility bar '
      + 'this role sets. Your Vite migration is relevant to their build work. Nothing on your '
      + 'resume covers public-sector compliance specifically, so expect that to come up.',
    label: 'good',
    why: 'Concrete, grounded, honest about what is missing.',
  },
  {
    id: 'fe-poor-unsupported',
    cv: 'frontend',
    job: {
      title: 'Design Systems Engineer',
      company: 'Calderwood Health',
      description:
        'Maintain and extend our component library across six product teams. '
        + 'Accessibility is a hard requirement — we ship to public-sector customers.',
    },
    explanation:
      'Your years leading accessibility strategy for healthcare clients and your track record '
      + 'managing a team of twelve frontend engineers make you an obvious fit for this role.',
    label: 'poor',
    why: 'Invents a healthcare background and a team of twelve; neither is on the resume.',
  },
  {
    id: 'ops-good',
    cv: 'operations',
    job: {
      title: 'Supplier Operations Manager',
      company: 'Nordhall Marketplace',
      description:
        'Own supplier onboarding for a growing marketplace. Reduce dispute resolution times '
        + 'and build the reporting the commercial team runs on. SQL required.',
    },
    explanation:
      'Supplier onboarding is the centre of your current role — you brought on 48 suppliers in '
      + 'a year without adding headcount — and you already cut dispute resolution from nine days '
      + 'to four, which is the second thing this posting asks for. SQL and Looker are both on '
      + 'your resume, so the reporting side is covered.',
    label: 'good',
    why: 'Every claim traces to a resume bullet.',
  },
  {
    id: 'ops-poor-flattery',
    cv: 'operations',
    job: {
      title: 'Supplier Operations Manager',
      company: 'Nordhall Marketplace',
      description:
        'Own supplier onboarding for a growing marketplace. Reduce dispute resolution times '
        + 'and build the reporting the commercial team runs on. SQL required.',
    },
    explanation:
      'You are a highly motivated operations professional with a passion for logistics. '
      + 'Nordhall Marketplace is a fast-growing company and you would thrive there.',
    label: 'poor',
    why: 'Flattery about the company, no evidence about the candidate.',
  },
];

export const GOOD_EXPLANATIONS = FIT_EXPLANATIONS.filter((f) => f.label === 'good');
export const POOR_EXPLANATIONS = FIT_EXPLANATIONS.filter((f) => f.label === 'poor');
