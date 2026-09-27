/* ===========================================================================
   Coming to the landing page from another page
   Two ways in land somewhere other than the start of the story:

   - A company page's menu (or its foot) links to a chapter here, /#price.
     Land on it the way the menu would have, in one step, and drop the hash,
     as a jump leaves none.
   - Back (or Forward) from a company page. Put the reader where they left
     the story: leaving, the place is kept on this history entry. Browsers
     restore the scroll themselves, but onto a stage that may still be laying
     itself out (WebKit holds back the page's CSS until the fonts' stylesheet
     is in), so they can miss.

   The stage measures itself again once the fonts and the page have loaded
   (stage.js), which can move where a chapter or a moment sits, so each lands
   again then, unless the reader has already moved off. A page brought back
   whole from the back/forward cache needs none of it.
   =========================================================================== */
export function initArrival(opts) {
  var stage = opts.stage;
  var entry = window.performance && performance.getEntriesByType
    ? performance.getEntriesByType('navigation')[0] : null;
  var returning = !!(entry && entry.type === 'back_forward');

  // Where in the story the reader is, in screens along the timeline.
  window.addEventListener('pagehide', function () {
    var i = stage.info();
    var state = Object.assign({}, history.state, { storyAt: (window.scrollY - i.top) / i.unit });
    history.replaceState(state, '');
  });

  var land = null;
  var at = history.state && history.state.storyAt;
  if (returning && typeof at === 'number') {
    land = function () { opts.scrollTo(stage.info().top + at * stage.info().unit); };
  } else if (!returning && location.hash) {
    var target = document.getElementById(location.hash.slice(1));
    if (target) {
      history.replaceState(history.state, '', location.pathname + location.search);
      land = function () { opts.jump(target); };
    }
  }
  if (!land) return;

  var moved = false;
  ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function (type) {
    window.addEventListener(type, function () { moved = true; }, { once: true, passive: true });
  });
  land();
  var loaded = document.readyState === 'complete' ? null
    : new Promise(function (done) { window.addEventListener('load', done, { once: true }); });
  Promise.all([loaded, document.fonts && document.fonts.ready]).then(function () {
    if (!moved) land();
  });
}
