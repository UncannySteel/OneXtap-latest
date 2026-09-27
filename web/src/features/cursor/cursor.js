import { gsap } from 'gsap';
import markup from './cursor.html?raw';
import './cursor.css';

export { markup };

/* --- cursor ------------------------------------------------------------
   Returns the element and whether the pointer is fine, because the feature
   rail drives the cursor's drag states too. */
export function initCursor() {
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var cursorEl = document.getElementById('cursor');

  if (fine) {
    document.documentElement.classList.add('has-fine-cursor');
    var qx = gsap.quickTo(cursorEl, 'x', { duration: 0.35, ease: 'power3' });
    var qy = gsap.quickTo(cursorEl, 'y', { duration: 0.35, ease: 'power3' });
    window.addEventListener('mousemove', function (e) {
      cursorEl.classList.add('is-on'); qx(e.clientX); qy(e.clientY);
    }, { passive: true });
    document.querySelectorAll('a, button, .marquee').forEach(function (el) {
      el.addEventListener('mouseenter', function () { cursorEl.classList.add('is-hot'); });
      el.addEventListener('mouseleave', function () { cursorEl.classList.remove('is-hot'); });
    });
  }

  return { el: cursorEl, fine: fine };
}
