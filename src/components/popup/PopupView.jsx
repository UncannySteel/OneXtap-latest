import React, { useState, useEffect, useCallback } from 'react';
import { ArrowRight, Briefcase, Clipboard, ExternalLink, FileText, Layout, MessageSquare, PenTool, Sparkles } from 'lucide-react';
import { getApplicationType, setApplicationType } from '../../applicationTypeStorage';
import { APPLICATION_TYPES, getApplicationTypeConfig } from '../../applicationTypes';
import { getUser, onAuthStateChange } from '../../auth';
import { AUTOFILL_SECTION_META, DEFAULT_SECTION_TOGGLES } from '../../autofillSections';
import { getIconUrl } from '../../extensionClient';
import { getActiveLegacyProfile, loadProfileStore } from '../../profileStore';
import Toast from '../shared/Toast';
import ProfileSwitcher from '../shared/ProfileSwitcher';
import CoverLetterPanel from '../shared/CoverLetterPanel';
import WhatToFillSection from './WhatToFillSection';
import { log as baseLog } from '../../logger';

const log = baseLog.child('ui');

// --- POPUP VIEW (Landing - Animated, two states: signed-in vs onboarding) ---
/**
 * The 400x600 extension popup: autofill trigger, section toggles, cover-letter
 * fill, and links out to the dashboard.
 *
 * Injects content.js into the active tab on demand before each interaction
 * (the script guards against double-injection itself), then drives it with
 * DETECT_SECTIONS / AUTOFILL_TRIGGERED / FILL_COVER_LETTER.
 *
 * @param {object} props
 * @param {(view?: string|null) => void} props.onLaunchDashboard Opens the
 *   dashboard, in a new tab when running as an extension.
 * @param {() => void} props.onLaunchAnswerStudio Same, deep-linked to the vault tab.
 * @param {() => void} [props.onLaunchJobMatches] Same, deep-linked to the jobs
 *   tab. The ranked list is deliberately NOT hosted here: this popup is 400x600
 *   and closes the moment focus leaves it, which is the wrong surface for a
 *   list you read, compare and scroll. The button is an entry point only.
 */
