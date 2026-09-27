import markup from './hud.html?raw';
import './hud.css';

export { markup };

/* --- chapter label + scroll progress (works with or without GSAP) ------ */
export function initHud() {
  // The header row: the header, and anything else sharing it (the nav's
  // bar on phones), all take the same ink.
  var topEls = document.querySelectorAll('.hud, [data-header-row]');
  var hudFootEl = document.querySelector('.hud-foot');

  // Both questions — what ground is under the header, which chapter is on
  // screen — are asked of whatever is actually painted at a point. That
  // works the same for chapters in normal flow and for the stage, where
  // every chapter sits at the same place and only the one on top counts.
  // (clip-path and visibility clip hit-testing too, so a sheet that is
  // mid-exit answers only where it is still drawn.)
  function stackAt(y) {
    return document.elementsFromPoint(Math.round(window.innerWidth / 2), y);
  }
  function closestIn(stack, attr) {
    for (var i = 0; i < stack.length; i++) {
      var g = stack[i].closest && stack[i].closest('[' + attr + ']');
      if (g) return g.getAttribute(attr);
    }
    return null;
  }
  // Effects painted in WebGL are not in the DOM to be hit-tested; the stage
  // answers for them when it is running (see setOverlay below). Something
  // covering the whole page (data-cover: the open menu) is above those too.
  var overlay = null;
  function groundAt(y) {
    var stack = stackAt(y);
    return closestIn(stack, 'data-cover') ||
      (overlay && overlay(Math.round(window.innerWidth / 2), y)) ||
      closestIn(stack, 'data-ground') || 'ink';
  }
  function paintHud() {
    var top = groundAt(26) === 'ink' ? 'light' : 'dark';
    topEls.forEach(function (el) { el.dataset.hud = top; });
    hudFootEl.dataset.hud = groundAt(window.innerHeight - 26) === 'ink' ? 'light' : 'dark';
  }

  var labelEl = document.getElementById('chapterLabel');
  var barEl = document.getElementById('progressBar');
  var pctEl = document.getElementById('progressPct');

  function updateHud() {
    queued = false;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    barEl.style.width = (p * 100).toFixed(1) + '%';
    pctEl.textContent = String(Math.round(p * 100)).padStart(2, '0');

    var current = closestIn(stackAt(Math.round(window.innerHeight * 0.55)), 'data-chapter');
    if (current && labelEl.textContent !== current) labelEl.textContent = current;
    paintHud();
  }

  // Read on the next frame rather than inside the scroll event: by then the
  // scroll-driven animation for this position has been applied, so the HUD
  // reads the layers as they are about to be painted, not a frame stale.
  var queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(updateHud);
  }
  updateHud();
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  return {
    refresh: queue,
    setOverlay: function (fn) { overlay = fn; queue(); }
  };
}
