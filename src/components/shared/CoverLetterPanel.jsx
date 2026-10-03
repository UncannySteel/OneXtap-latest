import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FileText, Plus, Save, Trash2, Copy, RotateCcw } from 'lucide-react';
import { loadProfileStore, updateActiveProfileData, MAX_COVER_LETTERS_PER_PROFILE } from '../../profileStore';
import { getAccessToken } from '../../auth';
import { getApplicationTypeConfig } from '../../applicationTypes';
import { ANSWER_STUDIO_MODEL, API_URL } from '../../config';
import { hasExtensionRuntime, sendToExtension } from '../../extensionClient';
import { ANSWER_STYLE_INSTRUCTIONS, CREDIT_API_TIMEOUT_MS, withTimeout } from '../../answerStudio';
import { creditManager } from '../../creditManager';
import { applicationKey, consumesCredit, allowanceAfter } from '../../coverLetterCredits';
import { log as baseLog } from '../../logger';
import FabricationNotice, { loadFabricationCorpus } from './FabricationNotice';

const log = baseLog.child('ui');

// --- COVER LETTER ---
const normalizeCoverLetterTemplates = (templates = []) =>
  templates.map((t) => ({
    ...t,
    variants: Array.isArray(t.variants) ? t.variants : [],
  }));

/**
 * Cover-letter manager, shared by the dashboard tab and the popup.
 *
 * Holds the templates for the active profile, generates per-application
 * variants against scraped job context, and pushes the chosen text into the
 * page with FILL_COVER_LETTER. Capped at MAX_COVER_LETTERS_PER_PROFILE.
 *
 * Personalising costs what src/coverLetterCredits.js says: one credit buys a
 * personalisation and one free re-run of it; Premium is unlimited. Checked
 * before the call, deducted through the server after a successful one, as in
 * Answer Studio. The web dashboard's Cover Letter workspace does the same.
 *
 * @param {object} props
 * @param {(message: string, type?: 'success'|'error'|'loading') => void} props.showToast
 * @param {object|null} props.user
 * @param {boolean} [props.compact=false] Denser styling for the popup.
 * @param {string} [props.applicationType='job'] Application type id; selects wording.
 * @param {string} [props.documentLabel='Cover letter'] Display noun — becomes
 *   "Personal Statement" or "Scholarship Essay" for other application types.
 */
