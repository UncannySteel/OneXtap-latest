import { createDialog } from '../../shared/lib/dialog.js';
import { MIN_NEW_PASSWORD, strongEnough } from './password-rule.js';
import markup from './login.html?raw';
import './login.css';

export { markup };

/* --- the sign-in window ---------------------------------------------------
   Any [data-login] button opens it (the header's Log in, on every page); it
   opens, closes and holds the page as every window does (shared/lib/
   dialog.js). "Sign up" turns it into the sign-up form (with an optional
   name) and back; "Forgot password?" turns it into a request for a reset
   link, which only needs the email. The form checks itself before it goes;
   `signIn` is where it goes.

   initLogin({ signIn }) takes a function that gets { method, mode, email,
   password, name } (mode 'in', 'up' or 'reset'; a reset has no password, and
   only sign-up has a name) and returns a promise. It resolves with what the window says
   next — { title?, text, next } — where `next` is the page its Continue
   button goes to (the dashboard, once signed in) or null to just close; a
   bare string or nothing keeps the window's own wording. It rejects to say
   the attempt failed, with the reason in `userMessage` when there is one
   worth showing. src/app/backend.js is the real one (Supabase). Without
   one, an attempt is announced on the document as an 'onextap:login' event
   (detail: the method, the mode and the email; never the password) and
   counts as signed in.

   `openAs(mode, next)` opens it from anywhere else — the pricing plans — in
   sign-in ('in'), sign-up ('up') or reset ('reset') form, with where
   Continue should go. The new-password rule is shared with the reset page
   (./password-rule.js). */
var MODES = {
  in: {
    title: 'Welcome back', intro: 'Sign in to access your dashboard.',
    submit: 'Sign In', busy: 'Signing in…', ask: 'Don’t have an account?', other: 'Sign up',
    password: 'current-password'
  },
  up: {
    title: 'Create an account', intro: 'Sign up to set up your dashboard.',
    submit: 'Sign Up', busy: 'Signing up…', ask: 'Already have an account?', other: 'Sign in',
    password: 'new-password'
  },
  reset: {
    title: 'Reset your password', intro: 'We’ll email you a link to set a new one.',
    submit: 'Send link', busy: 'Sending…', ask: 'Remembered it?', other: 'Sign in',
    password: null
  }
};

function announce(attempt) {
  document.dispatchEvent(new CustomEvent('onextap:login', {
    detail: { method: attempt.method, mode: attempt.mode, email: attempt.email || null }
  }));
  return Promise.resolve();
}

