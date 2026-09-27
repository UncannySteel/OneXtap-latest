import { reducedMotion } from './motion.js';

// The landing page's cursor (demo: features/cursor): a citrine ring that trails
// the pointer and swells over anything clickable. Over the dock's bar it turns
// into a grip labelled "Drag", which closes while the dock is dragged. Fine
// pointers only; the system cursor stays everywhere except over the bar.

const HOT = 'a, button, [role="menuitem"], label, input';
const FOLLOW_MS = 70; // time constant of the trail (≈ the landing's 0.35s power3 quickTo)

const markup = `
  <div class="cursor" aria-hidden="true">
    <span class="cursor-ring"></span>
    <span class="cursor-grip">
      <svg class="cursor-icon cursor-icon-open" viewBox="0 0 24 24">
        <path d="M9 12.6V6.4a1.4 1.4 0 0 1 2.8 0v6.2"/>
        <path d="M11.8 12.6V5.6a1.4 1.4 0 0 1 2.8 0v7"/>
        <path d="M14.6 12.6V6.9a1.4 1.4 0 0 1 2.8 0v5.7"/>
        <path d="M9 12.6v-1.2a1.4 1.4 0 0 0-2.8 0v3.1a5.3 5.3 0 0 0 5.3 5.3h1.7a4.4 4.4 0 0 0 4.4-4.4v-2.8"/>
      </svg>
      <svg class="cursor-icon cursor-icon-closed" viewBox="0 0 24 24">
        <path d="M5.6 12.4v2.1a5.3 5.3 0 0 0 5.3 5.3h1.7a4.4 4.4 0 0 0 4.4-4.4v-3.5"/>
        <path d="M8.8 11.9v-1.4a1.4 1.4 0 0 1 2.8 0v1.3"/>
        <path d="M11.6 11.8v-1.8a1.4 1.4 0 0 1 2.8 0v1.7"/>
        <path d="M14.4 11.9v-1.4a1.4 1.4 0 0 1 2.6 0v1.4"/>
        <path d="M8.8 11.9v-1.2a1.4 1.4 0 0 0-2.8 0v1.4"/>
      </svg>
    </span>
    <span class="cursor-label">Drag</span>
  </div>`;

export function initCursor(app) {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches || reducedMotion.matches) return;

  document.body.insertAdjacentHTML('beforeend', markup);
  const el = document.body.lastElementChild;
  document.documentElement.classList.add('has-fine-cursor');

  const pos = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  let frame = 0;
  let last = 0;

  const tick = (now) => {
    const k = 1 - Math.exp(-(now - last) / FOLLOW_MS);
    last = now;
    pos.x += (target.x - pos.x) * k;
    pos.y += (target.y - pos.y) * k;
    el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    frame = Math.hypot(target.x - pos.x, target.y - pos.y) > 0.1 ? requestAnimationFrame(tick) : 0;
  };

  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    target.x = e.clientX;
    target.y = e.clientY;
    if (!el.classList.contains('is-on')) {
      pos.x = target.x;
      pos.y = target.y;
      el.classList.add('is-on');
    }
    if (!frame) {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }, { passive: true });

  document.documentElement.addEventListener('mouseleave', () => el.classList.remove('is-on'));

  // What the pointer is over sets the state. (Pointer capture while dragging or
  // resizing holds these events back, so the state holds too.)
  addEventListener('pointerover', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const sash = !!t.closest('.dock-resize');
    const drag = !sash && !t.closest('[data-dock-to]') && !!t.closest('.dock-bar');
    el.classList.toggle('is-hidden', sash);
    el.classList.toggle('is-drag', drag);
    el.classList.toggle('is-hot', !sash && !drag && !!t.closest(HOT));
  });

  // dock.js marks the app while the dock is being dragged: the hand closes.
  new MutationObserver(() => el.classList.toggle('is-dragging', app.classList.contains('is-dragging')))
    .observe(app, { attributes: true, attributeFilter: ['class'] });
}
