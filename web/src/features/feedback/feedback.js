import { createDialog } from '../../shared/lib/dialog.js';
import markup from './feedback.html?raw';
import './feedback.css';

export { markup };

/* --- the feedback window --------------------------------------------------
   Any [data-feedback] button opens it; it opens, closes and holds the page
   as every window does (shared/lib/dialog.js). The form checks itself before
   it goes; `send` is where it goes.

   No feedback endpoint is wired up yet. Until one is, a note is announced on
   the document as an 'onextap:feedback' event (detail: the note) and counts
   as sent. Pass initFeedback({ send }) a function that posts the note and
   returns a promise to send it somewhere real. */
var MIN_LENGTH = 10;

function announce(note) {
  document.dispatchEvent(new CustomEvent('onextap:feedback', { detail: note }));
  return Promise.resolve();
}

export function initFeedback(opts) {
  var send = (opts && opts.send) || announce;
  var root = document.getElementById('feedback');
  var form = document.getElementById('fbForm');
  var done = document.getElementById('fbDone');
  var submit = document.getElementById('fbSubmit');
  var submitLabel = submit.querySelector('.fb__submit');
  var sendErr = document.getElementById('fbSendErr');
  var count = document.getElementById('fbCount');
  var message = form.elements.message;
  var email = form.elements.email;
  var dialog = createDialog(root, {
    trigger: '[data-feedback]',
    reset: reset,
    focus: function () { return form.querySelector('input[name="kind"]:checked'); }
  });

  function reset() {
    form.reset();
    form.hidden = false;
    done.hidden = true;
    [message, email].forEach(function (input) { setError(input, ''); });
    sendErr.textContent = '';
    setBusy(false);
    countUp();
  }

  function countUp() { count.textContent = message.value.length + ' / ' + message.maxLength; }

  /* --- checking --------------------------------------------------------- */
  function setError(input, text) {
    input.closest('.fb__field').classList.toggle('is-bad', !!text);
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
    document.getElementById(input.getAttribute('aria-describedby')).textContent = text;
    return !text;
  }
  function checkMessage() {
    var text = message.value.trim();
    return setError(message,
      !text ? 'Tell us what’s on your mind.' :
      text.length < MIN_LENGTH ? 'A little more, please: ' + MIN_LENGTH + ' characters or so.' : '');
  }
  function checkEmail() {
    var text = email.value.trim();
    return setError(email, text && !email.checkValidity() ? 'That email doesn’t look right.' : '');
  }

  // Once a field has been marked wrong, it is re-checked as it is fixed.
  message.addEventListener('input', function () {
    countUp();
    if (message.getAttribute('aria-invalid') === 'true') checkMessage();
  });
  email.addEventListener('input', function () {
    if (email.getAttribute('aria-invalid') === 'true') checkEmail();
  });

  /* --- sending ---------------------------------------------------------- */
  function setBusy(busy) {
    submit.disabled = busy;
    submitLabel.textContent = busy ? 'Sending…' : 'Send feedback';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var ok = checkMessage();
    ok = checkEmail() && ok;
    if (!ok) {
      form.querySelector('[aria-invalid="true"]').focus();
      return;
    }
    sendErr.textContent = '';
    setBusy(true);
    Promise.resolve(send({
      kind: form.elements.kind.value,
      message: message.value.trim(),
      email: email.value.trim() || null,
      page: location.pathname,
      at: new Date().toISOString()
    })).then(function () {
      form.hidden = true;
      done.hidden = false;
      document.getElementById('fbDoneTitle').focus();
    }, function () {
      sendErr.textContent = 'That didn’t go through. Try again in a moment.';
    }).then(function () { setBusy(false); });
  });

  return dialog;
}
