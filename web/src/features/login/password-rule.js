/* --- the account's rule for a new password -------------------------------
   Long enough, with upper and lower case and a number: what the backend's
   sign-up form asked. Shared by the sign-in window's sign-up form and the
   reset-password page, so the two cannot drift apart. Supabase may refuse a
   password for its own reasons too (a leaked one, say); those come back as
   errors and are shown as they are. */
export var MIN_NEW_PASSWORD = 8;

export function strongEnough(text) {
  return text.length >= MIN_NEW_PASSWORD && /[A-Z]/.test(text) && /[a-z]/.test(text) && /[0-9]/.test(text);
}

/* What is wrong with a new password, in the window's words, or '' when
   nothing is. */
export function newPasswordProblem(text) {
  if (!text) return 'Enter a password.';
  if (text.length < MIN_NEW_PASSWORD) return 'At least ' + MIN_NEW_PASSWORD + ' characters, please.';
  if (!strongEnough(text)) return 'Mix in an uppercase letter, a lowercase letter and a number.';
  return '';
}
