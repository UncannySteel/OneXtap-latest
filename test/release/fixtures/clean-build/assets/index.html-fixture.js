// A stand-in for the popup bundle, shaped like the real minified one where
// it matters to the scanner (test/release/scan.test.js). It carries what a
// real release build does and is allowed: bare hostname literals used in
// comparisons, supabase-js's default auth URL, the production origins, and
// "Groq" and "Gemini" as words. The anon JWT the real bundle carries is
// added by the test at run time, so no key-shaped string is committed.
const SITE = 'https://www.onextap.com';
const SUPABASE = 'https://itqaozltgsyvjhlcllic.supabase.co';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const GOTRUE_URL = 'http://localhost:9999';
const isWebAuthnHost = (hostname) => hostname === 'localhost' || /^([a-z0-9]+\.)+[a-z]{2,}$/i.test(hostname);
const credit = 'Drafts by Groq; resumes read by Gemini.';

export default { SITE, SUPABASE, LOCAL_HOSTS, GOTRUE_URL, isWebAuthnHost, credit };
