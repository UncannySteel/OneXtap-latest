import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, FileText, Trash2, ChevronDown, Settings, UploadCloud } from 'lucide-react';
import { parseResumeFile, RESUME_ACCEPT_ATTR, MAX_RESUME_LABEL } from '../../resumeParse';
import { loadResumeStore, setActiveResumeId, saveParsedResume, renameResume, deleteResume, listResumes, MAX_RESUME_NAME_LENGTH, MAX_RESUMES } from '../../resumeStore';
import { useFileDrop } from './useFileDrop';
import { log as baseLog } from '../../logger';

const log = baseLog.child('resume');

// --- RESUME SWITCHER ---
/**
 * Dropdown for switching, uploading, renaming and deleting stored resumes.
 *
 * Deliberately a sibling of ProfileSwitcher rather than a generalisation of it.
 * "Type a name and get an empty thing" and "pick a file and wait for it to be
 * parsed" are different affordances with different failure modes — one cannot
 * fail on the network, the other can — and a single component covering both
 * would be a props-driven mode switch pretending to be reuse. The shared parts
 * are the dropdown chrome, and that is cheap to copy.
 *
 * Writes straight to resumeStore; the parent learns about a change only
 * through `onResumeChange`.
 *
 * @param {object} props
 * @param {boolean} [props.compact=false] Denser styling for the popup.
 * @param {() => void} [props.onResumeChange] Fired after any switch or edit.
 * @param {number} [props.refreshNonce=0] Bump to make the switcher re-read the
 *   store. For a parent that wrote to it directly — the job matches page does,
 *   from its own empty-state drop zone — and would otherwise be showing a
 *   picker that has not noticed the upload it just performed.
 */
