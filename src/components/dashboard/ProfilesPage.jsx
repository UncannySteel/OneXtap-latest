import React, { useState, useEffect, useRef } from 'react';
import { Activity, Award, Briefcase, Code, ExternalLink, FileText, Flag, GraduationCap, ListPlus, MapPin, Plus, Save, Trash2, UploadCloud, User } from 'lucide-react';
import { COUNTRIES, GENDERS } from '../../../extension/constants';
import { getExtensionId } from '../../extensionClient';
import {
  DEFAULT_PROFILE,
  RACES,
  VETERAN_STATUS,
  emptyCertificate,
  emptyCustomField,
  emptyEducation,
  emptyExperience,
} from '../../profileDefaults';
import { getActiveLegacyProfile, loadProfileStore, saveLegacyUserProfile } from '../../profileStore';
import { parseResumeFile, RESUME_ACCEPT_ATTR, MAX_RESUME_LABEL } from '../../resumeParse';
import { mergeParsedResumeIntoProfile } from '../../resumeToProfile';
import { saveParsedResume } from '../../resumeStore';
import ProfileSwitcher from '../shared/ProfileSwitcher';
import { useFileDrop } from '../shared/useFileDrop';
import { log as baseLog } from '../../logger';

const log = baseLog.child('ui');

// ------------------------------------------------------------------
// Styling
// ------------------------------------------------------------------
//
// ═══ WHY THESE ARE CONSTANTS ═══
//
// This page had forty-six form controls, each carrying its own hand-typed
// class string, each saying `bg-white` and none of them saying what colour the
// TEXT should be. Under `html.dark` (src/index.css sets `color: #E8EFD8` on
// the body, and DashboardView toggles the class) every one of them inherited
// pale green onto a white field: measured contrast 1.18:1, where WCAG AA wants
// 4.5:1. The labels were fine — they carry `text-onextap-dark` — so the page
// looked styled and the values were simply invisible.
//
// Forty-six copies is why it happened and why it would happen again, so the
// strings live here once, in the same shape JobMatchesPage already uses. A
// control that does not use one of these constants is a bug waiting for the
// next person who turns dark mode on.

/**
 * Text input / select, WITHOUT a width.
 *
 * Widthless on purpose. Baking `w-full` in and appending `w-1/3` at a call
 * site does not narrow anything: both classes exist, and which one wins is
 * decided by their order in Tailwind's output, not by the order they appear
 * in the attribute. The link-type select came out full width and crushed the
 * URL box beside it to eighteen pixels. Every call site states its own width.
 */
const FIELD_BASE = 'p-2 border border-onextap-primary/30 rounded-lg bg-white text-onextap-dark focus:outline-none focus:border-onextap-primary dark:bg-onextap-night-card dark:text-[#E8EFD8] dark:border-onextap-primary-light/25 dark:focus:border-onextap-primary-light/50 dark:placeholder:text-[#9AB07A]/60';

/** The common case: a field filling its grid cell. */
const FIELD = `w-full ${FIELD_BASE}`;

/** The same field inside a repeated row, where everything is a size down. */
const FIELD_SM = `${FIELD} text-sm`;

/** Multi-line variant. */
const TEXTAREA = `${FIELD_SM} min-h-[80px]`;

/** Label above a top-level field. */
const LABEL = 'block text-sm font-medium text-onextap-dark dark:text-[#E8EFD8] mb-1';

/** Label above a field inside a repeated row. */
const LABEL_SM = 'block text-xs font-medium text-onextap-dark dark:text-[#E8EFD8] mb-1';

/** Section wrapper: a rule above, and the section's own vertical rhythm. */
const SECTION = 'pt-4 border-t border-onextap-primary/20 dark:border-onextap-primary-light/20';

/** Section heading with its icon. */
const HEADING = 'text-sm font-bold text-onextap-dark dark:text-[#E8EFD8] mb-4 flex items-center gap-2';

/** The tinted card one education / experience / certificate row sits in. */
const ROW_CARD = 'p-4 bg-onextap-primary/5 rounded-xl border border-onextap-primary/20 dark:bg-white/[0.04] dark:border-onextap-primary-light/20';

/** "Add education" and friends. */
const ADD_BTN = 'mt-4 text-sm text-onextap-primary dark:text-onextap-primary-light font-medium flex items-center gap-1 hover:underline';

/** Remove-this-row control. */
const TRASH_BTN = 'text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300';

/** Filled action button. */
const BTN_PRIMARY = 'bg-onextap-dark text-white rounded-xl flex items-center gap-2 hover:bg-onextap-dark/90 shadow-lg shadow-onextap-dark/20 transition-all duration-200 font-semibold dark:bg-onextap-primary dark:hover:bg-onextap-primary-dark dark:shadow-[0_6px_20px_rgba(0,0,0,0.4)]';

