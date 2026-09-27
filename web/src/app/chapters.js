import { cover, curtain, iris } from '../shared/transitions/sheets.js';
import { curl } from '../shared/transitions/paper.js';
import { blot } from '../shared/transitions/blot.js';

/* ===========================================================================
   The page, in order: each chapter's layer, the transition that brings it
   on, and the chapter's own scenes (from its feature — `enter` places its
   entrance on the timeline, `body` its animation once it has arrived).
   Durations are in screens of scrolling. Reorder or re-pair transitions
   here; nothing else needs to know.

   The one idea running through all of it: the page is a stack of paper.
   Sheets are dealt over each other, torn, crumpled up and thrown away,
   sunk out of sight, peeled back, and finally soaked through with ink.
   =========================================================================== */
export function pageChapters(scenes) {
  function chapter(el, transition, scene, extra) {
    return Object.assign({ el: el, transition: transition }, scene, extra);
  }
  var byId = function (id) { return document.getElementById(id); };

  return [
    // 00 — the hiring sign; its own scene crumples the sign off the truth.
    chapter(byId('hero'), null, scenes.hero),

    // 01 — the form is dealt over the correction.
    chapter(byId('form'), cover({ duration: 1 }), scenes.form),

    // 02 — …and sinks away through a closing vignette onto the features.
    chapter(byId('how'), iris({ duration: 1.2 }), scenes.features),

    // 02 — a torn-off sheet: the demo, typing itself.
    chapter(byId('watch'), cover({ duration: 1, torn: true, sink: 1.5 }), scenes.demo),

    // 03 — the demo is peeled back to the job boards.
    chapter(byId('boards'), curl({ duration: 1.3, priority: 2 }), scenes.boards),

    // 04 — pricing lands on top, squaring up as it settles.
    chapter(byId('price'), cover({ duration: 1, tilt: 3.5, sink: 2.5 }), scenes.pricing),

    // 05 — citrine soaks out from the Premium button.
    chapter(document.querySelector('.close'), blot({ duration: 1.15, from: '.plan .btn--solid' }), scenes.closing),

    // The close lifts away like a lid, leaving the footer.
    chapter(document.querySelector('.foot'), curtain({ duration: 1 }), scenes.footer, { hold: 0 })
  ];
}
