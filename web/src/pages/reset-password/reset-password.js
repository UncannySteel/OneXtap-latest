import { bootSubPage } from '../sub-page.js';
import { newPasswordProblem } from '../../features/login/password-rule.js';
import markup from './reset-password.html?raw';
import '../../features/login/login.css';
import './reset-password.css';

/* --- Reset password: where the email's link opens ------------------------
   Supabase's recovery link arrives as #access_token=…&type=recovery (the
   implicit flow, its client's default). The address is read here, before
   the account's client loads, because that client takes the link: it signs
   this page in with the link's session and clears the hash. Then the form
   asks for the new password, held to the sign-up rule
   (features/login/password-rule.js), and updatePassword sets it.

   Arriving with no link, or with one Supabase refused (#error=…, e.g. an
   expired link), or with one whose session did not take, the page says so
   and offers a new link: /?reset=1 opens the sign-in window on "Reset your
   password" (src/app/wire.js). The forwarding script in web/index.html and
   the dashboard's boot send a recovery link that landed elsewhere here. */
var arrival = new URLSearchParams(location.hash.replace(/^#/, ''));
var fromLink = arrival.get('type') === 'recovery';
var refused = arrival.has('error') || arrival.has('error_description');

bootSubPage({ 'reset-password': { markup: markup } });

var $ = function (id) { return document.getElementById(id); };
var cards = ['resetChecking', 'resetForm', 'resetDone', 'resetLost'].map($);
var form = $('resetForm');
var input = $('resetPassword');
var show = $('resetShow');
var sendErr = $('resetSendErr');
var submit = $('resetSubmit');

function showCard(id) {
  cards.forEach(function (card) { card.hidden = card.id !== id; });
}

function lost(title, text, again) {
  $('resetLostTitle').textContent = title;
  $('resetLostText').textContent = text;
  $('resetAgain').textContent = again;
  showCard('resetLost');
}

var EXPIRED = [
  'This link can’t be used.',
  'It has expired, or it was already used: a reset link works once, for a short while.',
  'Send me a new link'
];

function setError(text) {
  input.closest('.login__field').classList.toggle('is-bad', !!text);
  input.setAttribute('aria-invalid', text ? 'true' : 'false');
  $('resetPasswordErr').textContent = text;
  return !text;
}

function reveal(on) {
  input.type = on ? 'text' : 'password';
  show.textContent = on ? 'Hide' : 'Show';
  show.setAttribute('aria-pressed', String(on));
}
show.addEventListener('click', function () {
  reveal(input.type === 'password');
  input.focus();
});
input.addEventListener('input', function () {
  if (input.getAttribute('aria-invalid') === 'true') setError(newPasswordProblem(input.value));
});

// Supabase's refusals, in the page's words.
function said(error) {
  var message = String((error && error.message) || '');
  if (/should be different|same as the old/i.test(message)) return 'That’s the password you have now. Choose a different one.';
  if (/password should be|weak password/i.test(message)) return 'Use a longer password: at least 8 characters, with upper and lower case letters and a number.';
  if (/failed to fetch|network/i.test(message)) return 'We couldn’t reach Onextap. Check your connection and try again.';
  return message || 'That didn’t work. Try again.';
}

if (!fromLink && !refused) {
  lost('Open the link from your email.',
    'This page sets a new password when you arrive from the reset email. If it hasn’t come, ask for one.',
    'Send me a reset link');
} else if (refused) {
  lost.apply(null, EXPIRED);
} else {
  import('@app/auth.js').then(function (auth) {
    return auth.getAccessToken().then(function (token) {
      if (!token) return lost.apply(null, EXPIRED);
      showCard('resetForm');
      input.focus();

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!setError(newPasswordProblem(input.value))) {
          input.focus();
          return;
        }
        sendErr.textContent = '';
        submit.disabled = true;
        submit.textContent = 'Saving…';
        auth.updatePassword(input.value).then(function (res) {
          if (res.error) {
            // A session that lapsed while the page sat open: the link is spent.
            if (/session|jwt|expired|not authenticated/i.test(String(res.error.message || ''))) return lost.apply(null, EXPIRED);
            sendErr.textContent = said(res.error);
            return;
          }
          showCard('resetDone');
          $('resetDoneTitle').focus();
        }).catch(function (error) {
          sendErr.textContent = said(error);
        }).then(function () {
          submit.disabled = false;
          submit.textContent = 'Set password';
        });
      });
    });
  }).catch(function () {
    // The account's client could not load (a build without its Supabase settings).
    lost('This page couldn’t start.', 'Try again in a moment. If it keeps happening, tell us from the Contact page.', 'Back to sign in');
    $('resetAgain').setAttribute('href', '/?login=1');
  });
}
