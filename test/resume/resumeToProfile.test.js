import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_PROFILE, emptyEducation, emptyExperience, emptyCertificate } from '../../src/profileDefaults.js';
import { mergeParsedResumeIntoProfile, normalizeParsedResume } from '../../src/resumeToProfile.js';

/**
 * resumeToProfile — the parser/editor translation layer.
 *
 * ═══ WHERE THE FIXTURE COMES FROM ═══
 *
 * PARSED below is not hand-written. It is the verbatim `data` object returned
 * by POST /api/parse-resume for a one-page resume stating every field the
 * editor renders — captured from a live gemini-2.5-flash call while isolating
 * the bug this module fixes. Keeping the real shape matters: the whole defect
 * was that nobody had compared the parser's key names against the editor's,
 * so a fixture written from the editor's side would have tested nothing.
 *
 * The companion assertion is the count at the bottom: the same merge left 17
 * of 38 editor fields blank before this module existed.
 */
const PARSED = {
  firstName: 'JORDAN',
  lastName: 'RIVERA',
  email: 'jordan.rivera@example.com',
  phone: '(510) 555-0147',
  address: {
    street: '1180 Fairmount Avenue, Apt 4B',
    city: 'Oakland',
    state: 'CA',
    zip: '94610',
    country: '',
  },
  education: [
    {
      school: 'University of California, Davis',
      degree: 'B.S.',
      field: 'Computer Science',
      startDate: 'September 2015',
      endDate: 'June 2019',
      gpa: '3.74',
    },
  ],
  experience: [
    {
      company: 'Pellorin Marketplace',
      title: 'Senior Backend Engineer',
      startDate: 'March 2022',
      endDate: 'Present',
      description: 'Led the migration of the settlement pipeline to event sourcing.',
    },
    {
      company: 'Havenlight Systems',
      title: 'Backend Engineer',
      startDate: 'June 2019',
      endDate: 'February 2022',
      description: 'Built the invoicing service handling 40k requests/day.',
    },
  ],
  skills: ['Python', 'Go', 'PostgreSQL'],
  urls: [
    { type: 'linkedin', value: 'linkedin.com/in/jordanrivera' },
    { type: 'github', value: 'github.com/jrivera-dev' },
  ],
  certificates: [
    { name: 'AWS Certified Solutions Architect', issuer: 'Amazon Web Services', date: 'March 2023' },
  ],
  currentJob: { company: 'Pellorin Marketplace', title: 'Senior Backend Engineer' },
};

/** A pristine starting profile, as a freshly loaded editor holds one. */
const blank = () => structuredClone(DEFAULT_PROFILE);

// ------------------------------------------------------------------
// The renames — the seven fields that used to vanish
// ------------------------------------------------------------------

test('renamed keys reach the fields the editor actually renders', () => {
  const next = mergeParsedResumeIntoProfile(blank(), PARSED);

  assert.equal(next.address.addressLine1, '1180 Fairmount Avenue, Apt 4B', 'street → addressLine1');
  assert.equal(next.address.postalCode, '94610', 'zip → postalCode');
  assert.equal(next.education[0].start, 'September 2015', 'education startDate → start');
  assert.equal(next.education[0].end, 'June 2019', 'education endDate → end');
  assert.equal(next.education[0].cgpa, '3.74', 'education gpa → cgpa');
  assert.equal(next.experience[0].start, 'March 2022', 'experience startDate → start');
  assert.equal(next.experience[0].end, 'Present', 'experience endDate → end');
});

test('experience rows keep both date spellings, because corpus.js reads startDate', () => {
  const next = mergeParsedResumeIntoProfile(blank(), PARSED);
  assert.equal(next.experience[0].startDate, 'March 2022');
  assert.equal(next.experience[0].endDate, 'Present');
});

// ------------------------------------------------------------------
// Rows are complete — the uncontrolled-input bug
// ------------------------------------------------------------------

