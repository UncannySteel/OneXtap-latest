import { icon } from '../icons.js';

// A small element builder for the workspaces, so a view reads as its markup:
//   h('div.card.is-open', { onclick: fn, 'aria-label': 'x' }, 'text', child, [more])
// Props that are DOM properties (value, checked, disabled…) are set as
// properties, `on*` functions become listeners, and everything else is an
// attribute. Children may be strings, nodes, arrays, or null/false (skipped).
// Text is always set as text: nothing user-supplied is ever parsed as HTML.

const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'readOnly', 'multiple', 'indeterminate']);

export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = [el.className, value].filter(Boolean).join(' ');
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'ref' && typeof value === 'function') value(el);
      else if (PROPS.has(key)) el[key] = value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Replaces an element's children. */
export function fill(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

/** One of the dashboard's icons (js/icons.js), as a node. Markup is ours, never user input. */
export function ico(name, size = 16) {
  const t = document.createElement('template');
  t.innerHTML = icon(name, size);
  return t.content.firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** A short random id for label ↔ control pairs. */
let seq = 0;
export const uid = (prefix = 'f') => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