const ResumeSwitcher = ({ compact = false, onResumeChange, refreshNonce = 0 }) => {
  const [store, setStore] = useState(null);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const dropdownRef = useRef(null);
  const fileInputRef = useRef(null);
  const onResumeChangeRef = useRef(onResumeChange);
  onResumeChangeRef.current = onResumeChange;

  const refresh = useCallback(async () => {
    const next = await loadResumeStore();
    setStore(next);
    onResumeChangeRef.current?.(next);
    return next;
  }, []);

  useEffect(() => { refresh(); }, [refresh, refreshNonce]);

  useEffect(() => {
    const onClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
        setRenamingId(null);
        setDeleteConfirmId(null);
        // uploadError renders in the always-visible footer rather than a form
        // that unmounts, so without this a stale red message sits under the
        // button indefinitely.
        setUploadError('');
        setDeleteError('');
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  /**
   * The upload itself, shared by the file picker and the drop zone.
   *
   * Everything specific to *how* the file arrived stays with the caller — the
   * picker has to clear its input, the drop zone has to open the dropdown —
   * because doing either in the wrong place is invisible until someone uses
   * the other entry point.
   *
   * @param {File} file
   */
  const startUpload = useCallback(async (file) => {
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      const result = await parseResumeFile(file);
      if (!result.ok) {
        setUploadError(result.error.message);
        return;
      }
      // Adds it, or selects the copy already stored for these exact bytes —
      // the same file twice is a select, not a duplicate-name error. The rule
      // lives in resumeStore because ProfilesPage needs it identically.
      await saveParsedResume(result);
      await refresh();
      setOpen(false);
    } catch (e) {
      log.warn('resume upload failed', { errName: e?.name });
      setUploadError(e?.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }, [refresh]);

  /**
   * Files dropped anywhere on the switcher.
   *
   * Opens the dropdown first, unconditionally: the spinner and every error
   * message below render *inside* it, so a drop onto the collapsed button
   * would otherwise parse a resume — or refuse to — with no visible sign
   * either way.
   *
   * @param {File[]} files Never empty.
   */
  const handleDroppedFiles = useCallback((files) => {
    setOpen(true);
    setUploadError('');
    if (files.length > 1) {
      setUploadError('Drop one resume at a time.');
      return;
    }
    // Recomputed here rather than read from `atCapacity`, which is derived
    // below the loading guard and so does not exist yet at this point in the
    // component. addResume would refuse anyway; this is for the wording.
    const stored = store ? listResumes(store).length : 0;
    if (stored >= MAX_RESUMES) {
      setUploadError(`Limit of ${MAX_RESUMES} reached — delete one before uploading another.`);
      return;
    }
    startUpload(files[0]);
  }, [store, startUpload]);

  const { isDragging, dropProps } = useFileDrop({
    onDrop: handleDroppedFiles,
    disabled: uploading,
  });

  // A new drag is a retry, so the last failure stops applying the moment one
  // starts. Without this the footer reads "Drop to upload" over a red sentence
  // about the file before it — two different answers to the same question.
  useEffect(() => {
    if (isDragging) setUploadError('');
  }, [isDragging]);

  if (!store) {
    return (
      <div className="h-10 animate-pulse rounded-xl bg-onextap-primary/10" />
    );
  }

  const resumes = listResumes(store);
  const active = resumes.find((r) => r.id === store.activeResumeId);
  const atCapacity = resumes.length >= MAX_RESUMES;

  const handleSelect = async (id) => {
    setUploadError('');
    setDeleteError('');
    await setActiveResumeId(id);
    await refresh();
    setOpen(false);
  };

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    // Reset the input first: picking the SAME file twice fires no change event
    // otherwise, which reads to the user as the upload button being dead.
    if (event.target) event.target.value = '';
    await startUpload(file);
  };

  const handleRename = async (id) => {
    try {
      setRenameError('');
      await renameResume(id, renameValue);
      setRenamingId(null);
      setRenameValue('');
      await refresh();
    } catch (e) {
      setRenameError(e.message);
    }
  };

  const handleDelete = async (id) => {
    try {
      // No default-resume guard and no last-one guard: unlike a profile, zero
      // resumes is a legitimate state.
      await deleteResume(id);
      setDeleteConfirmId(null);
      setDeleteError('');
      await refresh();
    } catch (e) {
      // Its own state, not renameError: renameError only renders inside the
      // rename branch, which is not mounted while the delete confirmation is
      // showing — so writing there made a failed delete look like nothing
      // happened at all.
      setDeleteError(e.message);
    }
  };

  return (
    <div className={`relative ${compact ? '' : 'mb-3'}`} ref={dropdownRef} {...dropProps}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold text-onextap-dark shadow-sm transition-all dark:text-[#E8EFD8] ${
          isDragging
            ? 'border-onextap-primary border-dashed bg-onextap-primary/10 dark:bg-onextap-primary/20 dark:border-onextap-primary-light'
            : 'border-onextap-primary/20 bg-white/90 hover:border-onextap-primary/35 dark:bg-onextap-night-card dark:border-onextap-primary-light/25'
        }`}
      >
        {isDragging ? (
          // Replaces the label rather than sitting beside it: mid-drag, which
          // resume is currently selected is not the question being asked.
          <span className="flex items-center gap-2 min-w-0 text-onextap-primary dark:text-onextap-olive-pale">
            <UploadCloud size={16} className="shrink-0" />
            <span className="truncate">Drop to upload</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 min-w-0">
            <span className="h-2 w-2 shrink-0 rounded-full bg-onextap-primary" />
            <span className="truncate">{active?.name || 'No resume selected'}</span>
          </span>
        )}
        <ChevronDown size={16} className={`shrink-0 text-onextap-dark/50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-onextap-primary/20 bg-white shadow-lg dark:bg-onextap-night-card dark:border-onextap-primary-light/25">
          <div className="max-h-[240px] overflow-y-auto">
            {resumes.length === 0 ? (
              // Reachable, unlike ProfileSwitcher's equivalent: profileStore
              // always migrates a Default profile into existence, resumeStore
              // never invents one.
              <div className="px-3 py-4 text-center text-xs text-onextap-dark/60 dark:text-[#9AB07A]">
                No resumes yet — upload one
              </div>
            ) : resumes.map((r) => (
              <div key={r.id} className="border-b border-onextap-primary/10 last:border-b-0">
                {deleteConfirmId === r.id ? (
                  <div className="px-3 py-2.5 text-xs text-onextap-dark/80 dark:text-[#E8EFD8]">
                    Delete {r.name}? This cannot be undone.
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => handleDelete(r.id)} className="rounded-lg bg-red-600 px-2.5 py-1 text-white font-medium">Delete</button>
                      <button type="button" onClick={() => { setDeleteConfirmId(null); setDeleteError(''); }} className="rounded-lg border border-onextap-primary/20 px-2.5 py-1">Cancel</button>
                    </div>
                    {deleteError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{deleteError}</p>}
                  </div>
                ) : renamingId === r.id ? (
                  <div className="px-3 py-2.5">
                    <input
                      value={renameValue}
                      onChange={(e) => { setRenameValue(e.target.value.slice(0, MAX_RESUME_NAME_LENGTH)); setRenameError(''); }}
                      className="w-full rounded-lg border border-onextap-primary/30 px-2 py-1.5 text-sm"
                      placeholder="Resume name"
                      maxLength={MAX_RESUME_NAME_LENGTH}
                    />
                    <p className="mt-1 text-[10px] text-onextap-dark/45">{renameValue.length}/{MAX_RESUME_NAME_LENGTH}</p>
                    {renameError && <p className="mt-1 text-xs text-red-600">{renameError}</p>}
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => handleRename(r.id)} className="rounded-lg bg-onextap-primary px-2.5 py-1 text-xs text-white font-medium">Save</button>
                      <button type="button" onClick={() => { setRenamingId(null); setRenameError(''); }} className="rounded-lg border border-onextap-primary/20 px-2.5 py-1 text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className={`flex items-center gap-1 px-2 py-1.5 ${r.id === store.activeResumeId ? 'bg-onextap-primary/8' : ''}`}>
                    <button
                      type="button"
                      onClick={() => handleSelect(r.id)}
                      className={`flex-1 truncate px-1 py-1 text-left text-sm ${r.id === store.activeResumeId ? 'font-semibold text-onextap-dark dark:text-[#E8EFD8]' : 'text-onextap-dark/70 dark:text-[#9AB07A]'}`}
                    >
                      {r.id === store.activeResumeId && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-onextap-primary" />}
                      {r.name}
                      {r.needsReupload && <span className="ml-1.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">re-upload needed</span>}
                    </button>
                    <button
                      type="button"
                      title="Rename"
                      onClick={() => { setRenamingId(r.id); setRenameValue(r.name); setRenameError(''); }}
                      className="rounded-lg p-1.5 text-onextap-dark/40 hover:bg-onextap-primary/10 hover:text-onextap-primary"
                    >
                      <Settings size={13} />
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      onClick={() => setDeleteConfirmId(r.id)}
                      className="rounded-lg p-1.5 text-onextap-dark/40 hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-onextap-primary/15 bg-onextap-cream/50 dark:bg-onextap-night">
            <input
              ref={fileInputRef}
              type="file"
              accept={RESUME_ACCEPT_ATTR}
              onChange={handleUpload}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading || atCapacity}
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-onextap-primary hover:bg-onextap-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading
                ? <><Activity size={14} className="animate-spin" /> Parsing resume...</>
                : <><FileText size={14} /> {atCapacity ? `Limit of ${MAX_RESUMES} reached` : 'Upload Resume'}</>}
            </button>
            {!uploading && !atCapacity && (
              // The only place the accepted types and the size cap are stated
              // before an upload fails. Both are derived, not typed out, so
              // they cannot drift from what the gate in resumeParse enforces.
              <p className="px-3 pb-2.5 text-[11px] text-onextap-dark/50 dark:text-[#9AB07A]">
                or drag a file onto the picker — PDF or image, up to {MAX_RESUME_LABEL}
              </p>
            )}
            {uploadError && <p className="px-3 pb-2.5 text-xs text-red-600">{uploadError}</p>}
          </div>
        </div>
      )}
    </div>
  );
};

export default ResumeSwitcher;
