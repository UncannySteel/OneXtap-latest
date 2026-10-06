/* --- the landing page's line to the backend --------------------------------
   Everything the landing page and its company pages ask of the account or
   the server goes through here, so the features themselves stay as they
   were built: login.js still takes a `signIn`, feedback.js a `send`, and
   these are what they are handed.

   The sign-in itself is Supabase's, through the same helpers the dashboard
   and the extension popup use (src/auth.js). Its SDK is loaded on demand,
   the first time someone actually signs in, so the landing page does not
   carry it on first paint. Whether someone is signed in already is read
   straight from the session Supabase keeps in localStorage — the landing
   page, the dashboard and the API share one origin, so it is the same one
   the dashboard will use. */
import { API_URL, CHROME_WEB_STORE_URL, DASHBOARD_PATH } from '@app/config.js';

/* --- is anyone signed in? --------------------------------------------------
   Supabase's browser client keeps the session under sb-<project ref>-auth-token.
   A stored session with a refresh token counts: the access token inside it may
   have lapsed, but the dashboard's client refreshes it on load, and if that
   fails it sends the reader back here to sign in. */
function sessionKey() {
  try {
    var host = new URL(import.meta.env.VITE_SUPABASE_URL).hostname;
    return 'sb-' + host.split('.')[0] + '-auth-token';
  } catch (err) {
    return null;
  }
}

export function hasSession() {
  var key = sessionKey();
  if (!key) return false;
  try {
    var stored = JSON.parse(localStorage.getItem(key) || 'null');
    var session = stored && (stored.currentSession || stored);
    return !!(session && session.refresh_token);
  } catch (err) {
    return false;
  }
}

/* --- where things go -------------------------------------------------------- */
export function dashboardUrl(query) {
  return DASHBOARD_PATH + (query ? '?' + query : '');
}

export function goToDashboard(query) {
  location.assign(dashboardUrl(query));
}

export function openChromeWebStore() {
  window.open(CHROME_WEB_STORE_URL, '_blank', 'noopener,noreferrer');
}

/* --- signing in --------------------------------------------------------------
   `signIn` for features/login: takes { method, mode, email, password, name }
   (mode 'in', 'up' or 'reset') and resolves with what the window says next —
   { title?, text, next } — where `next` is where its Continue button goes
   (null: it just closes). Rejects with an Error whose `userMessage`, when
   present, is shown as it is. */

// Where the email's reset link opens: the page that sets the new password
// (web/reset-password/). It has to be on Supabase's redirect allowlist.
var RESET_PATH = '/reset-password/';

var WORDS = [
  [/invalid login credentials/i, 'That email and password don’t match an account.'],
  [/email not confirmed/i, 'Confirm your email first — the link is in your inbox.'],
  [/already registered|already exists/i, 'There’s already an account with that email. Sign in instead.'],
  // Supabase: "For security purposes, you can only request this after N seconds."
  [/only request this/i, 'Wait a minute before asking for another link.'],
  [/rate limit|too many/i, 'Too many attempts. Wait a minute, then try again.'],
  [/password should be|weak password/i, 'Use a longer password: at least 8 characters, with upper and lower case letters and a number.'],
  [/failed to fetch|network/i, 'We couldn’t reach Onextap. Check your connection and try again.']
];

function refusal(error) {
  var message = String((error && error.message) || '');
  var err = new Error(message || 'Sign-in failed');
  for (var i = 0; i < WORDS.length; i++) {
    if (WORDS[i][0].test(message)) { err.userMessage = WORDS[i][1]; break; }
  }
  if (!err.userMessage && message) err.userMessage = message;
  return err;
}

export function signInAttempt(details, next) {
  var after = next === undefined ? DASHBOARD_PATH : next;
  return import('@app/auth.js').then(function (auth) {
    if (details.method === 'google') {
      // Supabase sends the browser to Google and back to the dashboard. If
      // that address is not on the project's redirect allowlist it falls back
      // to the site URL — the landing page — which passes the session on
      // (see the forwarding script in web/index.html).
      return auth.signInWithOAuth('google', { redirectTo: location.origin + (after || DASHBOARD_PATH) })
        .then(function (res) {
          if (res.error) throw refusal(res.error);
          // The browser is on its way to Google; nothing more to show.
          return new Promise(function () {});
        });
    }

    if (details.mode === 'reset') {
      // The link in the email opens the reset page, already signed in by the
      // link, to set the new password there. Supabase says the same whether
      // or not the address has an account, and so does this.
      return auth.requestPasswordReset(details.email, { redirectTo: location.origin + RESET_PATH }).then(function (res) {
        if (res.error) throw refusal(res.error);
        return {
          title: 'Check your email.',
          text: 'If an account uses ' + details.email + ', a link to set a new password is on its way to it.',
          next: null
        };
      });
    }

    if (details.mode === 'up') {
      // The name (optional) becomes the account's full_name, which the
      // dashboard greets you by.
      return auth.signUp(details.email, details.password, details.name || '').then(function (res) {
        if (res.error) throw refusal(res.error);
        // No session back means the project wants the address confirmed first.
        if (!res.session) {
          return {
            title: 'Check your email.',
            text: 'We sent a confirmation link to ' + details.email + '. Open it to finish creating your account.',
            next: null
          };
        }
        return { text: 'Account created for ' + details.email + '.', next: after };
      });
    }

    return auth.signIn(details.email, details.password).then(function (res) {
      if (res.error) throw refusal(res.error);
      return { text: 'Signed in as ' + details.email + '.', next: after };
    });
  });
}

/* --- feedback ------------------------------------------------------------------
   `send` for features/feedback. POST /api/feedback emails it to the team
   (Resend) and stores nothing. The window's "A job board" chip is `board`;
   the server calls it `job-board`. */
var CATEGORIES = { idea: 'idea', bug: 'bug', board: 'job-board', other: 'other' };

export function sendFeedback(note) {
  return fetch(API_URL + '/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category: CATEGORIES[note.kind] || 'other',
      message: note.message,
      email: note.email || ''
    })
  }).then(function (res) {
    if (!res.ok) throw new Error('Feedback failed (' + res.status + ')');
    return res.json().catch(function () { return {}; });
  });
}
