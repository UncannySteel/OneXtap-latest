import { log as baseLog } from '@app/logger.js';

var log = baseLog.child('mount');

// Swaps each `[data-mount="name"]` placeholder for that feature's markup, so the
// live DOM is exactly what the single-file page shipped — no wrapper elements.
export function mountFeatures(features) {
  document.querySelectorAll('[data-mount]').forEach(function (slot) {
    var name = slot.getAttribute('data-mount');
    var feature = features[name];
    if (!feature) {
      log.warn('No feature registered for data-mount="' + name + '"');
      return;
    }
    var tpl = document.createElement('template');
    tpl.innerHTML = feature.markup.trim();
    slot.replaceWith(tpl.content);
  });
}
