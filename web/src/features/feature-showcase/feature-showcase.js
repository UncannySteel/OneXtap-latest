import { headlineWords, riseWords } from '../../shared/lib/reveal-headlines.js';
import markup from './feature-showcase.html?raw';
import './feature-tabs.css';
import './rail.css';
import './demo-form.css';

export { markup };
export { initFeatureTabs } from './feature-tabs.js';
export { initRail } from './rail.js';
export { initDemoForm } from './demo-form.js';

/* --- CH 02 on the stage: the bar and the deck rise in under the headline,
   then the chapter holds so the deck can be played with ------------------ */
export function initFeatureChapter() {
  var words = headlineWords(document.querySelector('#how [data-split]'));
  var lines = document.querySelectorAll('#how .fbar, #how .feat-line');
  var rail = document.getElementById('rail');
  return {
    enter: function (tl, at) {
      riseWords(tl, words, at);
      tl.fromTo(lines, { y: 24, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4, stagger: 0.08, ease: 'power2.out' }, at + 0.15);
      tl.fromTo(rail, { y: 42, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }, at + 0.3);
    },
    body: function () { return 0.9; }
  };
}
