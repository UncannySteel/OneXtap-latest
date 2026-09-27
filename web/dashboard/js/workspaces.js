import { riseWords } from './motion.js';
import { h, fill } from './ui/dom.js';
import * as jobMatches from './ws/job-matches.js';
import * as myProfiles from './ws/my-profiles.js';
import * as answerStudio from './ws/answer-studio.js';
import * as coverLetter from './ws/cover-letter.js';

// One view module per workspace id (js/config.js). Each exports
// `mount(body, ctx)` and returns `{ unmount() }`; the context carries what a
// view needs from the shell — see buildContext in main.js.
const views = {
  'job-matches': jobMatches,
  'my-profiles': myProfiles,
  'answer-studio': answerStudio,
  'cover-letter': coverLetter,
};

let current = null;

// Laid out as one of the landing page's chapters: a numbered label beside a
// display headline over a hairline, the substance below.
export function renderWorkspace(el, ws, number, ctx) {
  unmountCurrent();
  const title = h('h2.display.ws-title', null, ws.label);
  const body = h('div.ws-body', { 'data-rise': '', style: '--r: 3' });
  fill(el,
    h('header.ws-head', null,
      h('p.label.ws-label', { 'data-rise': '' }, h('span.ws-num', null, String(number).padStart(2, '0')), 'Workspace'),
      h('div', null,
        title,
        h('p.ws-desc', { 'data-rise': '', style: '--r: 2' }, ws.description))),
    body);
  riseWords(title, { delay: 80 });
  el.scrollTop = 0;
  current = views[ws.id]?.mount(body, ctx) ?? null;
}

export function clearWorkspace(el) {
  unmountCurrent();
  el.replaceChildren();
}

function unmountCurrent() {
  try {
    current?.unmount?.();
  } finally {
    current = null;
  }
}