export function initLogin(opts) {
  var signIn = (opts && opts.signIn) || announce;
  var root = document.getElementById('login');
  var view = document.getElementById('loginView');
  var done = document.getElementById('loginDone');
  var form = document.getElementById('loginForm');
  var google = document.getElementById('loginGoogle');
  var submit = document.getElementById('loginSubmit');
  var show = document.getElementById('loginShow');
  var sendErr = document.getElementById('loginSendErr');
  var email = form.elements.email;
  var password = form.elements.password;
  var name = form.elements.name;
  // The parts a mode shows or hides (see setMode).
  var nameField = document.getElementById('loginNameField');
  var passwordField = document.getElementById('loginPasswordField');
  var forgotRow = document.getElementById('loginForgotRow');
  var orRow = document.getElementById('loginOr');
  var mode = 'in';
  var doneTitle = document.getElementById('loginDoneTitle');
  var doneTitleText = doneTitle.textContent;
  var continueBtn = done.querySelector('[data-dlg-close]');
  // Where Continue goes once signed in: set by openAs, or by what signIn
  // resolves with. null closes the window where it is.
  var next = null;
  var askedNext = null;

  continueBtn.addEventListener('click', function () {
    if (next) location.assign(next);
  });

  function setMode(next) {
    mode = next;
    var m = MODES[mode];
    document.getElementById('loginTitle').textContent = m.title;
    document.getElementById('loginIntro').textContent = m.intro;
    document.getElementById('loginAsk').textContent = m.ask;
    document.getElementById('loginSwitch').textContent = m.other;
    submit.textContent = m.submit;
    if (m.password) password.setAttribute('autocomplete', m.password);
    // Sign-up asks a name; a reset needs only the email, so Google, the
    // password and the forgot link step aside.
    nameField.hidden = mode !== 'up';
    passwordField.hidden = mode === 'reset';
    forgotRow.hidden = mode !== 'in';
    google.hidden = orRow.hidden = mode === 'reset';
    [email, password].forEach(function (input) { setError(input, ''); });
    sendErr.textContent = '';
  }

  function reset() {
    form.reset();
    view.hidden = false;
    done.hidden = true;
    doneTitle.textContent = doneTitleText;
    next = null;
    askedNext = null;
    reveal(false);
    setBusy(false);
    setMode('in');
  }

  /* --- showing the password ------------------------------------------- */
  function reveal(on) {
    password.type = on ? 'text' : 'password';
    show.textContent = on ? 'Hide' : 'Show';
    show.setAttribute('aria-pressed', String(on));
  }
  show.addEventListener('click', function () {
    reveal(password.type === 'password');
    password.focus();
  });

  document.getElementById('loginSwitch').addEventListener('click', function () {
    setMode(mode === 'in' ? 'up' : 'in');
  });

  // The forgot link hides itself, so focus moves on to the one field left.
  document.getElementById('loginForgot').addEventListener('click', function () {
    setMode('reset');
    email.focus();
  });

  /* --- checking --------------------------------------------------------- */
  function setError(input, text) {
    input.closest('.login__field').classList.toggle('is-bad', !!text);
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
    document.getElementById(input.getAttribute('aria-describedby')).textContent = text;
    return !text;
  }
  function checkEmail() {
    var text = email.value.trim();
    return setError(email,
      !text ? 'Enter your email address.' :
      !email.checkValidity() ? 'That email doesn’t look right.' : '');
  }
  function checkPassword() {
    var text = password.value;
    return setError(password,
      !text ? 'Enter your password.' :
      mode === 'up' && text.length < MIN_NEW_PASSWORD ? 'At least ' + MIN_NEW_PASSWORD + ' characters, please.' :
      mode === 'up' && !strongEnough(text) ? 'Mix in an uppercase letter, a lowercase letter and a number.' : '');
  }

  // Once a field has been marked wrong, it is re-checked as it is fixed.
  email.addEventListener('input', function () {
    if (email.getAttribute('aria-invalid') === 'true') checkEmail();
  });
  password.addEventListener('input', function () {
    if (password.getAttribute('aria-invalid') === 'true') checkPassword();
  });

  /* --- signing in ------------------------------------------------------- */
  function setBusy(busy) {
    submit.disabled = google.disabled = busy;
    submit.textContent = busy ? MODES[mode].busy : MODES[mode].submit;
  }

  function attempt(details, doneText) {
    sendErr.textContent = '';
    setBusy(true);
    Promise.resolve(signIn(Object.assign({ mode: mode }, details), askedNext === null ? undefined : askedNext)).then(function (said) {
      var told = said && typeof said === 'object' ? said : {};
      if (told.title) doneTitle.textContent = told.title;
      else if (mode === 'reset') doneTitle.textContent = 'Check your email.';
      document.getElementById('loginDoneText').textContent = told.text || (typeof said === 'string' ? said : doneText);
      next = told.next || null;
      view.hidden = true;
      done.hidden = false;
      doneTitle.focus();
    }, function (err) {
      sendErr.textContent = (err && err.userMessage) || 'That didn’t work. Check your details and try again.';
    }).then(function () { setBusy(false); });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var ok = checkEmail();
    if (mode !== 'reset') ok = checkPassword() && ok;
    if (!ok) {
      form.querySelector('[aria-invalid="true"]').focus();
      return;
    }
    var who = email.value.trim();
    if (mode === 'reset') {
      attempt({ method: 'email', email: who }, 'A link to set a new password is on its way to ' + who + '.');
      return;
    }
    var details = { method: 'email', email: who, password: password.value };
    if (mode === 'up') details.name = name.value.trim();
    attempt(details, (mode === 'up' ? 'Account created for ' : 'Signed in as ') + who + '.');
  });

  google.addEventListener('click', function () {
    attempt({ method: 'google' }, 'Signed in with Google.');
  });

  var dialog = createDialog(root, {
    trigger: '[data-login]',
    reset: reset,
    focus: function () { return google; }
  });

  // Opening resets the window to sign-in, so the mode and destination are
  // set after it has opened.
  dialog.openAs = function (as, then) {
    dialog.open();
    if (as === 'up') setMode('up');
    // Opening focused Google, which a reset hides: focus the email instead.
    if (as === 'reset') { setMode('reset'); email.focus(); }
    askedNext = then === undefined ? null : then;
  };
  return dialog;
}