test('every row carries every key the editor renders', () => {
  const next = mergeParsedResumeIntoProfile(blank(), PARSED);

  for (const [section, template] of [
    ['education', emptyEducation()],
    ['experience', emptyExperience()],
    ['certificates', emptyCertificate()],
  ]) {
    for (const row of next[section]) {
      for (const key of Object.keys(template)) {
        assert.notEqual(
          row[key], undefined,
          `${section} row is missing "${key}" — React would flip that input to uncontrolled`,
        );
      }
    }
  }
});

test('rows saved by an older build are repaired on the next upload', () => {
  const stale = blank();
  // What a pre-fix profile holds: parser rows written straight to state.
  stale.education = [{ school: 'Old School', degree: 'B.A.', startDate: '2010', gpa: '3.1' }];

  // A parse that found no education must not discard the row, but must
  // hydrate it — and translate the keys it was saved under.
  const next = mergeParsedResumeIntoProfile(stale, { firstName: 'Jo' });
  assert.equal(next.education[0].school, 'Old School');
  assert.equal(next.education[0].start, '2010');
  assert.equal(next.education[0].cgpa, '3.1');
  assert.equal(next.education[0].minor, '');
  assert.notEqual(next.education[0].expectedGraduation, undefined);
});

// ------------------------------------------------------------------
// The anti-blanking rule
// ------------------------------------------------------------------

test('an empty parsed value never overwrites an existing one', () => {
  const prev = blank();
  prev.address.country = 'United States';
  prev.address.addressLine2 = 'Buzzer 12';
  prev.phone = '5105550147';

  // PARSED states country as "" — the exact case that wiped the field.
  const next = mergeParsedResumeIntoProfile(prev, PARSED);

  assert.equal(next.address.country, 'United States', 'empty parsed country must not blank it');
  assert.equal(next.address.addressLine2, 'Buzzer 12', 'the parser has no line 2; keep ours');
  assert.equal(next.country, 'United States');
  assert.equal(next.countryCode, '+1');
});

test('the Country select never holds a value with no matching option', () => {
  const next = mergeParsedResumeIntoProfile(blank(), {
    address: { country: 'Republic of Atlantis' },
  });
  // Unrecognised country: the address text may say it, the picker may not.
  assert.equal(next.country, DEFAULT_PROFILE.country);
  assert.equal(next.countryCode, DEFAULT_PROFILE.countryCode);
});

test('a recognised country drives the dial code', () => {
  const next = mergeParsedResumeIntoProfile(blank(), { address: { country: 'India' } });
  assert.equal(next.country, 'India');
  assert.equal(next.countryCode, '+91');
  assert.equal(next.address.country, 'India');
});

test('a parsed value does win over an existing one', () => {
  const prev = blank();
  prev.email = 'old@example.com';
  const next = mergeParsedResumeIntoProfile(prev, PARSED);
  assert.equal(next.email, 'jordan.rivera@example.com', 're-uploading a corrected CV must correct');
});

// ------------------------------------------------------------------
// Links
// ------------------------------------------------------------------

test('link types are canonicalised to the spellings autofill matches', () => {
  const next = mergeParsedResumeIntoProfile(blank(), PARSED);
  const typeOf = (v) => next.urls.find((u) => u.value === v)?.type;
  assert.equal(typeOf('linkedin.com/in/jordanrivera'), 'LinkedIn');
  assert.equal(typeOf('github.com/jrivera-dev'), 'GitHub');
  for (const u of next.urls) {
    assert.ok(['LinkedIn', 'GitHub', 'Portfolio', 'Other'].includes(u.type), `bad type ${u.type}`);
  }
});

