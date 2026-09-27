// The landing page's headline motion, without its dependencies: a headline is
// split into masked words that rise into place on a stagger
// (demo: shared/lib/split-words.js). The timing lives in dashboard.css.

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const WORD_MS = 900;
const STAGGER_MS = 60;

/** Wraps each word of `el` in a mask (.w) holding the word (.wi), numbered for the stagger. */
export function splitWords(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) nodes.push(walker.currentNode);

  let count = 0;
  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    for (const chunk of node.nodeValue.split(/(\s+)/)) {
      if (!chunk) continue;
      if (/^\s+$/.test(chunk)) {
        frag.append(' ');
        continue;
      }
      const mask = document.createElement('span');
      mask.className = 'w';
      const word = document.createElement('span');
      word.className = 'wi';
      word.style.setProperty('--i', count++);
      word.textContent = chunk;
      mask.append(word);
      frag.append(mask);
    }
    node.replaceWith(frag);
  }
  return count;
}

/**
 * Raises `el`'s words through their masks, once. With `restore`, the plain text
 * goes back when they have landed, so ellipsis and wrapping behave as before.
 */
export function riseWords(el, { delay = 0, restore = false } = {}) {
  if (!el || reducedMotion.matches) return;
  const count = splitWords(el);
  el.style.setProperty('--rise-delay', `${delay}ms`);
  el.classList.add('rises');
  if (!restore) return;
  setTimeout(() => {
    if (el.querySelector('.w')) el.textContent = el.textContent;
    el.classList.remove('rises');
  }, delay + Math.max(0, count - 1) * STAGGER_MS + WORD_MS + 50);
}
