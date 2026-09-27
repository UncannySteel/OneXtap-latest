/* --- the calls to action, pointed at the product ---------------------------
   The landing page's buttons, given somewhere to go. Nothing here changes
   how they look; it decides what pressing them does (src/app/backend.js
   holds the actual sign-in, feedback and links).

   [data-cta="chrome"]   Add to Chrome — the Chrome Web Store listing.
   [data-cta="start"]    Get started free — signed out, the sign-up window;
                         signed in, its link (the dashboard).
   [data-cta="upgrade"]  Upgrade to Premium — the same, with the dashboard's
                         subscription panel open when they arrive.
   .hud__login           Log in — signed in already, it says Dashboard and
                         goes there instead of opening the window. */
import { hasSession, goToDashboard, openChromeWebStore } from './backend.js';

// Only the dashboard may be sent to after sign-in: `next` arrives in the
// address bar, and an open redirect is how phishing borrows a real domain.
function safeNext(value) {
  return typeof value === 'string' && /^\/dashboard\/(?!\/)/.test(value) ? value : null;
}

/* The header row, on every page that has one. */
export function wireHeader() {
  document.querySelectorAll('[data-cta="chrome"]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      openChromeWebStore();
    });
  });

  var loginBtn = document.querySelector('.hud__login');
  if (loginBtn && hasSession()) {
    loginBtn.textContent = 'Dashboard';
    loginBtn.removeAttribute('data-login');
    loginBtn.removeAttribute('aria-haspopup');
    loginBtn.addEventListener('click', function () { goToDashboard(); });
  }
}

/* The offers on the landing page: the two plans. `login` is initLogin()'s
   window, for the sign-up that stands between a visitor and the dashboard. */
export function wireOffers(login) {
  document.querySelectorAll('[data-cta="start"], [data-cta="upgrade"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      if (hasSession()) return;             // the link itself goes to the dashboard
      e.preventDefault();
      login.openAs('up', link.getAttribute('href'));
    });
  });
}

/* Arriving to sign in: the dashboard sends signed-out visitors here with
   ?login (or ?signup), and where they were going as ?next. The window opens
   on arrival, and the address is tidied so a reload does not open it again.
   It opens even if a session seems to be stored: the dashboard only sends
   someone here when that session did not work, and forwarding them straight
   back would loop. */
export function openOnArrival(login) {
  var params = new URLSearchParams(location.search);
  var mode = params.has('signup') ? 'up' : params.has('login') ? 'in' : null;
  if (!mode) return;
  var next = safeNext(params.get('next'));
  ['login', 'signup', 'next'].forEach(function (k) { params.delete(k); });
  var rest = params.toString();
  history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
  login.openAs(mode, next || undefined);
}
