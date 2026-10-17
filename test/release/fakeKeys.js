/**
 * Obviously fake keys in the shapes the release scanner looks for, put
 * together at run time so no key-shaped string is committed (a secret
 * scanner on push would flag one, and none of these is real).
 */

/** A JWT with this payload and a signature nothing verifies. */
export function fakeJwt(payload) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}.${'fake-signature'.repeat(3)}`;
}

/** 1.0.2's Supabase project (plan §2). A project ref is not a secret. */
export const RELEASE_REF = 'itqaozltgsyvjhlcllic';

export const fake = {
  anonJwt: fakeJwt({ iss: 'supabase', ref: RELEASE_REF, role: 'anon', iat: 1, exp: 2 }),
  serviceRoleJwt: fakeJwt({ iss: 'supabase', ref: RELEASE_REF, role: 'service_role', iat: 1, exp: 2 }),
  otherProjectAnonJwt: fakeJwt({ iss: 'supabase', ref: 'devprojectdevproject', role: 'anon', iat: 1, exp: 2 }),
  supabaseSecret: ['sb', 'secret', 'FAKE'.repeat(8)].join('_'),
  supabasePublishable: ['sb', 'publishable', 'FAKE'.repeat(8)].join('_'),
  groq: ['gsk', 'FAKE'.repeat(13)].join('_'),
  gemini: ['AIza', 'Sy', 'FAKE_fake-'.repeat(3), 'FAK'].join(''),
  resend: ['re', 'FAKEfake', 'FAKEfakeFAKEfakeFAKEfake'].join('_'),
  dodoWebhook: ['whsec', 'RkFLRUZBS0VGQUtFRkFLRUZBS0U='].join('_'),
};

/** Server secret names, and one behind VITE_ (rule 7's mistake). */
export const secretNames = [
  ['GROQ', 'API', 'KEY'],
  ['GEMINI', 'API', 'KEY'],
  ['DODO', 'PAYMENTS', 'API', 'KEY'],
  ['DODO', 'PAYMENTS', 'WEBHOOK', 'KEY'],
  ['RESEND', 'API', 'KEY'],
  ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'],
  ['VITE', 'GROQ', 'API', 'KEY'],
].map((parts) => parts.join('_'));
