import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Copy, ExternalLink, FileText } from 'lucide-react';
import { loadProfileStore } from '../../profileStore';
import { hasExtensionRuntime } from '../../extensionClient';

// --- COVER LETTER ---
const normalizeCoverLetterTemplates = (templates = []) =>
  templates.map((t) => ({
    ...t,
    variants: Array.isArray(t.variants) ? t.variants : [],
  }));

/** Every saved version across the templates, newest first. */
const savedVersionsOf = (templates) =>
  templates
    .flatMap((t) => t.variants.map((v) => ({ ...v, templateName: t.name, templateId: t.id })))
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));

const versionTitle = (v) => [v.company, v.role].filter(Boolean).join(' · ') || v.templateName || 'Saved version';

/**
 * The popup's cover-letter tab: read-only. (The dashboard's is the website's
 * Cover Letter workspace, web/dashboard/js/ws/cover-letter.js.)
 *
 * Shows the active profile's templates and the versions saved from them,
 * newest first, and fills a version into the page with FILL_COVER_LETTER.
 * "Open" shows one version's whole text, to read, copy or fill.
 *
 * Writing happens on the dashboard: templates are added, edited and deleted
 * there, and letters are personalised there (completion plan D6). The popup
 * has no sign-in of its own (D5, HANDOVER.md §7 item 27), so it never spends
 * credits; what the dashboard saves reaches it through ONEXTAP_SYNC_DATA.
 *
 * @param {object} props
 * @param {(message: string, type?: 'success'|'error'|'loading') => void} props.showToast
 * @param {() => void} [props.onOpenDashboard] Opens the dashboard's Cover
 *   Letter workspace (`?view=cover`).
 * @param {string} [props.documentLabel='Cover letter'] Display noun: the
 *   application type's name for the document.
 */
const CoverLetterPanel = ({ showToast, onOpenDashboard, documentLabel = 'Cover letter' }) => {
  const [coverLetters, setCoverLetters] = useState([]);
  const [openId, setOpenId] = useState(null);
  const hasChrome = hasExtensionRuntime();

  const loadTemplates = useCallback(async () => {
    const store = await loadProfileStore();
    const active = store.profiles[store.activeProfileId];
    setCoverLetters(normalizeCoverLetterTemplates(active?.coverLetters || []));
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const handleFillText = async (text) => {
    if (!text?.trim() || !hasChrome || !chrome.tabs) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      chrome.tabs.sendMessage(tab.id, { action: 'FILL_COVER_LETTER', text }, (res) => {
        if (res?.success) showToast?.(`${documentLabel} filled`, 'success');
        else showToast?.('No matching field found on this page', 'error');
      });
    } catch {
      showToast?.('Cannot access this page', 'error');
    }
  };

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast?.('Copied to clipboard', 'success');
    } catch {
      showToast?.('Could not copy', 'error');
    }
  };

  const savedVersions = savedVersionsOf(coverLetters);
  const opened = openId ? savedVersions.find((v) => v.id === openId) : null;
  const noun = documentLabel.toLowerCase();

  const fillButton = (text) => hasChrome && (
    <button type="button" onClick={() => handleFillText(text)} className="shrink-0 rounded-md bg-onextap-primary px-2 py-1 text-[10px] font-semibold text-white">
      Fill
    </button>
  );

  const manageOnDashboard = onOpenDashboard && (
    <button
      type="button"
      onClick={onOpenDashboard}
      className="w-full rounded-xl bg-gradient-to-br from-onextap-primary to-onextap-primary-dark py-3 text-sm font-bold text-white shadow-md flex items-center justify-center gap-2"
    >
      <ExternalLink size={16} className="shrink-0" />
      Manage templates on the dashboard
    </button>
  );

  // One saved version, opened: its whole text, to read, copy or fill.
  if (opened) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setOpenId(null)} className="flex items-center gap-1 text-xs font-medium text-onextap-primary">
          <ArrowLeft size={12} className="shrink-0" /> All saved versions
        </button>
        <div className="rounded-xl border border-onextap-primary/15 bg-white/80 p-3 space-y-2 dark:bg-onextap-night-card">
          <div>
            <p className="text-sm font-semibold text-onextap-dark dark:text-[#E8EFD8]">{versionTitle(opened)}</p>
            <p className="text-[10px] text-onextap-dark/45 dark:text-[#9AB07A]">From {opened.templateName || 'a template'}</p>
          </div>
          <textarea
            readOnly
            value={opened.body}
            aria-label="Saved version"
            className="w-full rounded-lg border border-onextap-primary/15 bg-white/60 px-2 py-2 text-sm h-56 resize-none dark:bg-onextap-night"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => handleCopy(opened.body)} className="flex items-center gap-1 rounded-lg border border-onextap-primary/20 px-3 py-1.5 text-xs font-medium">
              <Copy size={12} /> Copy
            </button>
            {fillButton(opened.body)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {savedVersions.length > 0 && (
        <div className="rounded-xl border border-onextap-primary/15 bg-white/80 p-3 dark:bg-onextap-night-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-onextap-dark/50 mb-2 dark:text-[#9AB07A]">Saved versions</p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {savedVersions.map((v) => (
              <div key={v.id} className="flex items-start justify-between gap-2 rounded-lg border border-onextap-primary/10 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-onextap-dark truncate dark:text-[#E8EFD8]">{versionTitle(v)}</p>
                  <p className="text-[10px] text-onextap-dark/45 truncate dark:text-[#9AB07A]">{String(v.body || '').slice(0, 72)}…</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => setOpenId(v.id)} className="px-1 text-[10px] font-medium text-onextap-primary">Open</button>
                  {fillButton(v.body)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {coverLetters.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-onextap-primary/25 bg-white/70 p-6 text-center dark:bg-onextap-night-card">
          <FileText size={28} className="mx-auto mb-2 text-onextap-primary/60" />
          <p className="text-sm text-onextap-dark/70 dark:text-[#9AB07A]">No {noun} templates yet. Add one on the dashboard.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-onextap-dark/50 dark:text-[#9AB07A]">Templates</p>
          {coverLetters.map((t) => (
            <div key={t.id} className="rounded-xl border border-onextap-primary/15 bg-white/80 px-3 py-2.5 dark:bg-onextap-night-card">
              <p className="text-sm font-semibold text-onextap-dark dark:text-[#E8EFD8]">{t.name}</p>
              <p className="text-xs text-onextap-dark/50 truncate dark:text-[#9AB07A]">{(t.body || '').slice(0, 60)}{(t.body || '').length > 60 ? '…' : ''}</p>
              {t.variants.length > 0 && (
                <p className="text-[10px] text-onextap-primary mt-0.5">{t.variants.length} saved version{t.variants.length === 1 ? '' : 's'}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-onextap-primary/15 bg-white/70 p-3 space-y-3 text-center dark:bg-onextap-night-card">
        <p className="text-sm text-onextap-dark/70 dark:text-[#9AB07A]">
          Templates are edited, and letters personalised, on the dashboard. Versions you save there appear here, ready to fill.
        </p>
        {manageOnDashboard}
      </div>
    </div>
  );
};

export default CoverLetterPanel;
