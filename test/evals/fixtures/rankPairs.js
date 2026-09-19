/**
 * Hand-labelled (candidate, job) pairs for RankCalibration.
 *
 * EVERY COMPANY NAME HERE IS INVENTED, for the same reason given in cvs.js:
 * this directory is checked into a public repo and gets pasted into bug
 * reports. The candidate profiles are the ones from cvs.js, reduced to the
 * shape the rank prompt actually receives (see promptProfile in
 * server/jobs/rank.js) — skills, titles, seniority, years.
 *
 * ═══ WHAT `band` IS, AND WHAT IT IS NOT ═══
 *
 * `band` is a human judgement about the FIT, written against the band table in
 * server/jobs/prompts/rank.md. It is NOT a recording of what any model said,
 * and it must never be replaced by one — the entire point of this fixture is
 * to be an opinion that a model can be wrong about. If a model disagrees with a
 * band here, the first question is whether the band is right, and the second is
 * whether the prompt is clear. "The model said 62 so the band is 55-69" makes
 * the eval agree with itself forever.
 *
 * The bands are also deliberately SPREAD. A fixture where every job is a good
 * match cannot detect a model that returns 80 for everything, which is the
 * most common calibration failure there is.
 *
 * ═══ WHY BANDS AND NOT EXACT SCORES ═══
 *
 * Nobody can hand-label "this job is a 74". A band is a claim a human can
 * actually defend, and it is the resolution the product needs: the graph gates
 * at GOOD_SCORE and the user filters at 50/70/85, so what matters is which side
 * of those lines a job lands on, not its second digit.
 */

/** The five bands from rank.md, as inclusive [min, max] score ranges. */
export const BANDS = Object.freeze({
  strong: [85, 100],
  good: [70, 84],
  partial: [55, 69],
  weak: [35, 54],
  poor: [0, 34],
});

/** Midpoint of a band, used only for reporting mean absolute error. */
export function bandMid(band) {
  const [lo, hi] = BANDS[band];
  return Math.round((lo + hi) / 2);
}

/** Is `score` inside `band`? */
export function inBand(score, band) {
  const [lo, hi] = BANDS[band];
  return Number.isFinite(score) && score >= lo && score <= hi;
}

const job = (jobId, title, company, keywordTerms, requirements, extra = {}) => ({
  jobId,
  id: jobId,
  source: 'fixture',
  title,
  company,
  location: extra.location ?? 'Remote',
  isRemote: extra.isRemote ?? true,
  jobType: 'permanent',
  postedAt: '2026-08-01T00:00:00.000Z',
  descriptionQuality: extra.descriptionQuality ?? 'full',
  keywordTerms,
  requirements,
});

/**
 * Data engineer — Airflow, Spark, Python, dbt, Snowflake; ~7 years, senior.
 * Matches CV_DATA_ENGINEER in cvs.js.
 */
export const DATA_ENGINEER_PAIRS = {
  cvId: 'data-engineer',
  profile: {
    skills: ['python', 'airflow', 'spark', 'dbt', 'snowflake', 'sql', 'kafka', 'aws'],
    titles: ['Senior Data Engineer', 'Data Engineer'],
    seniority: 3,
    yearsExperience: 7,
  },
  jobs: [
    {
      band: 'strong',
      why: 'Same role, same stack, same seniority; every must-have is evidenced.',
      job: job('fixture:de-1', 'Senior Data Engineer', 'Vantridge Analytics',
        ['python', 'airflow', 'spark', 'dbt', 'snowflake', 'sql'],
        ['5+ years building data pipelines', 'Production Airflow ownership', 'Strong SQL']),
    },
    {
      band: 'good',
      why: 'Role and core stack match; the streaming and Terraform asks are nice-to-haves the CV does not cover.',
      job: job('fixture:de-2', 'Data Platform Engineer', 'Corsley Data Works',
        ['python', 'sql', 'airflow', 'kafka', 'terraform', 'kubernetes'],
        ['4+ years data engineering', 'Batch and streaming pipelines', 'Terraform a plus']),
    },
    {
      band: 'partial',
      why: 'Adjacent analytics role: SQL and Python carry over, but it is a BI-tooling job and the CV has no Looker/Tableau.',
      job: job('fixture:de-3', 'Analytics Engineer', 'Hallowfield Retail',
        ['sql', 'dbt', 'looker', 'tableau', 'python'],
        ['Own the BI semantic layer', 'Looker or Tableau in production', '3+ years analytics']),
    },
    {
      band: 'weak',
      why: 'Backend role sharing only Python and AWS; no data-pipeline work at all.',
      job: job('fixture:de-4', 'Backend Engineer, Payments', 'Northbeck Financial',
        ['python', 'django', 'postgresql', 'aws', 'rest api'],
        ['4+ years backend web services', 'Payment integrations', 'Django or Flask']),
    },
    {
      band: 'poor',
      why: 'Different discipline entirely; the only overlap is the word "senior".',
      job: job('fixture:de-5', 'Senior UX Designer', 'Brightloom Studio',
        ['figma', 'user research', 'prototyping', 'design systems'],
        ['5+ years product design', 'Portfolio required', 'Figma expertise'],
        { isRemote: false, location: 'Austin, TX' }),
    },
  ],
};

