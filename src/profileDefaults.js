/**
 * Profile Defaults
 *
 * The blank profile a new user starts from, plus the fixed option lists for
 * the self-identification fields. Shared by the dashboard and the popup —
 * both render from the same source tree.
 *
 * DEFAULT_PROFILE is read-only: spread it to seed or backfill a profile,
 * never mutate it. Like everything profile-shaped, this data is local-only
 * and never written to Supabase (see storage.js).
 *
 * ═══ THE ROW FACTORIES ARE THE SCHEMA ═══
 *
 * `emptyEducation()` and friends are the single definition of what one
 * education / experience / certificate row contains. The editor spreads them
 * for "Add education", and `resumeToProfile.js` spreads them to hydrate a
 * parsed row, so a key added here reaches both without being typed twice.
 *
 * That matters more than it looks: the editor renders `value={ed.minor}`, and
 * a row built without a `minor` key hands React `undefined`, which silently
 * turns a controlled input into an uncontrolled one. Rows must always carry
 * every key, empty string and all — which is exactly what these return.
 */

// --- ROW SCHEMAS ---

/** One education row, every key present. @returns {object} */
export const emptyEducation = () => ({
  school: '', degree: '', field: '', start: '', end: '', cgpa: '',
  specialization: '', minor: '', graduationYear: '', enrollmentYear: '',
  graduationDate: '', expectedGraduation: '',
});

/** One experience row, every key present. @returns {object} */
export const emptyExperience = () => ({
  company: '', title: '', start: '', end: '', startDate: '', endDate: '',
  description: '', duration: '', type: '', isCurrent: false,
});

/** One certificate row, every key present. @returns {object} */
export const emptyCertificate = () => ({ name: '', issuer: '', date: '', expiry: '' });

/**
 * One user-defined field.
 *
 * `label` is both what the editor shows and what the autofiller matches on —
 * see the customFields block at the end of buildIntents() in public/content.js.
 * @returns {{label: string, value: string}}
 */
export const emptyCustomField = () => ({ label: '', value: '' });

// --- CONFIGURATION ---
export const DEFAULT_PROFILE = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  urls: [
    { type: 'LinkedIn', value: '' },
    { type: 'GitHub', value: '' }, 
    { type: 'Portfolio', value: '' }
  ],
  country: 'United States', 
  countryCode: '+1',
  birthDate: '', 
  gender: '',
  vault: [
    { id: 1, question: "Why do you want to work here?", answer: "I've always admired companies that push boundaries. My skills in problem-solving align perfectly with your mission to innovate." },
    { id: 2, question: "Tell us about a challenge you faced.", answer: "In a previous project, we faced a tight deadline. I organized the team, prioritized tasks, and we delivered on time." }
  ],
  address: {
    country: 'United States',
    city: '',
    state: '',
    postalCode: '',
    addressLine1: '',
    addressLine2: '',
    addressLine3: ''
  },
  education: [emptyEducation()],
  experience: [emptyExperience()],
  certificates: [emptyCertificate()],
  skills: [],
  currentJob: {
    company: '',
    title: '',
    isCurrent: true
  },
  currentSalary: '',
  payExpectation: '',
  noticePeriod: '',
  race: [], 
  ethnicity: '', 
  veteran: '',   
  disability: '',
  /**
   * User-defined fields the fixed schema above does not cover — "Mother's
   * Name", "Roll Number", "Visa Status". Empty by default: nobody gets one
   * they did not ask for, and an empty array costs nothing to sync.
   */
  customFields: []
};

export const RACES = ["American Indian", "Asian", "Black or African American", "Native Hawaiian", "White", "Two or More"];
export const VETERAN_STATUS = ["I am not a protected veteran", "I am a protected veteran", "Decline to identify"];
