import { h, fill } from './ui/dom.js';
import { button } from './ui/controls.js';

// The first-run tour, as the backend's TourOverlay ran it: a few steps
// pointing at the dashboard's own controls, shown once, to an account created
// in the last couple of minutes (main.js decides; `onextap_tutorial_seen`
// remembers). A citrine ring around the thing, a small oat card beside it.

const STEPS = [
  {
    target: '#nav',
    title: 'Your workspaces',
    text: 'Job Matches, My Profiles, Answer Studio and Cover Letter. Everything you set up here is what the extension fills applications with.',
  },
  {
    target: '.nav-link[data-id="my-profiles"]',
    title: 'Start with your profile',
    text: 'Add your details, education, experience and skills — or upload a resume and they are filled in for you.',
  },
  {
    target: '.nav-link[data-id="answer-studio"]',
    title: 'Answer Studio',
    text: 'Save answers to the questions applications keep asking, and let the AI draft ones tailored to a job description.',
  },
  {
    target: '#settings-trigger',
    title: 'Your account',
    text: 'Your credits, your plan and your account settings live here.',
  },
];

const GAP = 12;

export function startTour({ onDone } = {}) {
  let step = 0;
  let finished = false;
  const ring = h('div.tour-ring', { 'aria-hidden': 'true' });
  const card = h('div.tour-card', { role: 'dialog', 'aria-labelledby': 'tour-title', 'aria-describedby': 'tour-text' });
  const root = h('div.tour', null, ring, card);
  document.body.append(root);

  function target() {
    return document.querySelector(STEPS[step].target);
  }

  function place() {
    const el = target();
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    Object.assign(ring.style, {
      top: `${r.top - pad}px`,
      left: `${r.left - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Below the target if it fits, else above; clamped into the window.
    let top = r.bottom + pad + GAP;
    if (top + ch > vh - 16) top = Math.max(16, r.top - pad - GAP - ch);
    let left = r.left + r.width / 2 - cw / 2;
    left = Math.min(Math.max(16, left), vw - cw - 16);
    Object.assign(card.style, { top: `${top}px`, left: `${left}px` });
  }

  function render() {
    const last = step === STEPS.length - 1;
    const next = button(last ? 'Done' : 'Next', { kind: 'solid', size: 'sm', arrow: !last, onClick: advance });
    fill(card,
      h('p.label.tour-step', null, `${step + 1} of ${STEPS.length}`),
      h('h2.tour-title', { id: 'tour-title' }, STEPS[step].title),
      h('p.tour-text', { id: 'tour-text' }, STEPS[step].text),
      h('div.tour-actions', null,
        button('Skip tour', { kind: 'ghost', size: 'sm', onClick: finish }),
        next));
    place();
    next.focus();
  }

  function advance() {
    if (step < STEPS.length - 1) {
      step += 1;
      render();
    } else {
      finish();
    }
  }

  function finish() {
    if (finished) return;
    finished = true;
    window.removeEventListener('resize', place);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('hashchange', finish);
    root.remove();
    onDone?.();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish();
    }
  }

  window.addEventListener('resize', place);
  window.addEventListener('keydown', onKey, true);
  // Opening a workspace ends it, as clicking the sidebar did.
  window.addEventListener('hashchange', finish);
  render();
  return { finish };
}