/**
 * Frontend engineer — React, TypeScript, CSS, testing; ~4 years, mid.
 * Matches CV_FRONTEND in cvs.js.
 */
export const FRONTEND_PAIRS = {
  cvId: 'frontend',
  profile: {
    skills: ['react', 'typescript', 'javascript', 'css', 'jest', 'accessibility', 'next.js'],
    titles: ['Frontend Engineer', 'UI Engineer'],
    seniority: 2,
    yearsExperience: 4,
  },
  jobs: [
    {
      band: 'strong',
      why: 'Exact role and stack at the candidate\'s own level.',
      job: job('fixture:fe-1', 'Frontend Engineer', 'Pellamont Software',
        ['react', 'typescript', 'css', 'jest', 'accessibility'],
        ['3+ years React', 'Strong TypeScript', 'Cares about accessibility']),
    },
    {
      band: 'partial',
      why: 'Right stack, but a staff-level posting against a mid-level profile — a real seniority gap, per scoring rule 5.',
      job: job('fixture:fe-2', 'Staff Frontend Engineer', 'Ordwell Systems',
        ['react', 'typescript', 'graphql', 'micro-frontends'],
        ['8+ years frontend', 'Has led a platform migration', 'Mentors staff engineers']),
    },
    {
      band: 'weak',
      why: 'Full-stack role where the backend half — Go, Postgres — is unevidenced.',
      job: job('fixture:fe-3', 'Full Stack Engineer', 'Kestrelane Health',
        ['react', 'go', 'postgresql', 'docker', 'grpc'],
        ['Comfortable across the stack', 'Go services in production', '4+ years']),
    },
    {
      band: 'poor',
      why: 'Native mobile; React Native is not React, and nothing else carries.',
      job: job('fixture:fe-4', 'iOS Engineer', 'Tamblin Mobile',
        ['swift', 'swiftui', 'xcode', 'core data'],
        ['3+ years shipping iOS apps', 'Swift and SwiftUI', 'App Store release experience']),
    },
  ],
};

/**
 * Operations manager — a deliberately non-engineering profile, because a
 * ranker that only ever sees software CVs is untested against the case where
 * the whole pool is a mismatch.
 */
export const OPERATIONS_PAIRS = {
  cvId: 'operations',
  profile: {
    skills: ['operations management', 'vendor negotiation', 'logistics', 'excel', 'process improvement'],
    titles: ['Operations Manager'],
    seniority: 3,
    yearsExperience: 9,
  },
  jobs: [
    {
      band: 'strong',
      why: 'Same role, same domain, comfortably past the years bar.',
      job: job('fixture:ops-1', 'Operations Manager', 'Girvanwood Distribution',
        ['operations management', 'logistics', 'vendor management', 'process improvement'],
        ['7+ years operations', 'Vendor negotiation', 'Warehouse or logistics background'],
        { isRemote: false, location: 'Columbus, OH' }),
    },
    {
      band: 'partial',
      why: 'Related discipline with genuine overlap, but supply-chain planning tooling is not evidenced.',
      job: job('fixture:ops-2', 'Supply Chain Analyst', 'Merrowfield Foods',
        ['supply chain', 'excel', 'forecasting', 'sap', 'logistics'],
        ['Demand forecasting', 'SAP or similar ERP', '4+ years supply chain'],
        { isRemote: false, location: 'Columbus, OH' }),
    },
    {
      band: 'poor',
      why: 'Engineering role against a non-engineering profile. A ranker that scores this above the weak band is not reading the profile.',
      job: job('fixture:ops-3', 'Senior Software Engineer', 'Alderbrook Labs',
        ['java', 'spring', 'kubernetes', 'microservices'],
        ['6+ years backend engineering', 'JVM services at scale', 'Distributed systems']),
    },
  ],
};

export const RANK_PAIRS = [DATA_ENGINEER_PAIRS, FRONTEND_PAIRS, OPERATIONS_PAIRS];

/** Every (job, band) across all profiles — handy for corpus-wide assertions. */
export const ALL_PAIRS = RANK_PAIRS.flatMap((set) =>
  set.jobs.map((entry) => ({ cvId: set.cvId, ...entry }))
);