test('links the resume does not mention survive the upload', () => {
  const prev = blank();
  prev.urls = [
    { type: 'LinkedIn', value: '' },
    { type: 'GitHub', value: '' },
    { type: 'Portfolio', value: 'jordanrivera.dev' },
  ];
  const next = mergeParsedResumeIntoProfile(prev, PARSED);
  const portfolio = next.urls.find((u) => u.type === 'Portfolio');
  assert.equal(portfolio.value, 'jordanrivera.dev', 'hand-typed portfolio must not be deleted');
  assert.equal(next.urls.find((u) => u.type === 'LinkedIn').value, 'linkedin.com/in/jordanrivera');
});

test('an unknown link type lands in Other rather than being dropped', () => {
  const next = mergeParsedResumeIntoProfile(blank(), {
    urls: [{ type: 'stackoverflow', value: 'stackoverflow.com/users/1' }],
  });
  const entry = next.urls.find((u) => u.value === 'stackoverflow.com/users/1');
  assert.equal(entry.type, 'Other');
});

// ------------------------------------------------------------------
// Derived fields and flags
// ------------------------------------------------------------------

test('graduation and enrollment years are read out of the stated dates', () => {
  const next = mergeParsedResumeIntoProfile(blank(), PARSED);
  assert.equal(next.education[0].enrollmentYear, '2015');
  assert.equal(next.education[0].graduationYear, '2019');
});

test('an in-progress degree fills Expected Graduation, not Graduation Year', () => {
  const next = mergeParsedResumeIntoProfile(blank(), {
    education: [{ school: 'MIT', startDate: '2024', endDate: 'Expected 2028' }],
  });
  assert.equal(next.education[0].graduationYear, '');
  assert.equal(next.education[0].expectedGraduation, '2028');
});

test('"Present" ticks the Current checkbox on the right row only', () => {
  const next = mergeParsedResumeIntoProfile(blank(), PARSED);
  assert.equal(next.experience[0].isCurrent, true);
  assert.equal(next.experience[1].isCurrent, false);
});

test('current job falls back to the experience row marked current', () => {
  const next = mergeParsedResumeIntoProfile(blank(), { ...PARSED, currentJob: {} });
  assert.equal(next.currentJob.company, 'Pellorin Marketplace');
  assert.equal(next.currentJob.title, 'Senior Backend Engineer');
});

test('skills de-duplicate case-insensitively, keeping the typed spelling', () => {
  const prev = blank();
  prev.skills = ['Python', 'Rust'];
  const next = mergeParsedResumeIntoProfile(prev, { skills: ['python', 'Go', 'RUST'] });
  assert.deepEqual(next.skills, ['Python', 'Rust', 'Go']);
});

// ------------------------------------------------------------------
// Totality
// ------------------------------------------------------------------

test('garbage in yields an intact profile, not a damaged one', () => {
  for (const junk of [null, undefined, 42, 'nope', [], { education: 'not an array' }]) {
    const next = mergeParsedResumeIntoProfile(blank(), junk);
    assert.equal(typeof next, 'object');
    assert.ok(Array.isArray(next.education) && next.education.length >= 1);
    assert.ok(Array.isArray(next.urls) && next.urls.length >= 1);
    assert.equal(next.country, DEFAULT_PROFILE.country);
  }
});

test('a missing prev profile still produces a complete one', () => {
  const next = mergeParsedResumeIntoProfile(undefined, PARSED);
  for (const key of Object.keys(DEFAULT_PROFILE)) {
    assert.notEqual(next[key], undefined, `missing "${key}"`);
  }
});

test('customFields are carried through untouched by a resume upload', () => {
  const prev = blank();
  prev.customFields = [{ label: "Mother's Name", value: 'Elena Rivera' }];
  const next = mergeParsedResumeIntoProfile(prev, PARSED);
  assert.deepEqual(next.customFields, [{ label: "Mother's Name", value: 'Elena Rivera' }]);
});

test('prev is not mutated', () => {
  const prev = blank();
  const before = JSON.stringify(prev);
  mergeParsedResumeIntoProfile(prev, PARSED);
  assert.equal(JSON.stringify(prev), before);
});

