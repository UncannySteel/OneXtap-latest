import markup from './footer.html?raw';
import './footer.css';

export { markup };

/* --- the footer: its mark rises as the close lifts away ------------------ */
export function initFooter() {
  var mark = document.querySelector('.foot__mark');
  return {
    enter: function (tl, at) {
      tl.fromTo(mark, { yPercent: 55, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, at);
    }
  };
}
