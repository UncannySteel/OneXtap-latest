import { reducedMotion } from './motion.js';

let transitionSeq = 0;

/**
 * Runs a DOM update inside a View Transition when the browser supports it.
 * `kind` ('enter' | 'swap' | 'leave') is set on <html> as data-vt for the
 * length of the transition, so the CSS can choreograph the workspace sheet.
 */
export function transition(update, kind = '') {
  if (!document.startViewTransition || reducedMotion.matches) {
    update();
    return;
  }
  const root = document.documentElement;
  const seq = ++transitionSeq;
  if (kind) root.dataset.vt = kind;
  else delete root.dataset.vt;
  const vt = document.startViewTransition(update);
  // An aborted transition (e.g. tab hidden mid-animation) still applies the update; ignore the rejection.
  vt.ready.catch(() => {});
  const done = () => {
    if (seq === transitionSeq) delete root.dataset.vt;
  };
  vt.finished.then(done, done);
}

export const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable — state just won't persist */
    }
  },
};

let toastTimer;
/**
 * A one-line notice at the foot of the screen. `type` is 'success' (the
 * default), 'error' (a clay dot, and it stays a little longer) or 'loading'
 * (a spinning dot, until the next toast replaces it).
 */
export function toast(message, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.dataset.type = type;
  el.setAttribute('data-show', '');
  clearTimeout(toastTimer);
  if (type === 'loading') return;
  toastTimer = setTimeout(() => el.removeAttribute('data-show'), type === 'error' ? 5200 : 3200);
}
