import { headlineWords, riseWords } from '../../shared/lib/reveal-headlines.js';
import markup from './job-boards.html?raw';
import './job-boards.css';

export { markup };

/* --- CH 03: the rows run on their own and drift further with the scroll,
   in opposite directions. The drift moves the groups, not the track: the
   track's transform belongs to its CSS loop, which would override it. ---- */
export function initJobBoards() {
  var words = headlineWords(document.querySelector('#boards [data-split]'));
  var rows = document.querySelectorAll('#boards .marquee');
  return {
    enter: function (tl, at) { riseWords(tl, words, at); },
    body: function (tl, at) {
      // From while the page above is still peeling off, until this one is
      // being covered in turn.
      rows.forEach(function (row, i) {
        tl.fromTo(row.querySelectorAll('.marquee__group'), { xPercent: 0 },
          { xPercent: i ? 9 : -9, duration: 2.8, ease: 'none', immediateRender: false }, at - 1);
      });
      return 0.9;
    }
  };
}
