import { el } from '../../shared/lib/dom.js';
import markup from './nav.html?raw';
import './nav.css';

export { markup };

/* --- the spine and the chapter menu --------------------------------------
   The burger opens a full-screen menu of the chapters. A jump link (any
   a[data-jump]: the menu's, the spine's mark, the header's wordmark) goes
   straight to its chapter instead of scrolling through the story on the
   way. How the page gets there is given by setJump: on the stage every
   chapter sits at one place on screen, and only the stage knows where in
   the scroll each one is. Until then (no motion) the browser just follows
   the anchor. Works with or without motion, like the header.

   `opts.home` is for a page other than the landing page (the company pages,
   src/pages/): the chapters all live back there, so every jump link goes
   home to its chapter instead, and the landing page lands on it
   (src/app/arrival.js). */
export function initNav(opts) {
  var home = opts && opts.home;
  var burger = document.getElementById('burger');
  var menu = document.getElementById('siteMenu');
  var page = document.querySelector('[data-page]');   // what the open menu covers
  var items = Array.prototype.slice.call(menu.querySelectorAll('.menu__list li'));
  var open = false, everOpened = false;
  var toggled = [], jump = null;

  // Each link gets an italic twin to roll to on hover (nav.css). Decoration
  // only: the link's name is still its own text.
  menu.querySelectorAll('.menu__link').forEach(function (a) {
    var text = a.textContent.trim();
    var twin = el('span', 'menu__word menu__word--alt', text);
    twin.setAttribute('aria-hidden', 'true');
    a.textContent = '';
    a.appendChild(el('span', 'menu__word', text));
    a.appendChild(twin);
  });

  document.getElementById('menuYear').textContent = new Date().getFullYear();

  // #top is the start of the story, which is just the landing page.
  if (home) {
    document.querySelectorAll('a[data-jump]').forEach(function (a) {
      var hash = a.getAttribute('href');
      if (hash.charAt(0) === '#') a.setAttribute('href', hash === '#top' ? home : home + hash);
    });
  }

  function setOpen(next) {
    if (next === open) return;
    open = next;
    if (open) everOpened = true;
    menu.classList.toggle('is-open', open);
    document.documentElement.classList.toggle('menu-open', open);
    // Inert rather than hidden, which only lands at the end of the fade: a
    // closed menu cannot be tabbed into, and nothing behind an open one can
    // (the stage would scroll to whatever took focus).
    menu.inert = !open;
    page.inert = open;
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (everOpened) burger.dataset.state = open ? 'open' : 'closed';
    items.forEach(function (li, i) {
      li.style.transitionDelay = open ? (100 + i * 45) + 'ms' : '0ms';
    });
    toggled.forEach(function (fn) { fn(open); });
  }

  burger.addEventListener('click', function () { setOpen(!open); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !open) return;
    setOpen(false);
    burger.focus();
  });

  document.addEventListener('click', function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // a new tab or window
    var link = e.target.closest && e.target.closest('a[data-jump]');
    var href = link && link.getAttribute('href');
    // A chapter on another page (see `home`) is an ordinary link there.
    var target = href && href.charAt(0) === '#' && document.querySelector(href);
    if (!target) return;
    setOpen(false);            // hand the page back before moving it
    if (!jump) return;
    e.preventDefault();
    jump(target);
    // Focus follows, so Tab carries on from the chapter, not from a link
    // that has just been hidden.
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });

  // A button that opens a window (the header's Log in, which the open menu
  // does not cover) takes over from the menu: the menu closes first, in the
  // capture phase, so the window then holds the page as it finds it.
  document.addEventListener('click', function (e) {
    if (open && e.target.closest && e.target.closest('[aria-haspopup="dialog"]')) setOpen(false);
  }, true);

  // Back from another page, the browser may hand this one back exactly as
  // it was left: with the menu still open over it, if a menu link led away.
  window.addEventListener('pageshow', function (e) { if (e.persisted) setOpen(false); });

  return {
    onToggle: function (fn) { toggled.push(fn); },
    setJump: function (fn) { jump = fn; }
  };
}
