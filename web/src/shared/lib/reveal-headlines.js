import { splitWords } from './split-words.js';

/* --- section headlines: masked words that rise into place ----------------
   Split once at boot; each chapter then decides where on the page timeline
   its headline rises (see src/app/chapters.js). Scrubbed, not fired once, so
   scrolling back lowers the words again. */
export function headlineWords(el) {
  return el ? splitWords(el) : [];
}

export function riseWords(tl, words, at, duration) {
  if (!words || !words.length) return;
  tl.fromTo(words, { yPercent: 105 },
    { yPercent: 0, duration: duration || 0.45, stagger: 0.035, ease: 'power3.out' }, at);
}
