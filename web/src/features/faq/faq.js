import { createDialog } from '../../shared/lib/dialog.js';
import markup from './faq.html?raw';
import './faq.css';

export { markup };

/* --- the FAQ window -------------------------------------------------------
   Any [data-faq] button opens it (CH 05, "Get hired"); it opens, closes and
   holds the page as every window does (shared/lib/dialog.js). It opens with
   every answer folded away, and the first question in focus. */
export function initFaq() {
  var root = document.getElementById('faq');
  var items = root.querySelectorAll('.acc__item');
  return createDialog(root, {
    trigger: '[data-faq]',
    reset: function () { items.forEach(function (d) { d.open = false; }); },
    focus: function () { return items[0].querySelector('summary'); }
  });
}