const CoverLetterPanel = ({ showToast, user, compact = false, applicationType = 'job', documentLabel = 'Cover letter' }) => {
  const appTypeConfig = getApplicationTypeConfig(applicationType);
  const [coverLetters, setCoverLetters] = useState([]);
  const [activeTemplateId, setActiveTemplateId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [originalText, setOriginalText] = useState('');
  const [suggestionText, setSuggestionText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [fabricationFlags, setFabricationFlags] = useState([]);
  const [hasJobDescription, setHasJobDescription] = useState(false);
  const [coverFieldDetected, setCoverFieldDetected] = useState(false);
  const [manualCompany, setManualCompany] = useState('');
  const [manualRole, setManualRole] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [newTemplateName, setNewTemplateName] = useState('');
  const [addingTemplate, setAddingTemplate] = useState(false);
  // null until loaded (or when it could not be); Infinity on Premium.
  const [credits, setCredits] = useState(null);
  const [premium, setPremium] = useState(false);
  const saveDebounceRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastContextRef = useRef({ company: '', description: '' });
  const hasChrome = hasExtensionRuntime();

  const loadTemplates = useCallback(async () => {
    const store = await loadProfileStore();
    const active = store.profiles[store.activeProfileId];
    const templates = normalizeCoverLetterTemplates(active?.coverLetters || []);
    setCoverLetters(templates);
    setActiveTemplateId((currentId) => {
      if (templates.length && !currentId) {
        setOriginalText(templates[0].body || '');
        return templates[0].id;
      }
      return currentId;
    });
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    creditManager.getCreditsWithStatus().then((res) => {
      if (!alive) return;
      setPremium(res.isPremium);
      if (!res.error) setCredits(res.isPremium ? Infinity : (res.credits ?? 0));
    });
    return () => { alive = false; };
  }, [user]);

  useEffect(() => {
    const checkPage = async () => {
      if (!hasChrome || !chrome.tabs) return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch { /* restricted page */ }
      chrome.tabs.sendMessage(tab.id, { action: 'SCRAPE_CONTEXT' }, (ctxRes) => {
        const company = ctxRes?.context?.company || '';
        const desc = ctxRes?.context?.description || '';
        lastContextRef.current = { company, description: desc };
        if (company && !manualCompany) setManualCompany(company);
        if (desc.trim().length > 100) {
          setHasJobDescription(true);
          if (!manualDescription) setManualDescription(desc.slice(0, 6000));
        }
      });
      chrome.tabs.sendMessage(tab.id, { action: 'DETECT_SECTIONS', profile: {} }, (detRes) => {
        setCoverFieldDetected(!!detRes?.sections?.coverLetter);
      });
    };
    checkPage();
  }, [hasChrome]);

  const persistTemplates = async (templates) => {
    const normalized = normalizeCoverLetterTemplates(templates);
    setCoverLetters(normalized);
    await updateActiveProfileData({ coverLetters: normalized });
  };

  const debouncedSaveBody = (templateId, body) => {
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(async () => {
      const store = await loadProfileStore();
      const active = store.profiles[store.activeProfileId];
      const current = normalizeCoverLetterTemplates(active?.coverLetters || []);
      const next = current.map((t) => (t.id === templateId ? { ...t, body } : t));
      await persistTemplates(next);
    }, 500);
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (!text.trim()) {
        showToast?.('File is empty', 'error');
        return;
      }
      if (coverLetters.length >= MAX_COVER_LETTERS_PER_PROFILE) {
        showToast?.(`Maximum ${MAX_COVER_LETTERS_PER_PROFILE} templates per profile`, 'error');
        return;
      }
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 32);
      const template = {
        id: `cl-${Date.now()}`,
        name: baseName || `Template ${coverLetters.length + 1}`,
        body: text.trim(),
        createdAt: new Date().toISOString(),
        applicationType,
        variants: [],
      };
      const next = [...coverLetters, template];
      await persistTemplates(next);
      setActiveTemplateId(template.id);
      setExpandedId(template.id);
      setOriginalText(template.body);
      showToast?.(`${documentLabel} uploaded`, 'success');
    } catch {
      showToast?.('Could not read file — try a .txt file', 'error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAddTemplate = async () => {
    if (coverLetters.length >= MAX_COVER_LETTERS_PER_PROFILE) {
      showToast?.(`Maximum ${MAX_COVER_LETTERS_PER_PROFILE} templates per profile`, 'error');
      return;
    }
    const name = (newTemplateName || `Template ${coverLetters.length + 1}`).trim().slice(0, 32);
    const template = {
      id: `cl-${Date.now()}`,
      name,
      body: '',
      createdAt: new Date().toISOString(),
      applicationType,
      variants: [],
    };
    const next = [...coverLetters, template];
    await persistTemplates(next);
    setActiveTemplateId(template.id);
    setExpandedId(template.id);
    setOriginalText('');
    setNewTemplateName('');
    setAddingTemplate(false);
    showToast?.('Template added', 'success');
  };

  const handleDeleteTemplate = async (id) => {
    const next = coverLetters.filter((t) => t.id !== id);
    await persistTemplates(next);
    if (activeTemplateId === id) {
      const first = next[0];
      setActiveTemplateId(first?.id || null);
      setOriginalText(first?.body || '');
    }
    showToast?.('Template removed', 'success');
  };

  const handleDeleteVariant = async (templateId, variantId) => {
    const next = coverLetters.map((t) =>
      t.id === templateId
        ? { ...t, variants: (t.variants || []).filter((v) => v.id !== variantId) }
        : t
    );
    await persistTemplates(next);
    showToast?.('Saved version removed', 'success');
  };

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

  const handlePersonalize = async () => {
    const template = coverLetters.find((t) => t.id === activeTemplateId);
    if (!template?.body?.trim()) {
      setGenerateError(`Add a ${documentLabel.toLowerCase()} template first.`);
      return;
    }
    if (!user) {
      setGenerateError('Sign in to use AI personalization.');
      return;
    }

    setIsGenerating(true);
    setGenerateError('');
    setSuggestionText('');
    setFabricationFlags([]);
    setOriginalText(template.body);

    try {
      let company = manualCompany.trim();
      let description = manualDescription.trim();
      if (hasChrome) {
        const scrapeRes = await sendToExtension('SCRAPE_ACTIVE_TAB');
        if (scrapeRes?.success && scrapeRes?.context) {
          company = scrapeRes.context.company || company;
          description = scrapeRes.context.description || description;
        }
      }
      if (!description?.trim()) {
        setGenerateError('Open an application page or paste a description below.');
        setIsGenerating(false);
        return;
      }

      const key = applicationKey(description);
      let latest = credits;
      let isPremium = premium;
      if (!isPremium && latest === null) {
        const res = await creditManager.getCreditsWithStatus();
        if (!res.error) {
          isPremium = res.isPremium;
          latest = res.isPremium ? Infinity : (res.credits ?? 0);
          setPremium(isPremium);
          setCredits(latest);
        }
      }
      const charged = consumesCredit({ premium: isPremium, template, key });
      if (charged && Number(latest || 0) <= 0) {
        setGenerateError('No credits remaining. Premium makes cover letters unlimited.');
        setIsGenerating(false);
        return;
      }

      const token = await getAccessToken();
      if (!token) throw new Error('Please sign in first.');

      const jdSnippet = String(description).substring(0, 6000);
      const roleLine = manualRole.trim() ? `Role: ${manualRole.trim()}\n\n` : '';
      const taskHint = applicationType === 'college' || applicationType === 'scholarship'
        ? `Rewrite this ${documentLabel.toLowerCase()} for the specific program or opportunity. Preserve the candidate's voice. Reference the institution or organization by name. Weave in 2-4 themes from the description. First person. No headings or bullet points.`
        : `Rewrite the cover letter template for this specific opportunity. Preserve the candidate's writing style and voice — do not make it generic. Reference the company and role by name. Weave in 2-4 key requirements from the description. Keep length within ±10% of the original. First person. No headings or bullet points.`;

      // The active resume, if there is one. Sending it turns on the server's
      // deterministic fabrication check; omitting it leaves the call exactly as
      // it was before that check existed.
      const corpus = await loadFabricationCorpus();

      const res = await fetch(`${API_URL}/api/answer-vault/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          question: `${documentLabel} for this application`,
          draft: template.body,
          jobContext: `${company ? `Organization: ${company}\n` : ''}${roleLine}${jdSnippet}`,
          taskHint,
          styleHint: ANSWER_STYLE_INSTRUCTIONS.balanced,
          model: ANSWER_STUDIO_MODEL,
          ...(corpus.length ? { corpus } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Generation failed (${res.status})`);

      const text = String(body?.text || '').trim();
      if (!text) throw new Error('Empty response from AI');
      setSuggestionText(text);
      // Advisory only — never regenerate on a flag. See FabricationNotice.
      setFabricationFlags(Array.isArray(body?.fabricationFlags) ? body.fabricationFlags : []);
      lastContextRef.current = { company, description };

      let deducted = false;
      if (charged) {
        try {
          const deduct = await withTimeout(creditManager.deductCredit(), CREDIT_API_TIMEOUT_MS, 'Credit update timed out after generation.');
          if (!deduct.success) {
            setGenerateError(deduct.error || 'Letter written, but your credits could not be updated.');
          } else {
            deducted = true;
            setCredits(deduct.isPremium ? Infinity : deduct.remaining);
          }
        } catch (creditErr) {
          log.warn('Credit deduction failed after generation:', creditErr);
          setGenerateError('Letter written, but the credit update failed. Reopen Onextap to see your balance.');
        }
      }
      const allowance = allowanceAfter({ premium: isPremium, charged, deducted, template, key });
      const next = coverLetters.map((t) =>
        t.id === template.id ? { ...t, lastUsed: new Date().toISOString(), ...allowance } : t
      );
      await persistTemplates(next);
      showToast?.(charged || isPremium ? `${documentLabel} personalized` : `${documentLabel} personalized (free re-run)`, 'success');
    } catch (e) {
      setGenerateError(e?.message || 'AI generation failed');
      showToast?.(e?.message || 'Generation failed', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveVariant = async () => {
    if (!suggestionText.trim() || !activeTemplateId) return;
    const ctx = lastContextRef.current;
    const variant = {
      id: `clv-${Date.now()}`,
      company: manualCompany.trim() || ctx.company || '',
      role: manualRole.trim(),
      jdSnippet: (ctx.description || manualDescription || '').slice(0, 500),
      body: suggestionText.trim(),
      createdAt: new Date().toISOString(),
    };
    const next = coverLetters.map((t) =>
      t.id === activeTemplateId
        ? { ...t, variants: [variant, ...(t.variants || [])] }
        : t
    );
    await persistTemplates(next);
    showToast?.('Saved to dashboard', 'success');
  };

  const handleCopySuggestion = async () => {
    if (!suggestionText) return;
    try {
      await navigator.clipboard.writeText(suggestionText);
      showToast?.('Copied to clipboard', 'success');
    } catch {
      showToast?.('Could not copy', 'error');
    }
  };

  const allSavedVariants = coverLetters.flatMap((t) =>
    (t.variants || []).map((v) => ({ ...v, templateName: t.name, templateId: t.id }))
  ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const activeTemplate = coverLetters.find((t) => t.id === activeTemplateId);
  const canPersonalize = !!(manualDescription.trim() || hasJobDescription) && !!activeTemplate?.body?.trim() && !!user;
  // What the button will cost, in words (src/coverLetterCredits.js).
  const personalizeCost = (() => {
    if (!user || premium || !activeTemplate?.body?.trim() || !manualDescription.trim()) return '';
    if (!consumesCredit({ premium, template: activeTemplate, key: applicationKey(manualDescription) })) return 'Free re-run for this description';
    if (credits === 0) return 'No credits left · Premium makes cover letters unlimited';
    return 'Uses 1 credit · includes 1 free re-run';
  })();

  return (
    <div className={`space-y-4 ${compact ? '' : 'max-w-3xl mx-auto'}`}>
      {compact && allSavedVariants.length > 0 && (
        <div className="rounded-xl border border-onextap-primary/15 bg-white/80 p-3 dark:bg-onextap-night-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-onextap-dark/50 mb-2 dark:text-[#9AB07A]">Saved versions</p>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {allSavedVariants.slice(0, 8).map((v) => (
              <div key={v.id} className="flex items-start justify-between gap-2 rounded-lg border border-onextap-primary/10 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-onextap-dark truncate dark:text-[#E8EFD8]">
                    {[v.company, v.role].filter(Boolean).join(' · ') || v.templateName}
                  </p>
                  <p className="text-[10px] text-onextap-dark/45 truncate dark:text-[#9AB07A]">{v.body.slice(0, 72)}…</p>
                </div>
                <button type="button" onClick={() => handleFillText(v.body)} className="shrink-0 rounded-md bg-onextap-primary px-2 py-1 text-[10px] font-semibold text-white">
                  Fill
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {coverLetters.length === 0 && !addingTemplate ? (
        <div className="rounded-2xl border border-dashed border-onextap-primary/25 bg-white/70 p-6 text-center dark:bg-onextap-night-card">
          <FileText size={28} className="mx-auto mb-2 text-onextap-primary/60" />
          <p className="text-sm text-onextap-dark/70 dark:text-[#9AB07A] mb-3">Upload or paste a {documentLabel.toLowerCase()} to get started.</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <input ref={fileInputRef} type="file" accept=".txt,.text,.md" onChange={handleFileUpload} className="hidden" id="cover-letter-upload" />
            <label htmlFor="cover-letter-upload" className="cursor-pointer rounded-xl bg-onextap-primary px-4 py-2 text-sm font-semibold text-white">
              Upload file
            </label>
            <button type="button" onClick={() => setAddingTemplate(true)} className="rounded-xl border border-onextap-primary/25 px-4 py-2 text-sm font-semibold text-onextap-primary">
              Paste manually
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {coverLetters.map((t) => (
              <div key={t.id} className="rounded-xl border border-onextap-primary/15 bg-white/80 dark:bg-onextap-night-card overflow-hidden">
                <div className="flex w-full items-start justify-between gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedId(expandedId === t.id ? null : t.id);
                      setActiveTemplateId(t.id);
                      setOriginalText(t.body || '');
                      setSuggestionText('');
                      setFabricationFlags([]);
                    }}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="text-sm font-semibold text-onextap-dark dark:text-[#E8EFD8]">{t.name}</p>
                    <p className="text-xs text-onextap-dark/50 truncate dark:text-[#9AB07A]">{(t.body || '').slice(0, 60)}{(t.body || '').length > 60 ? '…' : ''}</p>
                    {(t.variants || []).length > 0 && (
                      <p className="text-[10px] text-onextap-primary mt-0.5">{(t.variants || []).length} saved version{(t.variants || []).length === 1 ? '' : 's'}</p>
                    )}
                  </button>
                  <button type="button" onClick={() => handleDeleteTemplate(t.id)} className="shrink-0 p-1 text-onextap-dark/30 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
                {expandedId === t.id && (
                  <div className="border-t border-onextap-primary/10 px-3 py-3 space-y-2">
                    <input
                      value={t.name}
                      onChange={async (e) => {
                        const name = e.target.value.slice(0, 32);
                        const next = coverLetters.map((x) => (x.id === t.id ? { ...x, name } : x));
                        await persistTemplates(next);
                      }}
                      className="w-full rounded-lg border border-onextap-primary/20 px-2 py-1.5 text-sm"
                      placeholder="Template name"
                    />
                    <textarea
                      value={t.id === activeTemplateId && originalText !== undefined ? originalText : t.body}
                      onChange={(e) => {
                        const body = e.target.value;
                        setOriginalText(body);
                        debouncedSaveBody(t.id, body);
                      }}
                      className="w-full rounded-lg border border-onextap-primary/20 px-2 py-2 text-sm h-32 resize-none"
                      placeholder={`Paste your base ${documentLabel.toLowerCase()}…`}
                    />
                    {(t.variants || []).length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-onextap-dark/45">Saved for specific applications</p>
                        {(t.variants || []).map((v) => (
                          <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg bg-onextap-primary/5 px-2 py-1.5">
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{[v.company, v.role].filter(Boolean).join(' · ') || 'Custom version'}</p>
                              <p className="text-[10px] text-onextap-dark/45 truncate">{v.body.slice(0, 80)}…</p>
                            </div>
                            <div className="flex shrink-0 gap-1">
                              <button type="button" onClick={() => { setSuggestionText(v.body); setActiveTemplateId(t.id); setFabricationFlags([]); }} className="text-[10px] font-medium text-onextap-primary">Open</button>
                              {hasChrome && (
                                <button type="button" onClick={() => handleFillText(v.body)} className="text-[10px] font-medium text-onextap-primary">Fill</button>
                              )}
                              <button type="button" onClick={() => handleDeleteVariant(t.id, v.id)} className="text-[10px] text-red-500">Delete</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {addingTemplate ? (
            <div className="rounded-xl border border-onextap-primary/15 bg-white/80 p-3 space-y-2 dark:bg-onextap-night-card">
              <input value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value.slice(0, 32))} placeholder="Template name (e.g. Formal)" className="w-full rounded-lg border border-onextap-primary/20 px-2 py-1.5 text-sm" />
              <div className="flex gap-2">
                <button type="button" onClick={handleAddTemplate} className="rounded-lg bg-onextap-dark px-3 py-1.5 text-xs text-white font-medium">Save</button>
                <button type="button" onClick={() => setAddingTemplate(false)} className="rounded-lg border border-onextap-primary/20 px-3 py-1.5 text-xs">Cancel</button>
              </div>
            </div>
          ) : coverLetters.length < MAX_COVER_LETTERS_PER_PROFILE && (
            <div className="flex flex-wrap gap-2">
              <input ref={fileInputRef} type="file" accept=".txt,.text,.md" onChange={handleFileUpload} className="hidden" id="cover-letter-upload-more" />
              <label htmlFor="cover-letter-upload-more" className="cursor-pointer text-sm font-medium text-onextap-primary flex items-center gap-1"><Plus size={14} /> Upload file</label>
              <button type="button" onClick={() => setAddingTemplate(true)} className="text-sm font-medium text-onextap-primary flex items-center gap-1"><Plus size={14} /> Add template</button>
            </div>
          )}

          <div className="rounded-xl border border-onextap-primary/15 bg-white/70 p-3 space-y-2 dark:bg-onextap-night-card">
            <p className="text-xs font-semibold uppercase tracking-wide text-onextap-dark/50">Target application (optional)</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input value={manualCompany} onChange={(e) => setManualCompany(e.target.value)} placeholder="Company / school / organization" className="rounded-lg border border-onextap-primary/20 px-2 py-1.5 text-sm" />
              <input value={manualRole} onChange={(e) => setManualRole(e.target.value)} placeholder="Role / program / scholarship name" className="rounded-lg border border-onextap-primary/20 px-2 py-1.5 text-sm" />
            </div>
            <textarea value={manualDescription} onChange={(e) => { setManualDescription(e.target.value); setHasJobDescription(e.target.value.trim().length > 100); }} placeholder="Paste job description, program details, or scholarship prompt…" className="w-full rounded-lg border border-onextap-primary/20 px-2 py-2 text-sm h-20 resize-none" />
          </div>

          <div className="relative">
            <button
              type="button"
              disabled={!canPersonalize || isGenerating}
              onClick={handlePersonalize}
              className="w-full rounded-xl bg-gradient-to-br from-onextap-primary to-onextap-primary-dark py-3 text-sm font-bold text-white shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? 'Personalizing…' : `Personalize for this ${appTypeConfig.shortLabel.toLowerCase()} application`}
            </button>
            {personalizeCost && (
              <p className="mt-1 text-center text-[11px] text-onextap-dark/50 dark:text-[#9AB07A]">{personalizeCost}</p>
            )}
          </div>

          {(suggestionText || isGenerating) && (
            <div className={`grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-onextap-dark/50 mb-1">Original</p>
                <textarea value={originalText} onChange={(e) => { setOriginalText(e.target.value); if (activeTemplateId) debouncedSaveBody(activeTemplateId, e.target.value); }} className="w-full rounded-xl border border-onextap-primary/15 px-3 py-2 text-sm h-40 resize-none bg-white/80 dark:bg-onextap-night-card" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-onextap-dark/50 mb-1">AI Suggestion</p>
                {isGenerating ? (
                  <div className="h-40 rounded-xl border border-onextap-primary/15 bg-onextap-primary/5 animate-pulse" />
                ) : (
                  <textarea value={suggestionText} onChange={(e) => setSuggestionText(e.target.value)} className="w-full rounded-xl border border-onextap-primary/15 px-3 py-2 text-sm h-40 resize-none bg-white/80 dark:bg-onextap-night-card" />
                )}
                {!isGenerating && suggestionText && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={handleSaveVariant} className="flex items-center gap-1 rounded-lg bg-onextap-primary px-3 py-1.5 text-xs font-medium text-white"><Save size={12} /> Save version</button>
                    <button type="button" onClick={handleCopySuggestion} className="flex items-center gap-1 rounded-lg border border-onextap-primary/20 px-3 py-1.5 text-xs font-medium"><Copy size={12} /> Copy</button>
                    {(coverFieldDetected || hasChrome) && (
                      <button type="button" onClick={() => handleFillText(suggestionText)} className="flex items-center gap-1 rounded-lg bg-onextap-dark px-3 py-1.5 text-xs font-medium text-white">Fill page</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {!isGenerating && <FabricationNotice flags={fabricationFlags} />}

          {generateError && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 border border-red-200">
              <span>{generateError}</span>
              <button type="button" onClick={handlePersonalize} className="shrink-0 flex items-center gap-1 text-xs font-medium underline"><RotateCcw size={12} /> Retry</button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CoverLetterPanel;
