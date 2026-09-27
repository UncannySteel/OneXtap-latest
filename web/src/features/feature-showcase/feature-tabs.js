import { FEATURES } from './features.data.js';
import { buildCard } from './cards.js';

/* --- CH 02: the feature bar ---------------------------------------------
   Six features, one rail of cards each. This is mounted *before* the
   no-motion check on purpose: the tabs are content, not decoration, so they
   have to switch even when nothing is allowed to animate. When the rail is
   live it installs a swap handler, and the cards change in the middle of
   the spin instead. ---------------------------------------------------- */
export function initFeatureTabs() {
  var featTrack = document.getElementById('railTrack');
  var featBar = document.getElementById('fbar');
  var featThumb = document.getElementById('fbarThumb');
  var featDesc = document.getElementById('featDesc');
  var featBtns = featBar ? Array.prototype.slice.call(featBar.querySelectorAll('[data-feature]')) : [];
  var activeFeature = 'autofill';
  var onFeatureSwap = null;   // the rail installs its spin here

  function feature(key) {
    for (var i = 0; i < FEATURES.length; i++) if (FEATURES[i].key === key) return FEATURES[i];
    return FEATURES[0];
  }

  // The default feature's cards are the markup that shipped, so nothing is
  // written twice; every other set is built once and kept.
  if (featTrack) FEATURES[0].nodes = Array.prototype.slice.call(featTrack.children);

  function nodesFor(f) {
    if (!f.nodes) f.nodes = f.cards.map(buildCard);
    return f.nodes;
  }

  // Swaps the cards. Returns nothing: the rail re-measures itself afterwards.
  function paintFeature(key) {
    var f = feature(key);
    while (featTrack.firstChild) featTrack.removeChild(featTrack.firstChild);
    nodesFor(f).forEach(function (n) { featTrack.appendChild(n); });
    featDesc.textContent = f.desc;
    featDesc.classList.remove('is-swapping');
  }

  function moveThumb() {
    if (!featBar || !featThumb) return;
    var btn = featBar.querySelector('[aria-selected="true"]');
    if (!btn) return;
    var ib = featBar.getBoundingClientRect();
    var bb = btn.getBoundingClientRect();
    featThumb.style.width = bb.width + 'px';
    featThumb.style.transform =
      'translateX(' + (bb.left - ib.left - featBar.clientLeft + featBar.scrollLeft) + 'px)';
  }

  function btnFor(key) {
    for (var i = 0; i < featBtns.length; i++) {
      if (featBtns[i].getAttribute('data-feature') === key) return featBtns[i];
    }
    return null;
  }

  function selectFeature(key) {
    if (key === activeFeature) return;
    activeFeature = key;
    featBtns.forEach(function (b) {
      var on = b.getAttribute('data-feature') === key;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) document.getElementById('rail').setAttribute('aria-labelledby', b.id);
    });
    // On a narrow screen the bar scrolls; bring the chosen tab into view
    // before placing the thumb, or it lands on where the tab used to be.
    if (btnFor(key)) btnFor(key).scrollIntoView({ inline: 'nearest', block: 'nearest' });
    moveThumb();
    featDesc.classList.add('is-swapping');
    if (onFeatureSwap) onFeatureSwap(key);   // spin, then swap mid-spin
    else paintFeature(key);                  // no motion: change outright
  }

  featBtns.forEach(function (b) {
    b.addEventListener('click', function () { selectFeature(b.getAttribute('data-feature')); });
  });
  if (featBar) {
    featBar.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var i = featBtns.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      var next = featBtns[(i + (e.key === 'ArrowRight' ? 1 : featBtns.length - 1)) % featBtns.length];
      next.focus();
      selectFeature(next.getAttribute('data-feature'));
    });
    // The thumb is placed by measurement, so every input to that measurement
    // has to re-place it: the webfont landing, a width change, the bar being
    // scrolled. A ResizeObserver covers the cases a resize event misses.
    moveThumb();
    featBar.addEventListener('scroll', moveThumb, { passive: true });
    window.addEventListener('resize', moveThumb);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(moveThumb).observe(featBar);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        moveThumb();
        requestAnimationFrame(moveThumb);   // after the reflow the swap causes
        document.querySelector('.fbar').classList.add('is-ready');
      });
    } else {
      document.querySelector('.fbar').classList.add('is-ready');
    }
  }

  return {
    paintFeature: paintFeature,
    setSwapHandler: function (fn) { onFeatureSwap = fn; }
  };
}