// ------------------------------------------------------------------
// The regression this module exists for
// ------------------------------------------------------------------

test('the editor fields a complete resume states are filled, not blank', () => {
  const next = mergeParsedResumeIntoProfile(blank(), PARSED);

  /** Every `value={...}` the editor binds that PARSED has something to say about. */
  const paths = [
    'firstName', 'lastName', 'email', 'phone', 'country', 'countryCode',
    'address.addressLine1', 'address.city', 'address.state', 'address.postalCode',
    'address.country',
    'education.0.school', 'education.0.degree', 'education.0.field',
    'education.0.start', 'education.0.end', 'education.0.cgpa',
    'education.0.enrollmentYear', 'education.0.graduationYear',
    'experience.0.company', 'experience.0.title', 'experience.0.start',
    'experience.0.end', 'experience.0.description',
    'certificates.0.name', 'certificates.0.issuer', 'certificates.0.date',
    'urls.0.type', 'urls.0.value',
    'currentJob.company', 'currentJob.title',
  ];
  const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

  const blanks = paths.filter((p) => {
    const v = get(next, p);
    return v === undefined || v === null || v === '';
  });
  assert.deepEqual(blanks, [], `still blank after parsing: ${blanks.join(', ')}`);
});

test('normalizeParsedResume translates without defaulting anything in', () => {
  const only = normalizeParsedResume({ firstName: 'Ada' });
  assert.equal(only.firstName, 'Ada');
  assert.equal(only.address.country, '', 'no merge means no default country');
  assert.deepEqual(only.education, []);
  assert.deepEqual(only.skills, []);
});

test('rehydrating a stored profile does not collapse Country into the address', () => {
  const prev = blank();
  prev.country = 'India';
  prev.countryCode = '+91';
  prev.address.country = 'United States'; // they live in one place, dial another

  // The empty parse is how ProfilesPage.hydrate() fills in a stored profile.
  const next = mergeParsedResumeIntoProfile(prev, {});
  assert.equal(next.country, 'India');
  assert.equal(next.countryCode, '+91');
  assert.equal(next.address.country, 'United States');
});

test('hydrating a stored profile repairs it without inventing anything', () => {
  // A blob written by a build that predates customFields and the row schema.
  const stale = {
    firstName: 'Ada',
    urls: [{ type: 'linkedin', value: 'linkedin.com/in/ada' }],
    experience: [{ company: 'Analytical Engines', title: 'Engineer', startDate: '1843' }],
    skills: ['Math', 'math'],
  };

  const next = mergeParsedResumeIntoProfile(stale, {});
  assert.equal(next.firstName, 'Ada');
  assert.equal(next.urls[0].type, 'LinkedIn', 'lowercase types recover without a re-upload');
  assert.equal(next.experience[0].start, '1843');
  assert.equal(next.experience[0].isCurrent, false);
  assert.deepEqual(next.skills, ['Math']);
  assert.deepEqual(next.customFields, []);
  assert.equal(next.vault.length, DEFAULT_PROFILE.vault.length, 'vault survives hydration');
});

test('a stored address written in the parser\'s spelling is repaired on load', () => {
  // Exactly what the old merge persisted: the parser's own keys, spread
  // straight into `address` and rendered by nothing.
  const stale = { address: { street: '1180 Fairmount Avenue', zip: '94610', city: 'Oakland' } };

  const next = mergeParsedResumeIntoProfile(stale, {});
  assert.equal(next.address.addressLine1, '1180 Fairmount Avenue');
  assert.equal(next.address.postalCode, '94610');
  assert.equal(next.address.city, 'Oakland');
  assert.equal(next.address.street, undefined, 'the legacy key is dropped, not carried forever');
  assert.equal(next.address.zip, undefined);
  assert.deepEqual(
    Object.keys(next.address).sort(),
    Object.keys(DEFAULT_PROFILE.address).sort(),
    'the address carries exactly the keys the editor renders',
  );
});