/**
 * "My Profiles" tab — the full profile editor: personal details, address,
 * education, experience, skills, URLs, custom fields, and demographics.
 *
 * Owns resume upload: `parseResumeFile` handles the transport (base64, the
 * GET /api/me preflight, the PARSE_RESUME round trip),
 * `mergeParsedResumeIntoProfile` translates the parser's vocabulary into the
 * editor's, and the result is merged over the existing profile rather than
 * replacing it. That translation is NOT inlined here on purpose — see the
 * header of src/resumeToProfile.js for what it fixes and why it is pure.
 *
 * The parse result is also filed in the resume library, but that write is
 * best-effort — losing the library copy must never cost the user the profile
 * merge — and it is handed the RAW parser output, never the normalised
 * profile, because the corpus builder indexes the parser's own field names.
 *
 * Saving writes through profileStore and then pushes the profile to the
 * extension with ONEXTAP_SYNC_DATA; a failed push is reported but not fatal.
 *
 * @param {object} props
 * @param {(message: string, type?: 'success'|'error'|'loading') => void} props.showToast
 */
const ProfilesPage = ({ showToast }) => {
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [status, setStatus] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  // Separate from `status`, which renders as the Save button's label. An
  // upload failure is a sentence — "That file is 3.0 MB. The limit is 2 MB —
  // export a smaller PDF…" — and putting one in a button both wrecks the
  // layout and puts it nowhere near the control it is about. Drag-and-drop
  // makes a rejected file far easier to attempt, so these now get their own
  // line inside the upload panel.
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);
  const skillInputRef = useRef(null);

  useEffect(() => {
    const loadData = async () => {
      await loadProfileStore();
      const saved = await getActiveLegacyProfile();
      if (saved) setProfile(hydrate(saved));
    };
    loadData();
  }, []);

  const handleSave = async () => {
    setStatus('Saving...');

    try {
      await saveLegacyUserProfile(profile);

      // Broadcast to Extension (Direct Message) — popup reads from chrome.storage.local
      let syncOk = false;
      const extId = getExtensionId();
      if (window.chrome && chrome.runtime && chrome.runtime.sendMessage) {
        if (extId) {
          try {
            syncOk = await new Promise((resolve) => {
              chrome.runtime.sendMessage(extId, {
                type: "ONEXTAP_SYNC_DATA",
                payload: profile
              }, (response) => {
                if (chrome.runtime.lastError) {
                  log.warn("Onextap: Extension sync failed —", chrome.runtime.lastError.message);
                  resolve(false);
                } else {
                  log.info("Extension synced:", response);
                  resolve(response?.success === true);
                }
              });
            });
          } catch (e) {
            log.warn("Onextap: Extension sync error", e);
          }
        } else {
          log.warn("Onextap: Extension ID not available, skipping extension sync");
        }
      }

      setStatus(syncOk ? 'Saved & Synced!' : 'Saved');
      showToast?.(syncOk ? 'Saved successfully' : 'Saved (sync to extension failed)', 'success');
    } catch (error) {
      log.error("Save failed:", error);
      setStatus('Error saving');
      showToast?.('Error saving', 'error');
    }

    setTimeout(() => setStatus(''), 4000);
  };

  // --- RESUME PARSING LOGIC ---
  //
  // The TRANSPORT lives in src/resumeParse.js and the FIELD TRANSLATION in
  // src/resumeToProfile.js. What is left here is the part that is genuinely
  // about this screen: what the user sees while it runs and what they are
  // told when it does not.
  /**
   * The upload itself, shared by the file picker and the drop zone.
   *
   * How the file arrived stays with the caller — the picker has to clear its
   * input — because doing that in the wrong place is invisible until someone
   * uses the other entry point. Mirrors the same split in ResumeSwitcher.
   *
   * @param {File} file
   */
  const startUpload = async (file) => {
    if (!file) return;

    setUploadError('');
    setIsParsing(true);
    setStatus('Parsing resume...');

    try {
      const result = await parseResumeFile(file);
      if (!result.ok) {
        setUploadError(result.error.message);
        setStatus('');
        setIsParsing(false);
        return;
      }

      setProfile((prev) => mergeParsedResumeIntoProfile(prev, result.parsed));

      // Keep a copy in the resume library so the popup shares this one upload.
      // STRICTLY non-blocking: a full store (or any other write failure) must
      // never cost the user the profile merge that just succeeded above, so it
      // downgrades to a warning rather than an error path.
      let storeWarning = '';
      try {
        // Adds it, or selects the copy already stored for these exact bytes:
        // re-uploading the same file is a normal thing to do, and it must not
        // fail on the duplicate-name rule and show a warning for what the user
        // would read as a successful upload. ResumeSwitcher needs the identical
        // rule, so it lives in resumeStore rather than in both screens.
        //
        // `result` goes in UNCHANGED — the raw parser shape, not the merged
        // profile. buildCorpus() reads the parser's own key names and its
        // sourceSpan offsets are computed against result.cvText.
        await saveParsedResume(result);
      } catch (e) {
        storeWarning = e?.message || 'Could not save this resume to your library.';
        log.warn('Onextap: resume library write failed; profile merge kept', { errName: e?.name });
      }

      setStatus(storeWarning ? 'Resume parsed (not saved to library)' : 'Resume parsed!');
      setIsParsing(false);
      showToast?.(
        storeWarning ? `Resume parsed. ${storeWarning}` : 'Resume parsed — review the fields, then Save Changes',
        storeWarning ? 'error' : 'success',
      );
      setTimeout(() => setStatus(''), 3000);
    } catch (error) {
      log.error("Onextap: File upload error:", error);
      setUploadError(error.message || 'Failed to read file. Please try again.');
      setStatus('');
      setIsParsing(false);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target?.files?.[0];
    // Reset the input first: picking the SAME file twice fires no change event
    // otherwise, which reads to the user as the upload button being dead. This
    // mirrors ResumeSwitcher.handleUpload — the two pickers must behave alike.
    if (event.target) event.target.value = '';
    await startUpload(file);
  };

  /**
   * Files dropped onto the upload panel.
   * @param {File[]} files Never empty.
   */
  const handleDroppedFiles = (files) => {
    setUploadError('');
    if (files.length > 1) {
      setUploadError('Drop one resume at a time.');
      return;
    }
    startUpload(files[0]);
  };

  const { isDragging, dropProps } = useFileDrop({
    onDrop: handleDroppedFiles,
    disabled: isParsing,
  });

  // A new drag is a retry, so the last failure stops applying the moment one
  // starts — otherwise the panel reads "Drop to upload" over a red sentence
  // about the file before it. Mirrors the same effect in ResumeSwitcher.
  useEffect(() => {
    if (isDragging) setUploadError('');
  }, [isDragging]);


  // Array Helpers (support undefined sections)
  const updateItem = (section, index, field, value) => {
    const arr = profile[section] || [];
    const newSection = [...arr];
    if (newSection[index]) {
      newSection[index] = { ...newSection[index], [field]: value };
      setProfile({ ...profile, [section]: newSection });
    }
  };
  const addItem = (section, emptyItem) => {
    const arr = profile[section] || [];
    setProfile({ ...profile, [section]: [...arr, emptyItem] });
  };
  const removeItem = (section, index) => {
    const arr = profile[section] || [];
    setProfile({ ...profile, [section]: arr.filter((_, i) => i !== index) });
  };
  const toggleRace = (race) => {
    const current = profile.race || [];
    if (current.includes(race)) {
      setProfile({ ...profile, race: current.filter(r => r !== race) });
    } else {
      setProfile({ ...profile, race: [...current, race] });
    }
  };
  /**
   * Basic Info's country picker. Sets the country, the dial code beside the
   * phone box, and — conditionally — the address country.
   *
   * ═══ WHY IT REACHES INTO THE ADDRESS ═══
   *
   * There are two countries in this profile and both start at the same
   * DEFAULT_PROFILE value. Autofill answers an address-scoped "Country" from
   * the address one, so a user who set this picker to India and never scrolled
   * down to Address kept autofilling "United States" — a default they never
   * chose, outranking the country they did.
   *
   * The mirror only happens while the two agree, i.e. while the address is
   * still following this picker. Once a user sets a different address country
   * deliberately — a mailing address abroad is a real thing, and
   * resumeToProfile.js declines to collapse the two for the same reason —
   * this stops touching it.
   */
  const handleCountryChange = (e) => {
    const selectedCountry = COUNTRIES.find(c => c.name === e.target.value);
    const addr = profile.address || {};
    const addressWasFollowing = !addr.country || addr.country === profile.country;
    setProfile({
      ...profile,
      country: e.target.value,
      countryCode: selectedCountry ? selectedCountry.dial_code : profile.countryCode,
      address: addressWasFollowing
        ? { ...DEFAULT_PROFILE.address, ...addr, country: e.target.value }
        : profile.address,
    });
  };

  // URL Helpers
  const updateUrl = (index, val) => {
    const u = profile.urls || [];
    const newUrls = [...u];
    if (newUrls[index]) { newUrls[index] = { ...newUrls[index], value: val }; setProfile({ ...profile, urls: newUrls }); }
  };
  const addUrlSlot = () => setProfile({ ...profile, urls: [...(profile.urls || []), { type: 'Other', value: '' }] });
  const updateUrlType = (i, t) => { const u = profile.urls || []; const next = [...u]; if (next[i]) { next[i] = { ...next[i], type: t }; setProfile({ ...profile, urls: next }); } };
  const removeUrl = (i) => setProfile({ ...profile, urls: (profile.urls || []).filter((_, idx) => idx !== i) });

  const updateAddress = (field, value) => setProfile({ ...profile, address: { ...DEFAULT_PROFILE.address, ...(profile.address || {}), [field]: value } });
  const updateCurrentJob = (field, value) => setProfile({ ...profile, currentJob: { ...DEFAULT_PROFILE.currentJob, ...(profile.currentJob || {}), [field]: value } });
  const addSkill = (skill) => {
    const s = (skill || '').trim();
    if (!s || (profile.skills || []).some(x => x.toLowerCase() === s.toLowerCase())) return;
    setProfile({ ...profile, skills: [...(profile.skills || []), s] });
  };
  const removeSkill = (skill) => setProfile({ ...profile, skills: (profile.skills || []).filter(x => x !== skill) });

  const reloadActiveProfile = async () => {
    const saved = await getActiveLegacyProfile();
    if (saved) setProfile(hydrate(saved));
  };

  return (
    <div className="animate-fade-in max-w-4xl mx-auto space-y-4">
      <ProfileSwitcher onProfileChange={reloadActiveProfile} />
      <div className="bg-white/80 backdrop-blur-sm rounded-3xl border border-onextap-primary/15 p-8 shadow-lg shadow-onextap-dark/5 relative overflow-hidden dark:bg-onextap-night-card dark:border-onextap-primary-light/20 dark:shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
        {/* Decorative gradient */}
        <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-onextap-primary/10 to-transparent rounded-full blur-2xl dark:from-onextap-primary/30" />

        <div className="relative z-10">
          <div className="flex justify-between items-center mb-8 pb-6 border-b border-onextap-primary/15 dark:border-onextap-primary-light/20">
            <div>
              <h2 className="font-bold text-2xl text-onextap-dark dark:text-[#E8EFD8] tracking-tight mb-1">My Profile</h2>
              <p className="text-onextap-dark/60 dark:text-[#9AB07A] text-sm">Manage your personal information for autofill</p>
            </div>
            <button onClick={handleSave} className={`${BTN_PRIMARY} px-6 py-3`}>
              <Save size={18} /> {status || 'Save Changes'}
            </button>
          </div>

      <div className="max-h-[calc(100vh-14rem)] overflow-y-auto pr-2 space-y-8">
        {/* RESUME UPLOAD */}
        <div
          {...dropProps}
          className={`p-5 rounded-2xl border transition-colors ${
            isDragging
              ? 'border-dashed border-onextap-primary bg-onextap-primary/15 dark:border-onextap-primary-light dark:bg-onextap-primary/30'
              : 'border-onextap-primary/20 bg-gradient-to-r from-onextap-primary/10 to-onextap-primary/5 dark:border-onextap-primary-light/20 dark:from-onextap-primary/25 dark:to-onextap-primary/10'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white rounded-xl shadow-sm dark:bg-white/[0.08]">
                {isDragging
                  ? <UploadCloud className="text-onextap-primary dark:text-onextap-primary-light" size={24} />
                  : <FileText className="text-onextap-primary dark:text-onextap-primary-light" size={24} />}
              </div>
              <div>
                <h4 className="font-bold text-onextap-dark dark:text-[#E8EFD8]">{isDragging ? 'Drop to upload' : 'Upload Resume'}</h4>
                <p className="text-sm text-onextap-dark/60 dark:text-[#9AB07A]">
                  Auto-fill your profile from PDF or Image — drop one here, up to {MAX_RESUME_LABEL}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept={RESUME_ACCEPT_ATTR} onChange={handleFileUpload} className="hidden" id="resume-upload" />
              <label htmlFor="resume-upload" className={`px-5 py-2.5 rounded-xl font-semibold text-sm cursor-pointer transition-all duration-200 flex items-center gap-2 shadow-md ${isParsing ? 'bg-onextap-dark/40 text-white dark:bg-onextap-primary/40' : 'bg-onextap-dark text-white hover:bg-onextap-dark/90 hover:shadow-lg dark:bg-onextap-primary dark:hover:bg-onextap-primary-dark'}`}>
                {isParsing ? <><Activity className="animate-spin" size={16} /> Parsing...</> : <><FileText size={16} /> Upload Resume</>}
              </label>
            </div>
          </div>
          {uploadError && <p className="mt-3 text-sm text-red-600 dark:text-red-300">{uploadError}</p>}
        </div>

        {/* BASIC INFO */}
        <div>
          <h4 className={HEADING}><User size={16} /> Basic Info</h4>
          <div className="grid grid-cols-6 gap-6">
            <div className="col-span-3">
              <label className={LABEL}>First Name</label>
              <input className={FIELD} value={profile.firstName} onChange={e => setProfile({...profile, firstName: e.target.value})} />
            </div>
            <div className="col-span-3">
              <label className={LABEL}>Last Name</label>
              <input className={FIELD} value={profile.lastName} onChange={e => setProfile({...profile, lastName: e.target.value})} />
            </div>
            <div className="col-span-6">
              <label className={LABEL}>Email</label>
              <input type="email" className={FIELD} value={profile.email} onChange={e => setProfile({...profile, email: e.target.value})} />
            </div>
            <div className="col-span-3">
              <label className={LABEL}>Country</label>
              <select className={FIELD} value={profile.country} onChange={handleCountryChange}>
                {COUNTRIES.map(c => <option key={c.code} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div className="col-span-3">
              <label className={LABEL}>Phone ({profile.countryCode})</label>
              <div className="flex gap-2">
                <div className="p-2 bg-onextap-primary/10 border border-onextap-primary/30 rounded-lg text-onextap-dark font-medium dark:bg-onextap-primary/25 dark:border-onextap-primary-light/25 dark:text-[#E8EFD8]">{profile.countryCode}</div>
                <input className={`${FIELD_BASE} flex-1`} value={profile.phone} onChange={e => setProfile({...profile, phone: e.target.value})} />
              </div>
            </div>
            <div className="col-span-3">
              <label className={LABEL}>Birth Date</label>
              <input type="date" className={FIELD} value={profile.birthDate} onChange={e => setProfile({...profile, birthDate: e.target.value})} />
            </div>
            <div className="col-span-3">
              <label className={LABEL}>Gender</label>
              <select className={FIELD} value={profile.gender} onChange={e => setProfile({...profile, gender: e.target.value})}>
                <option value="">Select...</option>
                {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* LINKS */}
        <div className={SECTION}>
          <label className={HEADING}><ExternalLink size={16} /> Links</label>
          <div className="space-y-3">
            {(profile.urls || []).map((urlItem, index) => (
              <div key={index} className="flex gap-2">
                <select className={`${FIELD_BASE} w-1/3`} value={urlItem.type} onChange={(e) => updateUrlType(index, e.target.value)}>
                  <option value="LinkedIn">LinkedIn</option>
                  <option value="GitHub">GitHub</option>
                  <option value="Portfolio">Portfolio</option>
                  <option value="Other">Other</option>
                </select>
                <input className={`${FIELD_BASE} flex-1`} value={urlItem.value} onChange={(e) => updateUrl(index, e.target.value)} placeholder="https://..." />
                <button type="button" onClick={() => removeUrl(index)} className={`${TRASH_BTN} px-2`}><Trash2 size={18} /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addUrlSlot} className={ADD_BTN}><Plus size={16} /> Add link</button>
        </div>

        {/* ADDRESS */}
        <div className={SECTION}>
          <h4 className={HEADING}><MapPin size={16} /> Address</h4>
          <div className="grid grid-cols-6 gap-6">
            <div className="col-span-6">
              <label className={LABEL}>Address Line 1</label>
              <input className={FIELD} value={profile.address?.addressLine1 || ''} onChange={e => updateAddress('addressLine1', e.target.value)} />
            </div>
            <div className="col-span-6">
              <label className={LABEL}>Address Line 2</label>
              <input className={FIELD} value={profile.address?.addressLine2 || ''} onChange={e => updateAddress('addressLine2', e.target.value)} />
            </div>
            <div className="col-span-6">
              <label className={LABEL}>Address Line 3</label>
              <input className={FIELD} value={profile.address?.addressLine3 || ''} onChange={e => updateAddress('addressLine3', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className={LABEL}>City</label>
              <input className={FIELD} value={profile.address?.city || ''} onChange={e => updateAddress('city', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className={LABEL}>State</label>
              <input className={FIELD} value={profile.address?.state || ''} onChange={e => updateAddress('state', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className={LABEL}>Postal Code</label>
              <input className={FIELD} value={profile.address?.postalCode || ''} onChange={e => updateAddress('postalCode', e.target.value)} />
            </div>
            <div className="col-span-6">
              <label className={LABEL}>Country</label>
              <select className={FIELD} value={profile.address?.country || ''} onChange={e => updateAddress('country', e.target.value)}>
                {COUNTRIES.map(c => <option key={c.code} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* EDUCATION */}
        <div className={SECTION}>
          <h4 className={HEADING}><GraduationCap size={16} /> Education</h4>
          <div className="space-y-6">
            {(profile.education || []).map((ed, idx) => (
              <div key={idx} className={`${ROW_CARD} space-y-4 relative`}>
                <button type="button" onClick={() => removeItem('education', idx)} className={`${TRASH_BTN} absolute top-3 right-3`}><Trash2 size={16} /></button>
                <div className="grid grid-cols-6 gap-4">
                  <div className="col-span-6"><label className={LABEL_SM}>School</label><input className={FIELD_SM} value={ed.school || ''} onChange={e => updateItem('education', idx, 'school', e.target.value)} placeholder="School name" /></div>
                  <div className="col-span-3"><label className={LABEL_SM}>Degree</label><input className={FIELD_SM} value={ed.degree || ''} onChange={e => updateItem('education', idx, 'degree', e.target.value)} placeholder="e.g. B.S." /></div>
                  <div className="col-span-3"><label className={LABEL_SM}>Field</label><input className={FIELD_SM} value={ed.field || ''} onChange={e => updateItem('education', idx, 'field', e.target.value)} placeholder="e.g. Computer Science" /></div>
                  <div className="col-span-2"><label className={LABEL_SM}>Start</label><input className={FIELD_SM} value={ed.start || ''} onChange={e => updateItem('education', idx, 'start', e.target.value)} placeholder="YYYY" /></div>
                  <div className="col-span-2"><label className={LABEL_SM}>End</label><input className={FIELD_SM} value={ed.end || ''} onChange={e => updateItem('education', idx, 'end', e.target.value)} placeholder="YYYY" /></div>
                  <div className="col-span-2"><label className={LABEL_SM}>GPA / CGPA</label><input className={FIELD_SM} value={ed.cgpa || ''} onChange={e => updateItem('education', idx, 'cgpa', e.target.value)} placeholder="e.g. 3.8" /></div>
                  <div className="col-span-3"><label className={LABEL_SM}>Specialization</label><input className={FIELD_SM} value={ed.specialization || ''} onChange={e => updateItem('education', idx, 'specialization', e.target.value)} /></div>
                  <div className="col-span-3"><label className={LABEL_SM}>Minor</label><input className={FIELD_SM} value={ed.minor || ''} onChange={e => updateItem('education', idx, 'minor', e.target.value)} /></div>
                  <div className="col-span-2"><label className={LABEL_SM}>Graduation Year</label><input className={FIELD_SM} value={ed.graduationYear || ''} onChange={e => updateItem('education', idx, 'graduationYear', e.target.value)} placeholder="YYYY" /></div>
                  <div className="col-span-2"><label className={LABEL_SM}>Enrollment Year</label><input className={FIELD_SM} value={ed.enrollmentYear || ''} onChange={e => updateItem('education', idx, 'enrollmentYear', e.target.value)} placeholder="YYYY" /></div>
                  <div className="col-span-2"><label className={LABEL_SM}>Expected Graduation</label><input className={FIELD_SM} value={ed.expectedGraduation || ''} onChange={e => updateItem('education', idx, 'expectedGraduation', e.target.value)} placeholder="YYYY" /></div>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addItem('education', emptyEducation())} className={ADD_BTN}><Plus size={16} /> Add education</button>
        </div>

        {/* EXPERIENCE */}
        <div className={SECTION}>
          <h4 className={HEADING}><Briefcase size={16} /> Experience</h4>
          <div className="space-y-6">
            {(profile.experience || []).map((ex, idx) => (
              <div key={idx} className={`${ROW_CARD} space-y-4 relative`}>
                <button type="button" onClick={() => removeItem('experience', idx)} className={`${TRASH_BTN} absolute top-3 right-3`}><Trash2 size={16} /></button>
                <div className="grid grid-cols-6 gap-4">
                  <div className="col-span-3"><label className={LABEL_SM}>Company</label><input className={FIELD_SM} value={ex.company || ''} onChange={e => updateItem('experience', idx, 'company', e.target.value)} /></div>
                  <div className="col-span-3"><label className={LABEL_SM}>Title</label><input className={FIELD_SM} value={ex.title || ''} onChange={e => updateItem('experience', idx, 'title', e.target.value)} /></div>
                  <div className="col-span-2"><label className={LABEL_SM}>Start</label><input className={FIELD_SM} value={ex.start || ''} onChange={e => updateItem('experience', idx, 'start', e.target.value)} placeholder="YYYY-MM" /></div>
                  <div className="col-span-2"><label className={LABEL_SM}>End</label><input className={FIELD_SM} value={ex.end || ''} onChange={e => updateItem('experience', idx, 'end', e.target.value)} placeholder="YYYY-MM or Present" /></div>
                  <div className="col-span-2 flex items-end pb-1"><label className="flex items-center gap-2 cursor-pointer text-sm text-onextap-dark dark:text-[#E8EFD8]"><input type="checkbox" className="accent-onextap-primary dark:accent-onextap-primary-light" checked={!!ex.isCurrent} onChange={e => updateItem('experience', idx, 'isCurrent', e.target.checked)} /> Current</label></div>
                  <div className="col-span-6"><label className={LABEL_SM}>Description</label><textarea className={TEXTAREA} value={ex.description || ''} onChange={e => updateItem('experience', idx, 'description', e.target.value)} placeholder="Responsibilities, achievements..." /></div>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addItem('experience', emptyExperience())} className={ADD_BTN}><Plus size={16} /> Add experience</button>
        </div>

        {/* CERTIFICATES */}
        <div className={SECTION}>
          <h4 className={HEADING}><Award size={16} /> Certificates</h4>
          <div className="space-y-4">
            {(profile.certificates || []).map((cert, idx) => (
              <div key={idx} className={`${ROW_CARD} flex gap-4 items-start`}>
                <div className="flex-1 grid grid-cols-4 gap-4">
                  <div><label className={LABEL_SM}>Name</label><input className={FIELD_SM} value={cert.name || ''} onChange={e => updateItem('certificates', idx, 'name', e.target.value)} placeholder="Certification name" /></div>
                  <div><label className={LABEL_SM}>Issuer</label><input className={FIELD_SM} value={cert.issuer || ''} onChange={e => updateItem('certificates', idx, 'issuer', e.target.value)} /></div>
                  <div><label className={LABEL_SM}>Date</label><input className={FIELD_SM} value={cert.date || ''} onChange={e => updateItem('certificates', idx, 'date', e.target.value)} placeholder="e.g. March 2023" /></div>
                  <div><label className={LABEL_SM}>Expiry</label><input className={FIELD_SM} value={cert.expiry || ''} onChange={e => updateItem('certificates', idx, 'expiry', e.target.value)} placeholder="e.g. March 2026" /></div>
                </div>
                <button type="button" onClick={() => removeItem('certificates', idx)} className={`${TRASH_BTN} mt-6`}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addItem('certificates', emptyCertificate())} className={ADD_BTN}><Plus size={16} /> Add certificate</button>
        </div>

        {/* SKILLS */}
        <div className={SECTION}>
          <h4 className={HEADING}><Code size={16} /> Skills</h4>
          <div className="flex flex-wrap gap-2 mb-3">
            {(profile.skills || []).map(skill => (
              <span key={skill} className="inline-flex items-center gap-1 px-3 py-1 bg-onextap-primary/10 text-onextap-dark rounded-full text-sm dark:bg-onextap-primary/25 dark:text-[#E8EFD8]">
                {skill}
                <button type="button" onClick={() => removeSkill(skill)} className="hover:text-red-600 dark:hover:text-red-300">&times;</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input ref={skillInputRef} className={`${FIELD_BASE} flex-1 text-sm`} placeholder="Add a skill (e.g. JavaScript)" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(e.target.value); e.target.value = ''; } }} />
            <button type="button" onClick={() => { const el = skillInputRef.current; if (el?.value) { addSkill(el.value); el.value = ''; } }} className="px-4 py-2 bg-onextap-primary text-white rounded-lg text-sm font-medium hover:bg-onextap-primary-dark dark:bg-onextap-primary-light dark:hover:bg-onextap-primary">Add</button>
          </div>
        </div>

        {/* CURRENT JOB */}
        <div className={SECTION}>
          <h4 className={HEADING}><Briefcase size={16} /> Current Job</h4>
          <div className="grid grid-cols-6 gap-6">
            <div className="col-span-3">
              <label className={LABEL}>Company</label>
              <input className={FIELD} value={profile.currentJob?.company || ''} onChange={e => updateCurrentJob('company', e.target.value)} />
            </div>
            <div className="col-span-3">
              <label className={LABEL}>Title</label>
              <input className={FIELD} value={profile.currentJob?.title || ''} onChange={e => updateCurrentJob('title', e.target.value)} />
            </div>
            <div className="col-span-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="accent-onextap-primary dark:accent-onextap-primary-light" checked={!!profile.currentJob?.isCurrent} onChange={e => updateCurrentJob('isCurrent', e.target.checked)} />
                <span className="text-sm font-medium text-onextap-dark dark:text-[#E8EFD8]">Currently employed here</span>
              </label>
            </div>
          </div>
        </div>

        {/* COMPENSATION & AVAILABILITY */}
        <div className={SECTION}>
          <h4 className={HEADING}><Activity size={16} /> Compensation & Availability</h4>
          <div className="grid grid-cols-6 gap-6">
            <div className="col-span-2">
              <label className={LABEL}>Current Salary</label>
              <input className={FIELD} value={profile.currentSalary} onChange={e => setProfile({...profile, currentSalary: e.target.value})} placeholder="e.g. 80,000" />
            </div>
            <div className="col-span-2">
              <label className={LABEL}>Pay Expectation</label>
              <input className={FIELD} value={profile.payExpectation} onChange={e => setProfile({...profile, payExpectation: e.target.value})} placeholder="e.g. 90,000" />
            </div>
            <div className="col-span-2">
              <label className={LABEL}>Notice Period</label>
              <input className={FIELD} value={profile.noticePeriod} onChange={e => setProfile({...profile, noticePeriod: e.target.value})} placeholder="e.g. 2 weeks" />
            </div>
          </div>
        </div>

        {/* EEO / DEMOGRAPHICS */}
        <div className={SECTION}>
          <h4 className={HEADING}><Flag size={16} /> EEO / Demographics</h4>
          <div className="grid grid-cols-6 gap-6">
            <div className="col-span-6">
              <label className={`${LABEL} mb-2`}>Race</label>
              <div className="flex flex-wrap gap-2">
                {(RACES || []).map(race => (
                  <button type="button" key={race} onClick={() => toggleRace(race)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${(profile.race || []).includes(race) ? 'bg-onextap-primary text-white border-onextap-primary dark:bg-onextap-primary-light dark:border-onextap-primary-light' : 'bg-white border-onextap-primary/30 text-onextap-dark hover:border-onextap-primary dark:bg-white/[0.04] dark:border-onextap-primary-light/25 dark:text-[#E8EFD8] dark:hover:border-onextap-primary-light'}`}>{race}</button>
                ))}
              </div>
            </div>
            <div className="col-span-3">
              <label className={LABEL}>Ethnicity</label>
              <input className={FIELD} value={profile.ethnicity} onChange={e => setProfile({...profile, ethnicity: e.target.value})} placeholder="Optional" />
            </div>
            <div className="col-span-3">
              <label className={LABEL}>Veteran Status</label>
              <select className={FIELD} value={profile.veteran} onChange={e => setProfile({...profile, veteran: e.target.value})}>
                <option value="">Select...</option>
                {(VETERAN_STATUS || []).map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="col-span-6">
              <label className={LABEL}>Disability</label>
              <input className={FIELD} value={profile.disability} onChange={e => setProfile({...profile, disability: e.target.value})} placeholder="Optional — decline to identify or describe" />
            </div>
          </div>
        </div>

        {/* CUSTOM FIELDS */}
        {/*
          Anything the fixed schema above does not have a box for. The label is
          not decoration: it is what the autofiller matches a form field
          against (see the customFields block at the end of buildIntents() in
          public/content.js), which is why the hint asks for the name as a form
          would print it rather than a nickname for it.
        */}
        <div className={SECTION}>
          <h4 className={HEADING}><ListPlus size={16} /> Custom Fields</h4>
          <p className="text-sm text-onextap-dark/60 dark:text-[#9AB07A] mb-4 -mt-2">
            Anything else forms ask you for — Mother's Name, Roll Number, Visa Status. Name it the way a form labels it, and autofill will match it.
          </p>
          <div className="space-y-3">
            {(profile.customFields || []).map((field, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  className={`${FIELD_BASE} w-1/3`}
                  value={field.label || ''}
                  onChange={e => updateItem('customFields', idx, 'label', e.target.value)}
                  placeholder="Field name (e.g. Mother's Name)"
                />
                <input
                  className={`${FIELD_BASE} flex-1`}
                  value={field.value || ''}
                  onChange={e => updateItem('customFields', idx, 'value', e.target.value)}
                  placeholder="Value"
                />
                <button type="button" onClick={() => removeItem('customFields', idx)} className={`${TRASH_BTN} px-2`}><Trash2 size={18} /></button>
              </div>
            ))}
            {!(profile.customFields || []).length && (
              <p className="text-sm text-onextap-muted dark:text-[#9AB07A]/80 italic">No custom fields yet.</p>
            )}
          </div>
          <button type="button" onClick={() => addItem('customFields', emptyCustomField())} className={ADD_BTN}><Plus size={16} /> Add field</button>
        </div>
      </div>
        </div>
      </div>
    </div>
  );
};

/**
 * A stored profile, ready to render.
 *
 * Fills in whatever the saved blob is missing — a profile written by an older
 * build has no `customFields`, and rows saved straight from the parser are
 * missing half the keys the editor binds. `mergeParsedResumeIntoProfile` with
 * an empty parse does exactly that work and nothing else (see its merge
 * contract: an empty value never overwrites), so there is no second
 * hydration path to keep in step with the first.
 *
 * @param {object} saved The active profile in its flat legacy shape.
 * @returns {object} A profile with every key the editor renders.
 */
function hydrate(saved) {
  return mergeParsedResumeIntoProfile(saved, {});
}

export default ProfilesPage;
