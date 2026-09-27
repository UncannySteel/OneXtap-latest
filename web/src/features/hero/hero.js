import { headlineWords } from '../../shared/lib/reveal-headlines.js';
import { paperExit } from '../../shared/transitions/paper.js';
import markup from './hero.html?raw';
import './hero.css';

export { markup };

/* --- CH 00: the sign is struck through, crumpled up and thrown away, and
   the truth it was covering is read out underneath ----------------------- */
export function initHero() {
  var sign = document.getElementById('signLayer');
  var aside = document.getElementById('aside');
  var truthWords = headlineWords(document.querySelector('.truth__title'));
  var truthRest = document.querySelectorAll('.truth__body, .truth__actions');

  return {
    body: function (tl, at, ctx) {
      tl.fromTo('#strike', { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: 'power3.inOut' }, at + 0.1)
        .fromTo('.sign__cue', { opacity: 1 }, { opacity: 0, duration: 0.12 }, at + 0.1);

      // Struck out, then screwed up and thrown off to the top right.
      paperExit(tl, {
        el: sign, at: at + 0.55, duration: 1.3, mode: 'crumple',
        seed: 3.7, toss: [0.95, 0.5], spin: 1, priority: 0
      }, ctx);

      tl.fromTo(aside, { yPercent: 40, opacity: 0 },
          { yPercent: 0, opacity: 1, duration: 0.35, ease: 'power3.out' }, at + 1.3)
        .fromTo(truthWords, { yPercent: 105 },
          { yPercent: 0, duration: 0.45, stagger: 0.03, ease: 'power3.out' }, at + 1.45)
        .fromTo(truthRest, { y: 26, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.35, stagger: 0.08, ease: 'power2.out' }, at + 1.75);
      return 2.25;
    }
  };
}
