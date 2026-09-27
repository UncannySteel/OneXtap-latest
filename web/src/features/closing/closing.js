import { headlineWords, riseWords } from '../../shared/lib/reveal-headlines.js';
import markup from './closing.html?raw';
import './closing.css';

export { markup };

/* --- CH 05: once the citrine has soaked the page, the offer rises -------- */
export function initClosing() {
  var words = headlineWords(document.querySelector('.close [data-split]'));
  var row = document.querySelector('.close__row');
  return {
    enter: function (tl, at) {
      riseWords(tl, words, at, 0.5);
      tl.fromTo(row, { y: 24, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.35, ease: 'power2.out' }, at + 0.25);
    },
    body: function () { return 0.5; }
  };
}
