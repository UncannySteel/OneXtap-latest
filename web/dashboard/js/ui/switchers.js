import { h, ico, fill } from './dom.js';
import { iconButton, spinner } from './controls.js';
import { fileDrop } from './file-drop.js';
import {
  loadProfileStore, setActiveProfileId, createProfile, renameProfile, deleteProfile, listProfiles,
  MAX_PROFILE_NAME_LENGTH,
} from '@app/profileStore.js';
import {
  loadResumeStore, setActiveResumeId, saveParsedResume, renameResume, deleteResume, listResumes,
  MAX_RESUME_NAME_LENGTH, MAX_RESUMES,
} from '@app/resumeStore.js';
import { parseResumeFile, RESUME_ACCEPT_ATTR, MAX_RESUME_LABEL } from '@app/resumeParse.js';
import { log as baseLog } from '@app/logger.js';

const log = baseLog.child('resume');

// The profile and resume pickers, as the backend's React app had them
// (ProfileSwitcher, still the popup's, in src/components/shared/; and
// ResumeSwitcher, removed with the React dashboard). Kept as two siblings rather than
// one component with a mode switch, as docs/repo-structure.md (rule 11) asks:
// "type a name and get an empty thing" and "pick a file and wait for a parse
// that can fail" are different affordances. What they share is the dropdown
// chrome — a pill on the oat sheet that opens a small ink window, like the
// settings menu — and that is all `dropdown()` below is.

function dropdown({ caption, className }) {
  const nameEl = h('span.switch-name');
  const trigger = h('button.switch-btn', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
    h('span.switch-dot', { 'aria-hidden': 'true' }), nameEl, ico('chevron', 16));
  const menu = h('div.switch-menu', { hidden: true });
  const root = h('div.switch', { class: className }, caption && h('p.label.switch-cap', null, caption), trigger, menu);

  let onClose = null;
  const isOpen = () => !menu.hidden;
  function setOpen(open) {
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    root.classList.toggle('is-open', open);
    if (!open) onClose?.();
  }
  trigger.addEventListener('click', () => setOpen(!isOpen()));
  const outside = (e) => { if (isOpen() && !root.contains(e.target)) setOpen(false); };
  const escape = (e) => {
    if (e.key === 'Escape' && isOpen()) {
      e.stopPropagation();
      setOpen(false);
      trigger.focus();
    }
  };
  document.addEventListener('pointerdown', outside, true);
  root.addEventListener('keydown', escape);

  return {
    root, trigger, menu, nameEl, setOpen, isOpen,
    set onClose(fn) { onClose = fn; },
    destroy() { document.removeEventListener('pointerdown', outside, true); },
  };
}

/** The name field used for create/rename inside the ink window. */
function nameForm({ value = '', placeholder, max, confirmLabel, error, onConfirm, onCancel }) {
  const count = h('span.switch-count', null, `${value.length}/${max}`);
  const input = h('input.switch-input', {
    value, placeholder, maxLength: max, 'aria-label': placeholder,
    oninput: (e) => { count.textContent = `${e.target.value.length}/${max}`; },
    onkeydown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onConfirm(input.value); }
    },
  });
  requestAnimationFrame(() => input.focus());
  return h('div.switch-form', null,
    input,
    h('div.switch-form-row', null, count, error && h('span.switch-err', { role: 'alert' }, error)),
    h('div.switch-actions', null,
      h('button.switch-act.is-primary', { type: 'button', onclick: () => onConfirm(input.value) }, confirmLabel),
      h('button.switch-act', { type: 'button', onclick: onCancel }, 'Cancel')));
}

function confirmRow({ text, onConfirm, onCancel, error }) {
  return h('div.switch-confirm', null,
    h('p', null, text),
    h('div.switch-actions', null,
      h('button.switch-act.is-danger', { type: 'button', onclick: onConfirm }, 'Delete'),
      h('button.switch-act', { type: 'button', onclick: onCancel }, 'Cancel')),
    error && h('p.switch-err', { role: 'alert' }, error));
}

/* ---------------------------------------------------------------------------
   Profiles: switch, create, rename, delete. Writes straight to profileStore;
   `onChange(store)` fires after anything that changes which profile's data
   is showing (a switch, a new profile, deleting the active one), and
   `beforeChange()` is awaited just before one — the moment to write down
   edits that belong to the profile being left.
   ------------------------------------------------------------------------- */
