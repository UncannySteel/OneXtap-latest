import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag-and-drop file handling for a region of the page.
 *
 * Deliberately knows nothing about resumes. It answers two questions — "is a
 * file being dragged over me right now" and "which files were dropped" — and
 * leaves type checking, size checking and error wording to the caller, which
 * in the resume case is `parseResumeFile` and already words all three.
 *
 * ═══ WHY THE WINDOW GUARD ═══
 *
 * A file dropped anywhere the page does not claim is a NAVIGATION: the browser
 * throws the dashboard away and renders the PDF. A drop zone that only guards
 * its own box makes that *more* likely, not less, because it invites the
 * gesture in the first place. So a mounted zone also suppresses the default
 * everywhere else, exempting other zones so they keep working.
 *
 * @param {object} options
 * @param {(files: File[]) => void} options.onDrop Non-empty file list.
 * @param {boolean} [options.disabled=false] Ignore drags entirely.
 * @returns {{ isDragging: boolean, dropProps: object }} Spread `dropProps`
 *   onto the element that should accept the drop.
 */
export function useFileDrop({ onDrop, disabled = false }) {
  const [isDragging, setIsDragging] = useState(false);

  // dragenter/dragleave fire per element, so moving the pointer from the box
  // onto a button INSIDE it is enter+leave. Counting depth instead of setting
  // a boolean is what stops the highlight strobing across child elements.
  const depthRef = useRef(0);

  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => retainWindowGuard(), []);

  // A dragged link, image or selection is not a file drop and must not light
  // the zone up. `types` is the only thing readable during a drag — the file
  // list itself is withheld until drop, by design.
  const carriesFiles = (event) => {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes('Files');
  };

  const reset = useCallback(() => {
    depthRef.current = 0;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (disabled) reset();
  }, [disabled, reset]);

  const handleDragEnter = useCallback((event) => {
    if (disabled || !carriesFiles(event)) return;
    event.preventDefault();
    depthRef.current += 1;
    setIsDragging(true);
  }, [disabled]);

  const handleDragOver = useCallback((event) => {
    if (disabled || !carriesFiles(event)) return;
    // Without preventDefault here the element is not a drop target at all and
    // no drop event ever arrives, whatever the other handlers do.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }, [disabled]);

  const handleDragLeave = useCallback((event) => {
    if (disabled) return;
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setIsDragging(false);
  }, [disabled]);

  const handleDrop = useCallback((event) => {
    if (disabled) return;
    event.preventDefault();
    reset();
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) onDropRef.current?.(files);
  }, [disabled, reset]);

  return {
    isDragging,
    dropProps: {
      // Read by the window guard below to tell "handled here" from "about to
      // navigate away". Also a usable hook for tests.
      'data-file-drop': '',
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}

// ------------------------------------------------------------------
// Window-level navigation guard
// ------------------------------------------------------------------
// Refcounted rather than per-hook: several zones can be mounted at once (the
// picker and the empty state on the job matches page are), and each adding its
// own pair of listeners would preventDefault the same event N times to the
// same effect while making removal order matter.

let guardCount = 0;

/** True when the event landed inside some `useFileDrop` region. */
function insideDropZone(event) {
  const target = event.target;
  return !!(target && typeof target.closest === 'function' && target.closest('[data-file-drop]'));
}

/**
 * Suppress the browser's open-the-dropped-file default outside every zone.
 * Events inside a zone are left alone: that zone already called
 * preventDefault, and cancelling a drop the app *wants* would be worse than
 * the navigation this exists to stop.
 */
function suppressStrayDrop(event) {
  if (insideDropZone(event)) return;
  event.preventDefault();
}

/** @returns {() => void} Release. */
function retainWindowGuard() {
  if (typeof window === 'undefined') return () => {};
  guardCount += 1;
  if (guardCount === 1) {
    // Both events, not just `drop`: a `dragover` that is never cancelled means
    // the drop is not delivered to the page at all and the browser navigates.
    window.addEventListener('dragover', suppressStrayDrop);
    window.addEventListener('drop', suppressStrayDrop);
  }
  return () => {
    guardCount = Math.max(0, guardCount - 1);
    if (guardCount === 0) {
      window.removeEventListener('dragover', suppressStrayDrop);
      window.removeEventListener('drop', suppressStrayDrop);
    }
  };
}

export default useFileDrop;
