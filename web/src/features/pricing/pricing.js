import { headlineWords, riseWords } from '../../shared/lib/reveal-headlines.js';
import markup from './pricing.html?raw';
import './pricing.css';

export { markup };

/* --- CH 04: the plans drift up under the headline ----------------------- */
export function initPricing() {
  var words = headlineWords(document.querySelector('#price [data-split]'));
  // The slots, not the cards: GSAP pins a tweened element's independent
  // `translate` to none inline, which would cancel the cards' hover lift.
  var plans = document.querySelectorAll('.plans__slot');
  return {
    enter: function (tl, at) {
      riseWords(tl, words, at);
      tl.fromTo(plans, { y: 34, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.45, stagger: 0.1, ease: 'power3.out' }, at + 0.15);
    },
    body: function () { return 0.6; }
  };
}
