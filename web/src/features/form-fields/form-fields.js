import { headlineWords, riseWords } from '../../shared/lib/reveal-headlines.js';
import markup from './form-fields.html?raw';
import './form-fields.css';

export { markup };

/* --- CH 01: the fields are struck through one by one as you scroll, and
   the tally counts them off in step ------------------------------------- */
export function initFormFields() {
  var words = headlineWords(document.querySelector('#form [data-split]'));
  var fields = document.querySelectorAll('#fieldList .field');
  var tally = document.getElementById('tally');
  var STEP = 0.09, EACH = 0.22;

  function show(n) { tally.textContent = String(Math.round(n)).padStart(2, '0'); }
  show(0);

  return {
    enter: function (tl, at) { riseWords(tl, words, at); },
    body: function (tl, at) {
      var counter = { v: 0 };
      var span = EACH + STEP * (fields.length - 1);
      tl.fromTo(fields, { '--fill': 0 },
        { '--fill': 1, duration: EACH, stagger: STEP, ease: 'none' }, at + 0.05);
      tl.fromTo(counter, { v: 0 }, {
        v: fields.length, duration: span, ease: 'none',
        onUpdate: function () { show(counter.v); }
      }, at + 0.05);
      return 0.05 + span;
    }
  };
}
