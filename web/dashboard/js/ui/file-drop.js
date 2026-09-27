// Makes an element accept dropped files — the dashboard's copy of the popup's
// useFileDrop (src/components/shared/useFileDrop.js), same rules:
//   - only drags that carry files light the zone up (text, links and images
//     dragged from the page do not);
//   - enter/leave are counted, because moving over a child fires a leave on
//     the parent;
//   - while any zone is on the page, a file dropped anywhere else is stopped
//     from replacing the dashboard with the file (the browser's default).
//
// `onDrop(files)` gets a non-empty array. `isDisabled()` is asked on every
// event (an upload in flight). `onDragChange(dragging)` reports the hover.

let guards = 0;

function insideDropZone(event) {
  return !!(event.target && typeof event.target.closest === 'function' && event.target.closest('[data-file-drop]'));
}

function suppressStrayDrop(event) {
  if (insideDropZone(event)) return;
  event.preventDefault();
}

export function fileDrop(el, { onDrop, isDisabled = () => false, onDragChange } = {}) {
  el.setAttribute('data-file-drop', '');
  let depth = 0;

  const carriesFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
  const setDragging = (on) => {
    el.classList.toggle('is-over', on);
    onDragChange?.(on);
  };
  const reset = () => {
    depth = 0;
    setDragging(false);
  };

  const onEnter = (event) => {
    if (isDisabled() || !carriesFiles(event)) return;
    event.preventDefault();
    depth += 1;
    if (depth === 1) setDragging(true);
  };
  const onOver = (event) => {
    if (isDisabled() || !carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };
  const onLeave = () => {
    if (isDisabled()) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) setDragging(false);
  };
  const onDropEvent = (event) => {
    if (isDisabled()) return;
    event.preventDefault();
    reset();
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) onDrop?.(files);
  };

  el.addEventListener('dragenter', onEnter);
  el.addEventListener('dragover', onOver);
  el.addEventListener('dragleave', onLeave);
  el.addEventListener('drop', onDropEvent);

  guards += 1;
  if (guards === 1) {
    window.addEventListener('dragover', suppressStrayDrop);
    window.addEventListener('drop', suppressStrayDrop);
  }

  return {
    reset,
    destroy() {
      el.removeEventListener('dragenter', onEnter);
      el.removeEventListener('dragover', onOver);
      el.removeEventListener('dragleave', onLeave);
      el.removeEventListener('drop', onDropEvent);
      guards = Math.max(0, guards - 1);
      if (guards === 0) {
        window.removeEventListener('dragover', suppressStrayDrop);
        window.removeEventListener('drop', suppressStrayDrop);
      }
    },
  };
}