const PopupView = ({ onLaunchDashboard, onLaunchAnswerStudio, onLaunchJobMatches }) => {
  const [popupUser, setPopupUser] = useState(null);
  const [popupTab, setPopupTab] = useState('autofill');
  const [status, setStatus] = useState('Autofill Application');
  const [hasProfile, setHasProfile] = useState(false);
  const [checking, setChecking] = useState(true);
  const [savedAnswers, setSavedAnswers] = useState([]);
  const [coverLetterCount, setCoverLetterCount] = useState(0);
  const [detectedSections, setDetectedSections] = useState({});
  const [sectionToggles, setSectionToggles] = useState({ ...DEFAULT_SECTION_TOGGLES });
  const [popupToast, setPopupToast] = useState({ message: '', type: 'success', visible: false });
  const [coverPanelKey, setCoverPanelKey] = useState(0);
  const [applicationType, setApplicationTypeState] = useState('job');

  const popupAppConfig = getApplicationTypeConfig(applicationType);
  const popupTabs = [
    popupAppConfig.features.autofill && { id: 'autofill', label: 'Autofill', icon: Clipboard },
    popupAppConfig.features.vault && { id: 'answers', label: 'Saved Answers', icon: MessageSquare },
    popupAppConfig.features.coverLetter && { id: 'cover', label: popupAppConfig.coverLetterLabel, icon: FileText },
  ].filter(Boolean);

  const showPopupToast = (message, type = 'success') => setPopupToast({ message, type, visible: true });

  const refreshProfileState = useCallback(async () => {
    const profile = await getActiveLegacyProfile();
    const has = !!profile && (profile.firstName || profile.email || profile.vault?.length);
    setHasProfile(!!has);
    setSavedAnswers(profile?.vault || []);
    const store = await loadProfileStore();
    const active = store.profiles[store.activeProfileId];
    setCoverLetterCount((active?.coverLetters || []).length);
    return profile;
  }, []);

  const detectSectionsOnPage = useCallback(async (profile) => {
    if (!chrome?.tabs) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      chrome.tabs.sendMessage(tab.id, { action: 'DETECT_SECTIONS', profile }, (res) => {
        if (res?.sections) setDetectedSections(res.sections);
      });
    } catch { /* restricted page */ }
  }, []);

  useEffect(() => {
    getUser().then((u) => setPopupUser(u));
    const { unsubscribe } = onAuthStateChange((_, session) => {
      setPopupUser(session?.user || null);
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const storedType = await getApplicationType();
      if (mounted) setApplicationTypeState(storedType);
      await loadProfileStore();
      const profile = await refreshProfileState();
      if (mounted) {
        setChecking(false);
        if (profile) await detectSectionsOnPage(profile);
      }
    })();
    return () => { mounted = false; };
  }, [refreshProfileState, detectSectionsOnPage]);

  useEffect(() => {
    const config = getApplicationTypeConfig(applicationType);
    const allowed = [
      config.features.autofill && 'autofill',
      config.features.vault && 'answers',
      config.features.coverLetter && 'cover',
    ].filter(Boolean);
    if (allowed.length && !allowed.includes(popupTab)) {
      setPopupTab(allowed[0]);
    }
  }, [applicationType, popupTab]);

  const visibleSections = AUTOFILL_SECTION_META.filter((s) => {
    if (s.key === 'coverLetter') return detectedSections.coverLetter && coverLetterCount > 0;
    return detectedSections[s.key];
  });
  const enabledSectionCount = visibleSections.filter((s) => sectionToggles[s.key]).length;
  const autofillDisabled = visibleSections.length > 0 && enabledSectionCount === 0;

  const autofillButtonLabel = (() => {
    if (visibleSections.length === 0) return status;
    if (enabledSectionCount < visibleSections.length) {
      return `Autofill (${enabledSectionCount} of ${visibleSections.length} sections)`;
    }
    return status;
  })();

  const handleAutofill = async () => {
    if (autofillDisabled) return;
    setStatus('Loading...');
    const profile = await getActiveLegacyProfile();

    if (!profile) {
      setStatus('No Profile - Open Dashboard');
      setTimeout(() => setStatus('Autofill Application'), 3000);
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch (err) {
        log.error('Onextap: Failed to inject content script:', err);
        setStatus('Error: Cannot access this page');
        setTimeout(() => setStatus('Autofill Application'), 3000);
        return;
      }

      const sectionsPayload = visibleSections.length > 0
        ? Object.fromEntries(visibleSections.map((s) => [s.key, !!sectionToggles[s.key]]))
        : null;

      chrome.tabs.sendMessage(tab.id, {
        action: 'AUTOFILL_TRIGGERED',
        profile,
        sections: sectionsPayload,
      }, (res) => {
        if (chrome.runtime.lastError) {
          setStatus('Error: ' + chrome.runtime.lastError.message);
          setTimeout(() => setStatus('Autofill Application'), 3000);
          return;
        }
        const filledCount = res?.filled;
        const filledMsg = typeof filledCount === 'number'
          ? `Filled ${filledCount} field${filledCount === 1 ? '' : 's'}`
          : null;
        setStatus(filledMsg || (res?.success === false ? 'Error: ' + (res?.error || 'Failed') : 'Done'));
        setTimeout(() => setStatus('Autofill Application'), 2000);
      });
    } else {
      setStatus('Error: No active tab');
      setTimeout(() => setStatus('Autofill Application'), 3000);
    }
  };

  if (checking) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-onextap-cream p-6 dark:bg-onextap-night">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-onextap-primary/20 border-t-onextap-primary" />
        <p className="mt-3 text-sm font-medium text-onextap-muted dark:text-[#9AB07A]">Loading...</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-onextap-cream dark:bg-onextap-night">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-onextap-primary/[0.08] blur-2xl dark:bg-onextap-primary/[0.15]" />
      </div>

      <header className="relative z-10 shrink-0 px-4 pt-3 pb-2 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={getIconUrl()} alt="Onextap" className="h-8 w-8 shrink-0 rounded-xl shadow-sm ring-1 ring-black/[0.06] dark:ring-white/10" />
            <span className="text-base font-semibold tracking-tight text-onextap-dark dark:text-[#E8EFD8]">Onextap</span>
          </div>
          {hasProfile && (
            <button
              onClick={onLaunchDashboard}
              className="flex items-center gap-1.5 text-onextap-dark/60 hover:text-onextap-primary hover:bg-white/60 py-1.5 px-2.5 rounded-xl text-xs font-medium transition-all"
            >
              <Layout size={14} className="shrink-0" />
              Dashboard
            </button>
          )}
        </div>
        {hasProfile && (
          <>
            {/*
              ═══ APPLICATION TYPE PICKER — HIDDEN, NOT REMOVED ═══

              The popup half of the pair; the dashboard's copy is commented out
              in src/components/dashboard/DashboardView.jsx and the two belong
              back on screen together, along with the non-job entries commented
              out in src/applicationTypes.js — Job is the only type that array
              still lists, so this dropdown would offer exactly one choice.

              Still wired underneath: `applicationType` state, the stored value
              read in the mount effect, and `popupAppConfig`, which is what
              relabels this popup's tabs and buttons per type. Hidden, the popup
              is always on Job, whatever an older build may have stored.

            <select
              value={applicationType}
              onChange={async (e) => {
                const next = e.target.value;
                await setApplicationType(next);
                setApplicationTypeState(next);
              }}
              className="w-full rounded-lg border border-onextap-primary/15 bg-white/80 px-2.5 py-1.5 text-[11px] font-medium text-onextap-dark dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night-card dark:text-[#E8EFD8]"
            >
              {APPLICATION_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            */}
            <ProfileSwitcher compact onProfileChange={async () => {
              const profile = await refreshProfileState();
              setCoverPanelKey((k) => k + 1);
              if (profile) detectSectionsOnPage(profile);
            }} />
          </>
        )}
        {hasProfile && popupTabs.length > 0 && (
          <div className="flex gap-1 rounded-xl bg-white/60 p-1 dark:bg-onextap-night-card">
            {popupTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setPopupTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-all ${
                  popupTab === t.id
                    ? 'bg-onextap-primary text-white shadow-sm'
                    : 'text-onextap-dark/60 hover:bg-white/80 dark:text-[#9AB07A]'
                }`}
              >
                <t.icon size={12} className="shrink-0" />
                <span className="truncate">{t.label}</span>
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-4 relative z-10 min-h-0">
        {hasProfile ? (
          <div className="w-full space-y-4 max-w-[360px] mx-auto pt-1">
            {popupTab === 'autofill' && (
              <div className="space-y-4">
                <WhatToFillSection
                  detectedSections={detectedSections}
                  sectionToggles={sectionToggles}
                  setSectionToggles={setSectionToggles}
                  hasCoverLetterTemplates={coverLetterCount > 0}
                />
                <button
                  onClick={onLaunchAnswerStudio}
                  className="w-full bg-gradient-to-br from-onextap-primary to-onextap-primary-dark text-white py-3 px-4 rounded-2xl font-bold text-sm shadow-md flex items-center justify-center gap-2"
                >
                  <PenTool size={16} />
                  Open Answer Studio
                </button>
                {/* Same gate DashboardView uses for its Job Matches nav item,
                    so a Scholarship user is never offered a tab that hides
                    itself the moment it opens. */}
                {onLaunchJobMatches && popupAppConfig.features.jobMatches && (
                  <button
                    onClick={onLaunchJobMatches}
                    className="w-full bg-white/90 text-onextap-dark border border-onextap-primary/20 py-3 px-4 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-white hover:border-onextap-primary/35 transition-all dark:bg-onextap-night-card dark:text-[#E8EFD8] dark:border-[rgba(200,216,168,0.15)]"
                  >
                    <Briefcase size={16} className="shrink-0" />
                    Find matching jobs
                  </button>
                )}
                <button
                  onClick={handleAutofill}
                  disabled={autofillDisabled}
                  title={autofillDisabled ? 'Select at least one section to fill.' : undefined}
                  className="w-full bg-white/90 text-onextap-dark border border-onextap-primary/20 py-3.5 px-4 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-white hover:border-onextap-primary/35 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <Clipboard size={18} className="shrink-0" />
                  {autofillButtonLabel}
                </button>
              </div>
            )}
            {popupTab === 'answers' && (
              <div className="space-y-3">
                {savedAnswers.length === 0 ? (
                  <p className="text-sm text-onextap-dark/60 text-center py-6">No saved answers yet. Open Answer Studio to add some.</p>
                ) : (
                  savedAnswers.map((item) => (
                    <div key={item.id} className="rounded-xl border border-onextap-primary/15 bg-white/80 p-3 dark:bg-onextap-night-card">
                      <p className="text-sm font-semibold text-onextap-dark dark:text-[#E8EFD8]">{item.question}</p>
                      <p className="text-xs text-onextap-dark/60 mt-1 line-clamp-3 dark:text-[#9AB07A]">{item.answer}</p>
                    </div>
                  ))
                )}
                <button type="button" onClick={onLaunchAnswerStudio} className="w-full text-sm font-medium text-onextap-primary py-2">Manage in Answer Studio</button>
              </div>
            )}
            {popupTab === 'cover' && (
              <CoverLetterPanel
                key={coverPanelKey}
                showToast={showPopupToast}
                user={popupUser}
                compact
                applicationType={applicationType}
                documentLabel={popupAppConfig.coverLetterLabel}
              />
            )}
          </div>
        ) : (
          /* --- Not signed in: Welcome landing - Dribbble-inspired --- */
          <div className="w-full space-y-6 max-w-[340px]">
            <div className="text-center space-y-4 opacity-0 animate-fade-up animate-delay-200" style={{ animationFillMode: 'forwards' }}>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/70 backdrop-blur-sm border border-onextap-primary/10 shadow-sm">
                <Sparkles size={14} className="shrink-0 text-onextap-primary" />
                <span className="text-onextap-dark/80 text-sm font-medium">Job applications, simplified</span>
              </div>
              <h1 className="font-bold text-3xl text-onextap-dark tracking-tight leading-tight">
                Welcome to<br />Onextap
              </h1>
              <p className="text-sm text-onextap-dark/60 max-w-[280px] mx-auto leading-relaxed">
                Sync your profile and autofill job forms in one click. One less thing to worry about.
              </p>
            </div>

            <div className="space-y-4 opacity-0 animate-scale-in animate-delay-400" style={{ animationFillMode: 'forwards' }}>
              <button 
                onClick={onLaunchDashboard}
                className="w-full group relative overflow-hidden bg-onextap-dark text-white py-4 px-5 rounded-2xl text-sm font-semibold flex items-center justify-center gap-3 shadow-lg shadow-onextap-dark/20 hover:shadow-xl hover:shadow-onextap-dark/25 hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-300"
              >
                <ExternalLink size={20} className="shrink-0 group-hover:scale-110 transition-transform duration-300" />
                Open Dashboard
                <ArrowRight size={18} className="shrink-0 group-hover:translate-x-1 transition-transform duration-300" />
              </button>

              <div className="relative overflow-hidden rounded-2xl bg-white/80 backdrop-blur-sm border border-onextap-primary/15 shadow-md hover:shadow-lg transition-all duration-300 group/card">
                <div className="absolute inset-0 bg-gradient-to-br from-onextap-primary/5 to-onextap-cream/30 opacity-0 group-hover/card:opacity-100 transition-opacity duration-300" />
                <div className="relative p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2.5 rounded-xl bg-onextap-primary/15 group-hover/card:bg-onextap-primary/20 transition-colors">
                      <Clipboard size={18} className="text-onextap-primary-dark" />
                    </div>
                    <h3 className="font-bold text-onextap-dark text-base">Quick Autofill</h3>
                  </div>
                  <p className="text-sm text-onextap-dark/60 mb-4 leading-relaxed">
                    Fill job application forms using your saved profile.
                  </p>
                  <button 
                    onClick={handleAutofill} 
                    className="w-full bg-onextap-dark text-white py-3 rounded-xl font-semibold text-sm shadow-sm hover:bg-onextap-dark/90 hover:shadow-md active:scale-[0.98] transition-all duration-300"
                  >
                    {status}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <Toast
        message={popupToast.message}
        type={popupToast.type}
        isVisible={popupToast.visible}
        onDismiss={() => setPopupToast((t) => ({ ...t, visible: false }))}
      />
    </div>
  );
};

export default PopupView;
