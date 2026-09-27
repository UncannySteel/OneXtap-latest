import { storage, transition } from './util.js';

const STORAGE_KEY = 'dashboard.dock';
const MODES = ['left', 'right', 'float'];
const SNAP_EDGE = 56; // px from the viewport edge that triggers a dock-snap while dragging
const MARGIN = 12;
const DRAG_THRESHOLD = 4;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480; // also capped at half the viewport
const KEY_STEP = 16;
const canFloat = matchMedia('(min-width: 760px)');

/**
 * Dock panel in the workspace view: docked left, docked right, or floating.
 * Drag the bar to undock; drop near an edge to re-dock; double-click to toggle.
 * Drag the inner edge (or focus it and use arrow keys) to resize; double-click it to reset.
 */
export function initDock({ app, dock, handle, resizer, hints }) {
  const root = document.documentElement;
  const defaultWidth = parseInt(getComputedStyle(root).getPropertyValue('--dock-w'), 10) || 264;
  const saved = storage.get(STORAGE_KEY, {});
  const state = {
    mode: MODES.includes(saved.mode) ? saved.mode : 'left',
    lastDocked: saved.lastDocked === 'right' ? 'right' : 'left',
    x: Number.isFinite(saved.x) ? saved.x : null,
    y: Number.isFinite(saved.y) ? saved.y : null,
    width: Number.isFinite(saved.width) ? saved.width : defaultWidth,
  };
  const controls = [...dock.querySelectorAll('[data-dock-to]')];
  const topbar = app.querySelector('.topbar');

  const save = () => storage.set(STORAGE_KEY, state);

  function place(x, y) {
    const minY = topbar.offsetHeight + MARGIN;
    const maxX = Math.max(MARGIN, innerWidth - dock.offsetWidth - MARGIN);
    const maxY = Math.max(minY, innerHeight - dock.offsetHeight - MARGIN);
    state.x = Math.round(Math.min(Math.max(x, MARGIN), maxX));
    state.y = Math.round(Math.min(Math.max(y, minY), maxY));
    dock.style.setProperty('--float-x', `${state.x}px`);
    dock.style.setProperty('--float-y', `${state.y}px`);
  }

  const maxWidth = () => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(innerWidth / 2)));
  const isFloating = () => state.mode === 'float' && app.dataset.view === 'workspace';

  // state.width is the preferred width; small viewports clamp what's applied without overwriting it.
  function applyWidth() {
    const width = Math.min(state.width, maxWidth());
    root.style.setProperty('--dock-w', `${width}px`);
    resizer.setAttribute('aria-valuemin', MIN_WIDTH);
    resizer.setAttribute('aria-valuemax', maxWidth());
    resizer.setAttribute('aria-valuenow', width);
    if (isFloating()) place(state.x, state.y);
  }

  function setWidth(px) {
    state.width = Math.round(Math.min(Math.max(px, MIN_WIDTH), maxWidth()));
    applyWidth();
  }

  function apply() {
    app.dataset.dock = state.mode;
    controls.forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.dockTo === state.mode)));
    if (isFloating()) {
      place(state.x ?? MARGIN * 2, state.y ?? topbar.offsetHeight + MARGIN * 2);
    }
  }

  function setMode(mode) {
    if (mode === state.mode) return;
    if (mode === 'float' && state.x === null) {
      const rect = dock.getBoundingClientRect();
      state.x = rect.left + 16;
      state.y = rect.top + 16;
    }
    if (mode !== 'float') state.lastDocked = mode;
    state.mode = mode;
    save();
    transition(apply);
  }

  controls.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.dockTo)));

  handle.addEventListener('dblclick', (e) => {
    if (e.target.closest('[data-dock-to]')) return;
    setMode(state.mode === 'float' ? state.lastDocked : 'float');
  });

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('[data-dock-to]') || !canFloat.matches) return;
    e.preventDefault(); // no text selection while dragging
    const start = { x: e.clientX, y: e.clientY };
    let offset = null;
    let snap = null;
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      if (!offset) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
        const rect = dock.getBoundingClientRect();
        offset = { x: start.x - rect.left, y: start.y - rect.top };
        app.classList.add('is-dragging');
        if (state.mode !== 'float') {
          state.x = rect.left;
          state.y = rect.top;
          state.mode = 'float';
          apply();
        }
      }
      place(ev.clientX - offset.x, ev.clientY - offset.y);
      snap = ev.clientX < SNAP_EDGE ? 'left' : ev.clientX > innerWidth - SNAP_EDGE ? 'right' : null;
      hints.forEach((hint) => hint.toggleAttribute('data-active', hint.dataset.side === snap));
    };

    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      if (!offset) return;
      app.classList.remove('is-dragging');
      hints.forEach((hint) => hint.removeAttribute('data-active'));
      if (snap) setMode(snap);
      else save();
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  });

  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = Math.min(state.width, maxWidth());
    const direction = state.mode === 'right' ? -1 : 1; // handle sits on the left edge when docked right
    app.classList.add('is-resizing');

    const onMove = (ev) => setWidth(startWidth + (ev.clientX - startX) * direction);
    const onEnd = () => {
      resizer.removeEventListener('pointermove', onMove);
      resizer.removeEventListener('pointerup', onEnd);
      resizer.removeEventListener('pointercancel', onEnd);
      app.classList.remove('is-resizing');
      save();
    };

    resizer.addEventListener('pointermove', onMove);
    resizer.addEventListener('pointerup', onEnd);
    resizer.addEventListener('pointercancel', onEnd);
  });

  resizer.addEventListener('dblclick', () => {
    setWidth(defaultWidth);
    save();
  });

  resizer.addEventListener('keydown', (e) => {
    const [grow, shrink] = state.mode === 'right' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowRight', 'ArrowLeft'];
    const width = Math.min(state.width, maxWidth());
    const next = { [grow]: width + KEY_STEP, [shrink]: width - KEY_STEP, Home: MIN_WIDTH, End: maxWidth() }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setWidth(next);
    save();
  });

  addEventListener('resize', applyWidth);

  applyWidth();
  apply();
  return { refresh: apply };
}
