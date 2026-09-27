import { headlineWords, riseWords } from '../../shared/lib/reveal-headlines.js';

/* --- CH 02, in practice: the form types itself as you scroll ------------ */
export function initDemoForm() {
  var rows = Array.prototype.slice.call(document.querySelectorAll('[data-demo]'));
  var words = headlineWords(document.querySelector('#watch [data-split]'));
  var demo = document.getElementById('demo');

  return {
    enter: function (tl, at) {
      riseWords(tl, words, at);
      tl.fromTo(demo, { y: 44, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }, at + 0.15);
    },
    body: function (tl, at) {
      // Each field types for as long as its text is — the drafted answer
      // takes the longest — and starts just before the last one finishes.
      var t = at + 0.1;
      rows.forEach(function (row) {
        var span = Math.max(0.6, row.querySelector('.demo__v').textContent.length / 90) * 0.34;
        tl.fromTo(row, { '--fill': 0 }, {
          '--fill': 1, duration: span, ease: 'none',
          onStart: function () { row.classList.add('is-typing'); },
          onComplete: function () { row.classList.remove('is-typing'); },
          onReverseComplete: function () { row.classList.remove('is-typing'); }
        }, t);
        t += span - 0.03;
      });
      return t - at;
    }
  };
}
