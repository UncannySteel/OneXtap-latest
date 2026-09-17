import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Save, Trash2, ChevronDown, Settings } from 'lucide-react';
import { loadProfileStore, setActiveProfileId, createProfile, renameProfile, deleteProfile, listProfiles, MAX_PROFILE_NAME_LENGTH } from '../../profileStore';

// --- PROFILE SWITCHER ---
/**
 * Dropdown for switching, creating, renaming and deleting profiles.
 *
 * Writes straight to profileStore; the parent learns about a change only
 * through `onProfileChange`. Callers typically use that to bump a `key` and
 * force the dependent panel to remount against the new active profile.
 *
 * @param {object} props
 * @param {boolean} [props.compact=false] Denser styling for the popup.
 * @param {() => void} [props.onProfileChange] Fired after any switch or edit.
 */
const ProfileSwitcher = ({ compact = false, onProfileChange }) => {
  const [store, setStore] = useState(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNameError, setNewNameError] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const dropdownRef = useRef(null);
  const onProfileChangeRef = useRef(onProfileChange);
  onProfileChangeRef.current = onProfileChange;

  const refresh = useCallback(async () => {
    const next = await loadProfileStore();
    setStore(next);
    onProfileChangeRef.current?.(next);
    return next;
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
        setCreating(false);
        setRenamingId(null);
        setDeleteConfirmId(null);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!store) {
    return (
      <div className="h-10 animate-pulse rounded-xl bg-onextap-primary/10" />
    );
  }

  const profiles = listProfiles(store);
  const active = profiles.find((p) => p.id === store.activeProfileId);
  const canDeleteAny = profiles.length > 1;

  const handleSelect = async (id) => {
    await setActiveProfileId(id);
    await refresh();
    setOpen(false);
  };

  const handleCreate = async () => {
    try {
      setNewNameError('');
      await createProfile(newName);
      setNewName('');
      setCreating(false);
      await refresh();
    } catch (e) {
      setNewNameError(e.message);
    }
  };

  const handleRename = async (id) => {
    try {
      setRenameError('');
      await renameProfile(id, renameValue);
      setRenamingId(null);
      setRenameValue('');
      await refresh();
    } catch (e) {
      setRenameError(e.message);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteProfile(id);
      setDeleteConfirmId(null);
      await refresh();
    } catch (e) {
      setRenameError(e.message);
    }
  };

  return (
    <div className={`relative ${compact ? '' : 'mb-3'}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-onextap-primary/20 bg-white/90 px-3 py-2.5 text-left text-sm font-semibold text-onextap-dark shadow-sm transition-all hover:border-onextap-primary/35 dark:bg-onextap-night-card dark:text-[#E8EFD8] dark:border-onextap-primary-light/25"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="h-2 w-2 shrink-0 rounded-full bg-onextap-primary" />
          <span className="truncate">{active?.name || 'Default'}</span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-onextap-dark/50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-onextap-primary/20 bg-white shadow-lg dark:bg-onextap-night-card dark:border-onextap-primary-light/25">
          <div className="max-h-[240px] overflow-y-auto">
            {profiles.map((p) => (
              <div key={p.id} className="border-b border-onextap-primary/10 last:border-b-0">
                {deleteConfirmId === p.id ? (
                  <div className="px-3 py-2.5 text-xs text-onextap-dark/80 dark:text-[#E8EFD8]">
                    Delete {p.name}? This cannot be undone.
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => handleDelete(p.id)} className="rounded-lg bg-red-600 px-2.5 py-1 text-white font-medium">Delete</button>
                      <button type="button" onClick={() => setDeleteConfirmId(null)} className="rounded-lg border border-onextap-primary/20 px-2.5 py-1">Cancel</button>
                    </div>
                  </div>
                ) : renamingId === p.id ? (
                  <div className="px-3 py-2.5">
                    <input
                      value={renameValue}
                      onChange={(e) => { setRenameValue(e.target.value.slice(0, MAX_PROFILE_NAME_LENGTH)); setRenameError(''); }}
                      className="w-full rounded-lg border border-onextap-primary/30 px-2 py-1.5 text-sm"
                      placeholder="Profile name"
                      maxLength={MAX_PROFILE_NAME_LENGTH}
                    />
                    <p className="mt-1 text-[10px] text-onextap-dark/45">{renameValue.length}/{MAX_PROFILE_NAME_LENGTH}</p>
                    {renameError && <p className="mt-1 text-xs text-red-600">{renameError}</p>}
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => handleRename(p.id)} className="rounded-lg bg-onextap-primary px-2.5 py-1 text-xs text-white font-medium">Save</button>
                      <button type="button" onClick={() => { setRenamingId(null); setRenameError(''); }} className="rounded-lg border border-onextap-primary/20 px-2.5 py-1 text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className={`flex items-center gap-1 px-2 py-1.5 ${p.id === store.activeProfileId ? 'bg-onextap-primary/8' : ''}`}>
                    <button
                      type="button"
                      onClick={() => handleSelect(p.id)}
                      className={`flex-1 truncate px-1 py-1 text-left text-sm ${p.id === store.activeProfileId ? 'font-semibold text-onextap-dark dark:text-[#E8EFD8]' : 'text-onextap-dark/70 dark:text-[#9AB07A]'}`}
                    >
                      {p.id === store.activeProfileId && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-onextap-primary" />}
                      {p.name}
                    </button>
                    <button
                      type="button"
                      title="Rename"
                      onClick={() => { setRenamingId(p.id); setRenameValue(p.name); setRenameError(''); }}
                      className="rounded-lg p-1.5 text-onextap-dark/40 hover:bg-onextap-primary/10 hover:text-onextap-primary"
                    >
                      <Settings size={13} />
                    </button>
                    {canDeleteAny && !p.isDefault && (
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => setDeleteConfirmId(p.id)}
                        className="rounded-lg p-1.5 text-onextap-dark/40 hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-onextap-primary/15 bg-onextap-cream/50 dark:bg-onextap-night">
            {creating ? (
              <div className="px-3 py-2.5">
                <input
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value.slice(0, MAX_PROFILE_NAME_LENGTH)); setNewNameError(''); }}
                  placeholder="Profile name"
                  className="w-full rounded-lg border border-onextap-primary/30 px-2 py-1.5 text-sm"
                  maxLength={MAX_PROFILE_NAME_LENGTH}
                  autoFocus
                />
                <p className="mt-1 text-[10px] text-onextap-dark/45">{newName.length}/{MAX_PROFILE_NAME_LENGTH}</p>
                {newNameError && <p className="mt-1 text-xs text-red-600">{newNameError}</p>}
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={handleCreate} className="rounded-lg bg-onextap-dark px-2.5 py-1 text-xs text-white font-medium">Create</button>
                  <button type="button" onClick={() => { setCreating(false); setNewName(''); setNewNameError(''); }} className="rounded-lg border border-onextap-primary/20 px-2.5 py-1 text-xs">Cancel</button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-onextap-primary hover:bg-onextap-primary/10"
              >
                <Plus size={14} /> New Profile
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfileSwitcher;
