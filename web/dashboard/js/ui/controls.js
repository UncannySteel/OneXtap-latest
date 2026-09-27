import { h, ico, uid } from './dom.js';

// The workspaces' controls, in the landing page's language on the oat sheet:
// hairline-ruled sections with a numbered label, mono field keys over white
// fields, ink pills that turn citrine, muted tints for anything that has to
// be said (amber: take note; clay: failed; slate: for your information).
// Styles: css/workspaces.css.

/**
 * A chapter-style section of a workspace: a numbered label beside its title,
 * over a hairline, then the substance.
 */
export function section({ num, label, title, desc, id, className }, ...content) {
  const headId = id || uid('sec');
  return h('section.ws-sec', { class: className, 'aria-labelledby': headId },
    h('p.label.ws-sec-label', null,
      num != null && h('span.ws-num', null, String(num).padStart(2, '0')),
      label),
    h('div.ws-sec-main', null,
      (title || desc) && h('div.ws-sec-head', null,
        title && h('h3.ws-sec-title', { id: headId }, title),
        desc && h('p.ws-sec-desc', null, desc)),
      content));
}

/**
 * A labelled field. `control` is the input/select/textarea; `span` its width
 * in the 6-column grid. When `control` is a group (an addon beside an input),
 * `labelFor` names the input the label belongs to.
 */
export function field({ label, control, span = 6, hint, error, className, labelFor }) {
  const id = labelFor || control.id || uid('f');
  if (!labelFor) control.id = id;
  return h('div.f', { class: [`span-${span}`, className].filter(Boolean).join(' ') },
    label && h('label.f-k', { for: id }, label),
    control,
    hint && h('p.f-hint', null, hint),
    error !== undefined && h('p.f-err', { role: 'alert' }, error || ''));
}

export function input(props = {}) {
  return h('input.f-in', { type: 'text', autocomplete: 'off', spellcheck: 'false', ...props });
}

export function textarea(props = {}) {
  return h('textarea.f-in', { rows: 4, ...props });
}

/**
 * A select. `options` is [{ value, label }] or [{ label, options: [...] }]
 * for an <optgroup>. `value` selects one.
 */
export function select(options, props = {}) {
  const { value, ...rest } = props;
  const el = h('select.f-in', rest, options.map((opt) => (opt.options
    ? h('optgroup', { label: opt.label }, opt.options.map((o) => h('option', { value: o.value }, o.label)))
    : h('option', { value: opt.value }, opt.label))));
  if (value !== undefined) el.value = value;
  return el;
}

export function checkbox({ label, checked, onChange, className }) {
  const box = h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onChange?.(e.target.checked) });
  return h('label.check', { class: className }, box, h('span', null, label));
}

/**
 * A pill button. kind: 'solid' | 'ghost' | 'danger' | 'citrine'; size: 'sm'.
 * `icon` leads, `arrow` trails (the landing's →).
 */
export function button(label, { kind = 'ghost', size, icon, arrow, onClick, disabled, type = 'button', title, className, attrs } = {}) {
  return h('button.btn', {
    type,
    class: [`btn-${kind}`, size && `btn-${size}`, className].filter(Boolean).join(' '),
    onclick: onClick,
    disabled,
    title,
    ...attrs,
  },
  icon && ico(icon, size === 'sm' ? 14 : 16),
  h('span.btn-label', null, label),
  arrow && h('span.btn-arrow', { 'aria-hidden': 'true' }, '→'));
}

/** Puts a button into its busy state (spinner + label) and back. */
export function setBusy(btn, busy, busyLabel) {
  if (!btn) return;
  const label = btn.querySelector('.btn-label');
  if (busy) {
    if (!btn.dataset.idleLabel) btn.dataset.idleLabel = label?.textContent || '';
    btn.disabled = true;
    btn.classList.add('is-busy');
    if (label && busyLabel) label.textContent = busyLabel;
  } else {
    btn.disabled = false;
    btn.classList.remove('is-busy');
    if (label && btn.dataset.idleLabel !== undefined) label.textContent = btn.dataset.idleLabel;
    delete btn.dataset.idleLabel;
  }
}

/** A small icon-only button on the oat sheet (remove a row, rename…). */
export function iconButton(name, { label, onClick, danger, disabled } = {}) {
  return h('button.ibtn', { type: 'button', class: danger ? 'is-danger' : '', 'aria-label': label, title: label, onclick: onClick, disabled }, ico(name, 16));
}

export function spinner(label) {
  return h('span.spin-row', { role: 'status' }, h('span.spin', { 'aria-hidden': 'true' }), label && h('span', null, label));
}

/** Something that has to be said. tone: 'amber' | 'clay' | 'slate' | 'olive'. */
export function note(tone, ...content) {
  const glyph = { amber: 'alert', clay: 'alert', slate: 'info', olive: 'check' }[tone] || 'info';
  return h('div.note', { class: `note-${tone}`, role: tone === 'clay' ? 'alert' : null },
    ico(glyph, 16),
    h('div.note-body', null, content));
}

/** A small uppercase tag. tone: 'olive' | 'amber' | 'clay' | 'slate' | 'ink' | undefined (plain). */
export function tag(text, tone, attrs) {
  return h('span.tag', { class: tone ? `tag-${tone}` : '', ...attrs }, text);
}

export function skeleton(count = 1, widths = []) {
  return Array.from({ length: count }, (_, i) => h('div.skel', { style: widths[i] ? { width: widths[i] } : null, 'aria-hidden': 'true' }));
}

/** An empty state on the sheet, as the dashboard's placeholder cards were. */
export function emptyState({ iconName, title, body, action }) {
  return h('div.ws-empty.is-inline', null,
    iconName && h('div.ws-empty-icon', null, ico(iconName, 22)),
    h('h3', null, title),
    body && h('p', null, body),
    action);
}
