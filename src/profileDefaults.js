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
 */

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
  education: [
    { school: '', degree: '', field: '', start: '', end: '', cgpa: '', specialization: '', minor: '', graduationYear: '', enrollmentYear: '', graduationDate: '', expectedGraduation: '' }
  ],
  experience: [
    { company: '', title: '', start: '', end: '', startDate: '', endDate: '', description: '', duration: '', type: '', isCurrent: false }
  ],
  certificates: [
    { name: '', issuer: '', date: '', expiry: '' }
  ],
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
  disability: ''
};

export const RACES = ["American Indian", "Asian", "Black or African American", "Native Hawaiian", "White", "Two or More"];
export const VETERAN_STATUS = ["I am not a protected veteran", "I am a protected veteran", "Decline to identify"];
