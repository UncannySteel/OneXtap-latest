import React, { useState, useEffect, useRef } from 'react';
import { Activity, Award, Briefcase, Code, ExternalLink, FileText, Flag, GraduationCap, MapPin, Plus, Save, Trash2, User } from 'lucide-react';
import { COUNTRIES, GENDERS } from '../../../extension/constants';
import { getExtensionId } from '../../extensionClient';
import { DEFAULT_PROFILE, RACES, VETERAN_STATUS } from '../../profileDefaults';
import { getActiveLegacyProfile, loadProfileStore, saveLegacyUserProfile } from '../../profileStore';
import { parseResumeFile, RESUME_ACCEPT_ATTR } from '../../resumeParse';
import { saveParsedResume } from '../../resumeStore';
import ProfileSwitcher from '../shared/ProfileSwitcher';
import { log as baseLog } from '../../logger';

const log = baseLog.child('ui');

/**
 * "My Profiles" tab — the full profile editor: personal details, address,
 * education, experience, skills, URLs, and demographics.
 *
 * Owns resume upload: `parseResumeFile` handles the transport (base64, the
 * GET /api/me preflight, the PARSE_RESUME round trip) and the parsed fields
 * are merged over the existing profile here rather than replacing it. The
 * result is also filed in the resume library, but that write is best-effort —
 * losing the library copy must never cost the user the profile merge.
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
  const fileInputRef = useRef(null);
  const skillInputRef = useRef(null);

  useEffect(() => {
    const loadData = async () => {
      await loadProfileStore();
      const saved = await getActiveLegacyProfile();
      if (saved) {
        const mergedProfile = { ...DEFAULT_PROFILE, ...saved };
        if (saved.education) mergedProfile.education = saved.education;
        if (saved.experience) mergedProfile.experience = saved.experience;
        if (saved.skills) mergedProfile.skills = saved.skills;
        if (saved.urls) mergedProfile.urls = saved.urls;
        if (saved.currentJob) mergedProfile.currentJob = { ...DEFAULT_PROFILE.currentJob, ...saved.currentJob };
        if (saved.address) mergedProfile.address = { ...DEFAULT_PROFILE.address, ...saved.address };
        if (saved.vault) mergedProfile.vault = saved.vault;
        if (saved.certificates) mergedProfile.certificates = saved.certificates;
        if (saved.race) mergedProfile.race = saved.race;
        setProfile(mergedProfile);
      }
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
  // The TRANSPORT (base64, session preflight, PARSE_RESUME round trip) now
  // lives in src/resumeParse.js. The merge below is unchanged, byte for byte
  // apart from being two spaces shallower: it is the part users would notice
  // breaking, so the extraction deliberately stopped at its edge.
  const handleFileUpload = async (event) => {
    const file = event.target?.files?.[0];
    // Reset the input first: picking the SAME file twice fires no change event
    // otherwise, which reads to the user as the upload button being dead. This
    // mirrors ResumeSwitcher.handleUpload — the two pickers must behave alike.
    if (event.target) event.target.value = '';
    if (!file) return;

    setIsParsing(true);
    setStatus('Parsing resume...');

    try {
      const result = await parseResumeFile(file);
      if (!result.ok) {
        setStatus('Error: ' + result.error.message);
        setIsParsing(false);
        return;
      }

      const extracted = result.parsed;

      setProfile(prev => {
        // Start with previous profile so we don't blow away any manual data
        let next = {
          ...prev,
          firstName: extracted.firstName || prev.firstName,
          lastName: extracted.lastName || prev.lastName,
          email: extracted.email || prev.email,
          phone: extracted.phone || prev.phone,
          education: extracted.education?.length ? extracted.education : prev.education,
          experience: extracted.experience?.length ? extracted.experience : prev.experience,
          skills: extracted.skills?.length ? [...new Set([...(prev.skills || []), ...extracted.skills])] : (prev.skills || [])
        };

        // Address (merge into existing structure)
        if (extracted.address) {
          next = {
            ...next,
            address: {
              ...DEFAULT_PROFILE.address,
              ...(prev.address || {}),
              ...extracted.address
            }
          };
        }

        // Country / country code (align from address.country when possible)
        if (extracted.address?.country) {
          const matchedCountry = COUNTRIES.find(
            c => c.name.toLowerCase() === extracted.address.country.toLowerCase()
          );
          if (matchedCountry) {
            next.country = matchedCountry.name;
            next.countryCode = matchedCountry.dial_code;
            next.address = {
              ...DEFAULT_PROFILE.address,
              ...(next.address || {}),
              country: matchedCountry.name
            };
          }
        }

        // URLs – replace if we got any, otherwise keep existing
        if (Array.isArray(extracted.urls) && extracted.urls.length) {
          next.urls = extracted.urls.filter(u => u && u.value);
        }

        // Certificates
        if (Array.isArray(extracted.certificates) && extracted.certificates.length) {
          next.certificates = extracted.certificates.filter(c => c && c.name);
        }

        // Current job
        if (extracted.currentJob && (extracted.currentJob.company || extracted.currentJob.title)) {
          next.currentJob = {
            ...DEFAULT_PROFILE.currentJob,
            ...(prev.currentJob || {}),
            ...extracted.currentJob
          };
        }

        return next;
      });

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
        await saveParsedResume(result);
      } catch (e) {
        storeWarning = e?.message || 'Could not save this resume to your library.';
        log.warn('Onextap: resume library write failed; profile merge kept', { errName: e?.name });
      }

      setStatus(storeWarning ? 'Resume parsed (not saved to library)' : 'Resume parsed!');
      setIsParsing(false);
      showToast?.(
        storeWarning ? `Resume parsed. ${storeWarning}` : 'Resume parsed successfully',
        storeWarning ? 'error' : 'success',
      );
      setTimeout(() => setStatus(''), 3000);
    } catch (error) {
      log.error("Onextap: File upload error:", error);
      setStatus('Error: ' + (error.message || 'Failed to read file. Please try again.'));
      setIsParsing(false);
    }
  };


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
  const handleCountryChange = (e) => {
    const selectedCountry = COUNTRIES.find(c => c.name === e.target.value);
    setProfile({
      ...profile,
      country: e.target.value,
      countryCode: selectedCountry ? selectedCountry.dial_code : profile.countryCode
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
    if (!s || (profile.skills || []).includes(s)) return;
    setProfile({ ...profile, skills: [...(profile.skills || []), s] });
  };
  const removeSkill = (skill) => setProfile({ ...profile, skills: (profile.skills || []).filter(x => x !== skill) });

  const emptyEducation = () => ({ school: '', degree: '', field: '', start: '', end: '', cgpa: '', specialization: '', minor: '', graduationYear: '', enrollmentYear: '', graduationDate: '', expectedGraduation: '' });
  const emptyExperience = () => ({ company: '', title: '', start: '', end: '', startDate: '', endDate: '', description: '', duration: '', type: '', isCurrent: false });
  const emptyCertificate = () => ({ name: '', issuer: '', date: '', expiry: '' });

  const reloadActiveProfile = async () => {
    const saved = await getActiveLegacyProfile();
    if (saved) {
      setProfile({
        ...DEFAULT_PROFILE,
        ...saved,
        education: saved.education || DEFAULT_PROFILE.education,
        experience: saved.experience || DEFAULT_PROFILE.experience,
        vault: saved.vault || DEFAULT_PROFILE.vault,
      });
    }
  };

  return (
    <div className="animate-fade-in max-w-4xl mx-auto space-y-4">
      <ProfileSwitcher onProfileChange={reloadActiveProfile} />
      <div className="bg-white/80 backdrop-blur-sm rounded-3xl border border-onextap-primary/15 p-8 shadow-lg shadow-onextap-dark/5 relative overflow-hidden">
        {/* Decorative gradient */}
        <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-onextap-primary/10 to-transparent rounded-full blur-2xl" />
        
        <div className="relative z-10">
          <div className="flex justify-between items-center mb-8 pb-6 border-b border-onextap-primary/15">
            <div>
              <h2 className="font-bold text-2xl text-onextap-dark tracking-tight mb-1">My Profile</h2>
              <p className="text-onextap-dark/60 text-sm">Manage your personal information for autofill</p>
            </div>
            <button onClick={handleSave} className="bg-onextap-dark text-white px-6 py-3 rounded-xl flex items-center gap-2 hover:bg-onextap-dark/90 shadow-lg shadow-onextap-dark/20 transition-all duration-200 font-semibold">
              <Save size={18} /> {status || 'Save Changes'}
            </button>
          </div>

      <div className="max-h-[calc(100vh-14rem)] overflow-y-auto pr-2 space-y-8">
        {/* RESUME UPLOAD */}
        <div className="p-5 bg-gradient-to-r from-onextap-primary/10 to-onextap-primary/5 rounded-2xl border border-onextap-primary/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white rounded-xl shadow-sm">
                <FileText className="text-onextap-primary" size={24} />
              </div>
              <div>
                <h4 className="font-bold text-onextap-dark">Upload Resume</h4>
                <p className="text-sm text-onextap-dark/60">Auto-fill your profile from PDF or Image</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} type="file" accept={RESUME_ACCEPT_ATTR} onChange={handleFileUpload} className="hidden" id="resume-upload" />
              <label htmlFor="resume-upload" className={`px-5 py-2.5 rounded-xl font-semibold text-sm cursor-pointer transition-all duration-200 flex items-center gap-2 shadow-md ${isParsing ? 'bg-onextap-dark/40 text-white' : 'bg-onextap-dark text-white hover:bg-onextap-dark/90 hover:shadow-lg'}`}>
                {isParsing ? <><Activity className="animate-spin" size={16} /> Parsing...</> : <><FileText size={16} /> Upload Resume</>}
              </label>
            </div>
          </div>
        </div>

        {/* BASIC INFO */}
        <div>
          <h4 className="text-sm font-bold text-onextap-dark mb-4 flex items-center gap-2"><User size={16} /> Basic Info</h4>
          <div className="grid grid-cols-6 gap-6">
            <div className="col-span-3">
              <label className="block text-sm font-medium text-onextap-dark mb-1">First Name</label>
              <input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.firstName} onChange={e => setProfile({...profile, firstName: e.target.value})} />
            </div>
            <div className="col-span-3">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Last Name</label>
              <input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.lastName} onChange={e => setProfile({...profile, lastName: e.target.value})} />
            </div>
            <div className="col-span-6">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Email</label>
              <input type="email" className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.email} onChange={e => setProfile({...profile, email: e.target.value})} />
            </div>
            <div className="col-span-3">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Country</label>
              <select className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.country} onChange={handleCountryChange}>
                {COUNTRIES.map(c => <option key={c.code} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div className="col-span-3">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Phone ({profile.countryCode})</label>
              <div className="flex gap-2">
                <div className="p-2 bg-onextap-primary/10 border border-onextap-primary/30 rounded-lg text-onextap-dark font-medium">{profile.countryCode}</div>
                <input className="flex-1 p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.phone} onChange={e => setProfile({...profile, phone: e.target.value})} />
              </div>
            </div>
            <div className="col-span-3">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Birth Date</label>
              <input type="date" className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.birthDate} onChange={e => setProfile({...profile, birthDate: e.target.value})} />
            </div>
            <div className="col-span-3">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Gender</label>
              <select className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.gender} onChange={e => setProfile({...profile, gender: e.target.value})}>
                <option value="">Select...</option>
                {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* LINKS */}
        <div className="pt-4 border-t border-onextap-primary/20">
          <label className="text-sm font-bold text-onextap-dark mb-3 flex items-center gap-2"><ExternalLink size={16} /> Links</label>
          <div className="space-y-3">
            {(profile.urls || []).map((urlItem, index) => (
              <div key={index} className="flex gap-2">
                <select className="w-1/3 p-2 border border-onextap-primary/30 rounded-lg bg-white" value={urlItem.type} onChange={(e) => updateUrlType(index, e.target.value)}>
                  <option value="LinkedIn">LinkedIn</option>
                  <option value="GitHub">GitHub</option>
                  <option value="Portfolio">Portfolio</option>
                  <option value="Other">Other</option>
                </select>
                <input className="flex-1 p-2 border border-onextap-primary/30 rounded-lg bg-white" value={urlItem.value} onChange={(e) => updateUrl(index, e.target.value)} placeholder="https://..." />
                <button type="button" onClick={() => removeUrl(index)} className="text-red-500 hover:text-red-700 px-2"><Trash2 size={18} /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addUrlSlot} className="mt-4 text-sm text-onextap-primary font-medium flex items-center gap-1"><Plus size={16} /> Add link</button>
        </div>

        {/* ADDRESS */}
        <div className="pt-4 border-t border-onextap-primary/20">
          <h4 className="text-sm font-bold text-onextap-dark mb-4 flex items-center gap-2"><MapPin size={16} /> Address</h4>
          <div className="grid grid-cols-6 gap-6">
            <div className="col-span-6">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Address Line 1</label>
              <input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.address?.addressLine1} onChange={e => updateAddress('addressLine1', e.target.value)} />
            </div>
            <div className="col-span-6">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Address Line 2</label>
              <input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.address?.addressLine2} onChange={e => updateAddress('addressLine2', e.target.value)} />
            </div>
            <div className="col-span-6">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Address Line 3</label>
              <input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.address?.addressLine3} onChange={e => updateAddress('addressLine3', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-onextap-dark mb-1">City</label>
              <input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.address?.city} onChange={e => updateAddress('city', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-onextap-dark mb-1">State</label>
              <input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.address?.state} onChange={e => updateAddress('state', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Postal Code</label>
              <input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.address?.postalCode} onChange={e => updateAddress('postalCode', e.target.value)} />
            </div>
            <div className="col-span-6">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Country</label>
              <select className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.address?.country} onChange={e => updateAddress('country', e.target.value)}>
                {COUNTRIES.map(c => <option key={c.code} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* EDUCATION */}
        <div className="pt-4 border-t border-onextap-primary/20">
          <h4 className="text-sm font-bold text-onextap-dark mb-4 flex items-center gap-2"><GraduationCap size={16} /> Education</h4>
          <div className="space-y-6">
            {(profile.education || []).map((ed, idx) => (
              <div key={idx} className="p-4 bg-onextap-primary/5 rounded-xl border border-onextap-primary/20 space-y-4 relative">
                <button type="button" onClick={() => removeItem('education', idx)} className="absolute top-3 right-3 text-red-500 hover:text-red-700"><Trash2 size={16} /></button>
                <div className="grid grid-cols-6 gap-4">
                  <div className="col-span-6"><label className="block text-xs font-medium text-onextap-dark mb-1">School</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={ed.school} onChange={e => updateItem('education', idx, 'school', e.target.value)} placeholder="School name" /></div>
                  <div className="col-span-3"><label className="block text-xs font-medium text-onextap-dark mb-1">Degree</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={ed.degree} onChange={e => updateItem('education', idx, 'degree', e.target.value)} placeholder="e.g. B.S." /></div>
                  <div className="col-span-3"><label className="block text-xs font-medium text-onextap-dark mb-1">Field</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={ed.field} onChange={e => updateItem('education', idx, 'field', e.target.value)} placeholder="e.g. Computer Science" /></div>
                  <div className="col-span-2"><label className="block text-xs font-medium text-onextap-dark mb-1">Start</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={ed.start} onChange={e => updateItem('education', idx, 'start', e.target.value)} placeholder="YYYY" /></div>
                  <div className="col-span-2"><label className="block text-xs font-medium text-onextap-dark mb-1">End</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={ed.end} onChange={e => updateItem('education', idx, 'end', e.target.value)} placeholder="YYYY" /></div>
                  <div className="col-span-2"><label className="block text-xs font-medium text-onextap-dark mb-1">GPA / CGPA</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={ed.cgpa} onChange={e => updateItem('education', idx, 'cgpa', e.target.value)} placeholder="e.g. 3.8" /></div>
                  <div className="col-span-3"><label className="block text-xs font-medium text-onextap-dark mb-1">Specialization</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={ed.specialization} onChange={e => updateItem('education', idx, 'specialization', e.target.value)} /></div>
                  <div className="col-span-3"><label className="block text-xs font-medium text-onextap-dark mb-1">Minor</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={ed.minor} onChange={e => updateItem('education', idx, 'minor', e.target.value)} /></div>
                  <div className="col-span-2"><label className="block text-xs font-medium text-onextap-dark mb-1">Graduation Year</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={ed.graduationYear} onChange={e => updateItem('education', idx, 'graduationYear', e.target.value)} placeholder="YYYY" /></div>
                  <div className="col-span-2"><label className="block text-xs font-medium text-onextap-dark mb-1">Enrollment Year</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={ed.enrollmentYear} onChange={e => updateItem('education', idx, 'enrollmentYear', e.target.value)} placeholder="YYYY" /></div>
                  <div className="col-span-2"><label className="block text-xs font-medium text-onextap-dark mb-1">Expected Graduation</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={ed.expectedGraduation} onChange={e => updateItem('education', idx, 'expectedGraduation', e.target.value)} placeholder="YYYY" /></div>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addItem('education', emptyEducation())} className="mt-4 text-sm text-onextap-primary font-medium flex items-center gap-1"><Plus size={16} /> Add education</button>
        </div>

        {/* EXPERIENCE */}
        <div className="pt-4 border-t border-onextap-primary/20">
          <h4 className="text-sm font-bold text-onextap-dark mb-4 flex items-center gap-2"><Briefcase size={16} /> Experience</h4>
          <div className="space-y-6">
            {(profile.experience || []).map((ex, idx) => (
              <div key={idx} className="p-4 bg-onextap-primary/5 rounded-xl border border-onextap-primary/20 space-y-4 relative">
                <button type="button" onClick={() => removeItem('experience', idx)} className="absolute top-3 right-3 text-red-500 hover:text-red-700"><Trash2 size={16} /></button>
                <div className="grid grid-cols-6 gap-4">
                  <div className="col-span-3"><label className="block text-xs font-medium text-onextap-dark mb-1">Company</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={ex.company} onChange={e => updateItem('experience', idx, 'company', e.target.value)} /></div>
                  <div className="col-span-3"><label className="block text-xs font-medium text-onextap-dark mb-1">Title</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={ex.title} onChange={e => updateItem('experience', idx, 'title', e.target.value)} /></div>
                  <div className="col-span-2"><label className="block text-xs font-medium text-onextap-dark mb-1">Start</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={ex.start} onChange={e => updateItem('experience', idx, 'start', e.target.value)} placeholder="YYYY-MM" /></div>
                  <div className="col-span-2"><label className="block text-xs font-medium text-onextap-dark mb-1">End</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={ex.end} onChange={e => updateItem('experience', idx, 'end', e.target.value)} placeholder="YYYY-MM or Present" /></div>
                  <div className="col-span-2 flex items-end pb-1"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!ex.isCurrent} onChange={e => updateItem('experience', idx, 'isCurrent', e.target.checked)} /> Current</label></div>
                  <div className="col-span-6"><label className="block text-xs font-medium text-onextap-dark mb-1">Description</label><textarea className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm min-h-[80px]" value={ex.description} onChange={e => updateItem('experience', idx, 'description', e.target.value)} placeholder="Responsibilities, achievements..." /></div>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addItem('experience', emptyExperience())} className="mt-4 text-sm text-onextap-primary font-medium flex items-center gap-1"><Plus size={16} /> Add experience</button>
        </div>

        {/* CERTIFICATES */}
        <div className="pt-4 border-t border-onextap-primary/20">
          <h4 className="text-sm font-bold text-onextap-dark mb-4 flex items-center gap-2"><Award size={16} /> Certificates</h4>
          <div className="space-y-4">
            {(profile.certificates || []).map((cert, idx) => (
              <div key={idx} className="flex gap-4 items-start p-4 bg-onextap-primary/5 rounded-xl border border-onextap-primary/20">
                <div className="flex-1 grid grid-cols-4 gap-4">
                  <div><label className="block text-xs font-medium text-onextap-dark mb-1">Name</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={cert.name} onChange={e => updateItem('certificates', idx, 'name', e.target.value)} placeholder="Certification name" /></div>
                  <div><label className="block text-xs font-medium text-onextap-dark mb-1">Issuer</label><input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={cert.issuer} onChange={e => updateItem('certificates', idx, 'issuer', e.target.value)} /></div>
                  <div><label className="block text-xs font-medium text-onextap-dark mb-1">Date</label><input type="date" className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={cert.date} onChange={e => updateItem('certificates', idx, 'date', e.target.value)} /></div>
                  <div><label className="block text-xs font-medium text-onextap-dark mb-1">Expiry</label><input type="date" className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" value={cert.expiry} onChange={e => updateItem('certificates', idx, 'expiry', e.target.value)} /></div>
                </div>
                <button type="button" onClick={() => removeItem('certificates', idx)} className="text-red-500 hover:text-red-700 mt-6"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addItem('certificates', emptyCertificate())} className="mt-4 text-sm text-onextap-primary font-medium flex items-center gap-1"><Plus size={16} /> Add certificate</button>
        </div>

        {/* SKILLS */}
        <div className="pt-4 border-t border-onextap-primary/20">
          <h4 className="text-sm font-bold text-onextap-dark mb-4 flex items-center gap-2"><Code size={16} /> Skills</h4>
          <div className="flex flex-wrap gap-2 mb-3">
            {(profile.skills || []).map(skill => (
              <span key={skill} className="inline-flex items-center gap-1 px-3 py-1 bg-onextap-primary/10 text-onextap-dark rounded-full text-sm">
                {skill}
                <button type="button" onClick={() => removeSkill(skill)} className="hover:text-red-600">&times;</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input ref={skillInputRef} className="flex-1 p-2 border border-onextap-primary/30 rounded-lg bg-white text-sm" placeholder="Add a skill (e.g. JavaScript)" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(e.target.value); e.target.value = ''; } }} />
            <button type="button" onClick={() => { const el = skillInputRef.current; if (el?.value) { addSkill(el.value); el.value = ''; } }} className="px-4 py-2 bg-onextap-primary text-white rounded-lg text-sm font-medium hover:bg-onextap-primary-dark">Add</button>
          </div>
        </div>

        {/* CURRENT JOB */}
        <div className="pt-4 border-t border-onextap-primary/20">
          <h4 className="text-sm font-bold text-onextap-dark mb-4 flex items-center gap-2"><Briefcase size={16} /> Current Job</h4>
          <div className="grid grid-cols-6 gap-6">
            <div className="col-span-3">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Company</label>
              <input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.currentJob?.company} onChange={e => updateCurrentJob('company', e.target.value)} />
            </div>
            <div className="col-span-3">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Title</label>
              <input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.currentJob?.title} onChange={e => updateCurrentJob('title', e.target.value)} />
            </div>
            <div className="col-span-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!profile.currentJob?.isCurrent} onChange={e => updateCurrentJob('isCurrent', e.target.checked)} />
                <span className="text-sm font-medium text-onextap-dark">Currently employed here</span>
              </label>
            </div>
          </div>
        </div>

        {/* COMPENSATION & AVAILABILITY */}
        <div className="pt-4 border-t border-onextap-primary/20">
          <h4 className="text-sm font-bold text-onextap-dark mb-4 flex items-center gap-2"><Activity size={16} /> Compensation & Availability</h4>
          <div className="grid grid-cols-6 gap-6">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Current Salary</label>
              <input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.currentSalary} onChange={e => setProfile({...profile, currentSalary: e.target.value})} placeholder="e.g. 80,000" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Pay Expectation</label>
              <input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.payExpectation} onChange={e => setProfile({...profile, payExpectation: e.target.value})} placeholder="e.g. 90,000" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Notice Period</label>
              <input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.noticePeriod} onChange={e => setProfile({...profile, noticePeriod: e.target.value})} placeholder="e.g. 2 weeks" />
            </div>
          </div>
        </div>

        {/* EEO / DEMOGRAPHICS */}
        <div className="pt-4 border-t border-onextap-primary/20">
          <h4 className="text-sm font-bold text-onextap-dark mb-4 flex items-center gap-2"><Flag size={16} /> EEO / Demographics</h4>
          <div className="grid grid-cols-6 gap-6">
            <div className="col-span-6">
              <label className="block text-sm font-medium text-onextap-dark mb-2">Race</label>
              <div className="flex flex-wrap gap-2">
                {(RACES || []).map(race => (
                  <button type="button" key={race} onClick={() => toggleRace(race)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${(profile.race || []).includes(race) ? 'bg-onextap-primary text-white border-onextap-primary' : 'bg-white border-onextap-primary/30 text-onextap-dark hover:border-onextap-primary'}`}>{race}</button>
                ))}
              </div>
            </div>
            <div className="col-span-3">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Ethnicity</label>
              <input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.ethnicity} onChange={e => setProfile({...profile, ethnicity: e.target.value})} placeholder="Optional" />
            </div>
            <div className="col-span-3">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Veteran Status</label>
              <select className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.veteran} onChange={e => setProfile({...profile, veteran: e.target.value})}>
                <option value="">Select...</option>
                {(VETERAN_STATUS || []).map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="col-span-6">
              <label className="block text-sm font-medium text-onextap-dark mb-1">Disability</label>
              <input className="w-full p-2 border border-onextap-primary/30 rounded-lg bg-white focus:outline-none focus:border-onextap-primary" value={profile.disability} onChange={e => setProfile({...profile, disability: e.target.value})} placeholder="Optional — decline to identify or describe" />
            </div>
          </div>
        </div>
      </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilesPage;
