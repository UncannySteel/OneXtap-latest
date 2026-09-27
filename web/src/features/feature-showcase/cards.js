import { el, SVG_NS } from '../../shared/lib/dom.js';
import { ICONS } from './icons.js';
import { TONES } from './features.data.js';

function iconTile(name) {
  var tile = el('span', 'rcard__ic');
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  (ICONS[name] || ICONS.check).forEach(function (d) {
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  });
  tile.appendChild(svg);
  return tile;
}

function miniRow(k, v, ok) {
  var row = el('div', 'mini__row');
  row.appendChild(el('span', 'mini__k', k));
  row.appendChild(el('span', 'mini__v', v));
  if (ok) row.appendChild(el('span', 'mini__ok', ok));
  return row;
}

/* A small mock of the thing the card describes. Decorative — the card's own
   text already says it — so the whole window is hidden from assistive tech
   rather than read out as a pile of unlabelled fragments. */
function buildMini(kind) {
  var win = el('div', 'mini');
  win.setAttribute('aria-hidden', 'true');
  var bar = el('div', 'mini__bar');
  bar.appendChild(el('i')); bar.appendChild(el('i')); bar.appendChild(el('i'));
  var body = el('div', 'mini__body');

  if (kind === 'form') {
    bar.appendChild(el('span', null, 'boards.greenhouse.io'));
    body.appendChild(miniRow('first_name', 'Azzah', '✓'));
    body.appendChild(miniRow('email', 'azzah@example.com', '✓'));
    body.appendChild(miniRow('years_exp', '4', '✓'));

  } else if (kind === 'map') {
    bar.appendChild(el('span', null, 'unrecognised field'));
    body.appendChild(miniRow('notice_period', 'unmapped'));
    body.appendChild(miniRow('↳ fills with', '4 weeks', '✓'));

  } else if (kind === 'draft') {
    bar.appendChild(el('span', null, 'answer draft'));
    var lines = el('div', 'mini__lines');
    lines.appendChild(el('span', 'mini__line'));
    lines.appendChild(el('span', 'mini__line mini__line--mid'));
    var tail = el('div', 'mini__tail');
    tail.appendChild(el('span', 'mini__line mini__line--short'));
    tail.appendChild(el('i', 'mini__caret'));
    lines.appendChild(tail);
    body.appendChild(lines);

  } else if (kind === 'chips') {
    bar.appendChild(el('span', null, 'profiles'));
    var chips = el('div', 'mini__chips');
    chips.appendChild(el('span', 'mini__chip is-on', 'Design'));
    chips.appendChild(el('span', 'mini__chip', 'Engineering'));
    chips.appendChild(el('span', 'mini__chip', 'Lead'));
    body.appendChild(chips);
    body.appendChild(miniRow('active', 'Design', '✓'));

  } else {   // vault
    bar.appendChild(el('span', null, 'chrome.storage.local'));
    body.appendChild(miniRow('profile', 'on this device', '●'));
    body.appendChild(miniRow('server copy', 'none'));
  }

  win.appendChild(bar);
  win.appendChild(body);
  return win;
}

export function buildCard(step, i) {
  var art = el('article', 'rcard');
  var tone = TONES[i % TONES.length];
  art.style.setProperty('--ic', tone[0]);
  art.style.setProperty('--ic-bg', tone[1]);

  art.appendChild(iconTile(step.icon));
  art.appendChild(el('h3', 'rcard__t', step.t));
  art.appendChild(el('p', 'rcard__b', step.b));
  // Both are built when a card has a mock: the notes stand in at widths
  // where the mock is too small to read, so no card is ever left empty.
  if (step.demo) {
    art.className = 'rcard rcard--mock';
    art.appendChild(buildMini(step.demo));
  }
  if (step.notes) {
    var ul = el('ul', 'rcard__notes');
    step.notes.forEach(function (n) { ul.appendChild(el('li', null, n)); });
    art.appendChild(ul);
  }

  var m = el('p', 'rcard__meta');
  var d = el('span', null, '◆');
  d.setAttribute('aria-hidden', 'true');
  m.appendChild(d);
  m.appendChild(document.createTextNode(' ' + step.m));
  art.appendChild(m);
  return art;
}