export function profileSwitcher({ onChange, beforeChange } = {}) {
  const dd = dropdown({ caption: 'Profile', className: 'switch-profile' });
  let store = null;
  let creating = false;
  let renamingId = null;
  let deleteId = null;
  let error = '';
  dd.onClose = () => { creating = false; renamingId = null; deleteId = null; error = ''; };

  async function refresh(notify = false) {
    store = await loadProfileStore();
    render();
    if (notify) onChange?.(store);
    return store;
  }

  function render() {
    if (!store) return;
    const profiles = listProfiles(store);
    const active = profiles.find((p) => p.id === store.activeProfileId);
    dd.nameEl.textContent = active?.name || 'Default';
    const canDeleteAny = profiles.length > 1;

    const rows = profiles.map((p) => {
      if (deleteId === p.id) {
        return confirmRow({
          text: `Delete ${p.name}? Its details, answers and cover letters go with it. This cannot be undone.`,
          error,
          onConfirm: async () => {
            try {
              const wasActive = p.id === store.activeProfileId;
              if (wasActive) await beforeChange?.();
              await deleteProfile(p.id);
              deleteId = null;
              error = '';
              await refresh(wasActive);
            } catch (e) { error = e.message; render(); }
          },
          onCancel: () => { deleteId = null; error = ''; render(); },
        });
      }
      if (renamingId === p.id) {
        return nameForm({
          value: p.name, placeholder: 'Profile name', max: MAX_PROFILE_NAME_LENGTH, confirmLabel: 'Save', error,
          onConfirm: async (name) => {
            try {
              await renameProfile(p.id, name);
              renamingId = null;
              error = '';
              await refresh();
            } catch (e) { error = e.message; render(); }
          },
          onCancel: () => { renamingId = null; error = ''; render(); },
        });
      }
      const current = p.id === store.activeProfileId;
      return h('div.switch-row', { 'aria-current': current ? 'true' : null },
        h('button.switch-pick', {
          type: 'button',
          onclick: async () => {
            if (!current) {
              await beforeChange?.();
              await setActiveProfileId(p.id);
              await refresh(true);
            }
            dd.setOpen(false);
          },
        }, current && h('span.switch-dot', { 'aria-hidden': 'true' }), p.name),
        iconButton('edit', { label: `Rename ${p.name}`, onClick: () => { renamingId = p.id; deleteId = null; creating = false; error = ''; render(); } }),
        canDeleteAny && !p.isDefault && iconButton('trash', { label: `Delete ${p.name}`, danger: true, onClick: () => { deleteId = p.id; renamingId = null; creating = false; error = ''; render(); } }));
    });

    const foot = creating
      ? nameForm({
        placeholder: 'Profile name', max: MAX_PROFILE_NAME_LENGTH, confirmLabel: 'Create', error,
        onConfirm: async (name) => {
          try {
            await beforeChange?.();
            await createProfile(name);
            creating = false;
            error = '';
            await refresh(true);
            dd.setOpen(false);
          } catch (e) { error = e.message; render(); }
        },
        onCancel: () => { creating = false; error = ''; render(); },
      })
      : h('button.switch-add', { type: 'button', onclick: () => { creating = true; renamingId = null; deleteId = null; error = ''; render(); } },
        ico('plus', 15), 'New profile');

    fill(dd.menu, h('div.switch-list', null, rows), h('div.switch-foot', null, foot));
  }

  refresh();
  return { el: dd.root, refresh: () => refresh(false), destroy: dd.destroy };
}

/* ---------------------------------------------------------------------------
   Resumes: switch, upload (picker or drop), rename, delete. Writes straight to
   resumeStore; `onChange(store)` fires after every read of the store, the
   first included — Job Matches keys everything off the active resume.
   ------------------------------------------------------------------------- */
export function resumeSwitcher({ onChange, toast } = {}) {
  const dd = dropdown({ caption: 'Resume', className: 'switch-resume' });
  let store = null;
  let uploading = false;
  let uploadError = '';
  let renamingId = null;
  let deleteId = null;
  let error = '';
  dd.onClose = () => { renamingId = null; deleteId = null; error = ''; uploadError = ''; };

  const fileInput = h('input', { type: 'file', accept: RESUME_ACCEPT_ATTR, hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    // Cleared first: picking the same file twice fires no change event otherwise.
    fileInput.value = '';
    await startUpload(file);
  });
  dd.root.append(fileInput);

  async function refresh() {
    store = await loadResumeStore();
    render();
    onChange?.(store);
    return store;
  }

  async function startUpload(file) {
    if (!file) return;
    uploadError = '';
    uploading = true;
    render();
    try {
      const result = await parseResumeFile(file);
      if (!result.ok) {
        uploadError = result.error.message;
        return;
      }
      // Adds it, or selects the copy already stored for these exact bytes.
      await saveParsedResume(result);
      await refresh();
      dd.setOpen(false);
      toast?.('Resume parsed.');
    } catch (e) {
      log.warn('resume upload failed', { errName: e?.name });
      uploadError = e?.message || 'Upload failed.';
    } finally {
      uploading = false;
      render();
    }
  }

  // A drop onto the collapsed pill opens it first: the spinner and any error
  // render inside, so a drop would otherwise succeed or fail invisibly.
  const drop = fileDrop(dd.root, {
    isDisabled: () => uploading,
    onDragChange: (dragging) => {
      if (dragging) uploadError = '';
      dd.root.classList.toggle('is-dragging', dragging);
      dd.nameEl.textContent = dragging ? 'Drop to upload' : activeName();
    },
    onDrop: (files) => {
      dd.setOpen(true);
      uploadError = '';
      if (files.length > 1) { uploadError = 'Drop one resume at a time.'; render(); return; }
      if (store && listResumes(store).length >= MAX_RESUMES) {
        uploadError = `Limit of ${MAX_RESUMES} reached — delete one before uploading another.`;
        render();
        return;
      }
      startUpload(files[0]);
    },
  });

  function activeName() {
    if (!store) return 'Loading…';
    const active = listResumes(store).find((r) => r.id === store.activeResumeId);
    return active?.name || 'No resume selected';
  }

  function render() {
    if (!store) return;
    dd.nameEl.textContent = activeName();
    const resumes = listResumes(store);
    const atCapacity = resumes.length >= MAX_RESUMES;

    const rows = resumes.length === 0
      ? [h('p.switch-empty', null, 'No resumes yet — upload one.')]
      : resumes.map((r) => {
        if (deleteId === r.id) {
          return confirmRow({
            text: `Delete ${r.name}? This cannot be undone.`,
            error,
            onConfirm: async () => {
              try {
                await deleteResume(r.id);
                deleteId = null;
                error = '';
                await refresh();
              } catch (e) { error = e.message; render(); }
            },
            onCancel: () => { deleteId = null; error = ''; render(); },
          });
        }
        if (renamingId === r.id) {
          return nameForm({
            value: r.name, placeholder: 'Resume name', max: MAX_RESUME_NAME_LENGTH, confirmLabel: 'Save', error,
            onConfirm: async (name) => {
              try {
                await renameResume(r.id, name);
                renamingId = null;
                error = '';
                await refresh();
              } catch (e) { error = e.message; render(); }
            },
            onCancel: () => { renamingId = null; error = ''; render(); },
          });
        }
        const current = r.id === store.activeResumeId;
        return h('div.switch-row', { 'aria-current': current ? 'true' : null },
          h('button.switch-pick', {
            type: 'button',
            onclick: async () => {
              uploadError = '';
              if (!current) {
                await setActiveResumeId(r.id);
                await refresh();
              }
              dd.setOpen(false);
            },
          },
          current && h('span.switch-dot', { 'aria-hidden': 'true' }),
          r.name,
          r.needsReupload && h('span.switch-flag', null, 're-upload needed')),
          iconButton('edit', { label: `Rename ${r.name}`, onClick: () => { renamingId = r.id; deleteId = null; error = ''; render(); } }),
          iconButton('trash', { label: `Delete ${r.name}`, danger: true, onClick: () => { deleteId = r.id; renamingId = null; error = ''; render(); } }));
      });

    const foot = h('div.switch-foot', null,
      uploading
        ? h('div.switch-add.is-busy', null, spinner('Parsing resume…'))
        : h('button.switch-add', { type: 'button', disabled: atCapacity, onclick: () => fileInput.click() },
          ico('upload', 15), atCapacity ? `Limit of ${MAX_RESUMES} reached` : 'Upload resume'),
      !uploading && !atCapacity && h('p.switch-hint', null, `or drop a file onto the picker — PDF or image, up to ${MAX_RESUME_LABEL}`),
      uploadError && h('p.switch-err', { role: 'alert' }, uploadError));

    fill(dd.menu, h('div.switch-list', null, rows), foot);
  }

  refresh();
  return {
    el: dd.root,
    refresh,
    destroy() { drop.destroy(); dd.destroy(); },
  };
}
