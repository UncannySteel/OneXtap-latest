import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Layout, FileText, Shield, Plus, CheckCircle, 
  User, ExternalLink, Lock, Save, Activity, Trash2, Calendar, 
  PenTool, Sparkles, Clipboard, ChevronLeft, ChevronDown, ChevronUp, Briefcase, GraduationCap, Flag,
  MapPin, Award, Code, Cloud, LogOut, Terminal, Settings, X, AlertTriangle, Crown, ArrowRight,
  CreditCard, Zap, Moon, Sun, Menu, Copy, RotateCcw, MessageSquare
} from 'lucide-react';
import { storage } from '../storage';
import {
  loadProfileStore,
  getActiveLegacyProfile,
  saveLegacyUserProfile,
  setActiveProfileId,
  createProfile,
  renameProfile,
  deleteProfile,
  listProfiles,
  updateActiveProfileData,
  MAX_PROFILE_NAME_LENGTH,
  MAX_COVER_LETTERS_PER_PROFILE,
} from '../profileStore';
import { COUNTRIES, GENDERS } from '../../extension/constants';
import { signIn as supaSignIn, signUp as supaSignUp, signOut as supaSignOut, onAuthStateChange, signInWithOAuth, getAccessToken, getUser } from '../auth';
import { creditManager } from '../creditManager';

// Fallback extension ID (e.g. for published extension). When opening dashboard from popup we pass the real ID via ?extensionId=
const EXTENSION_ID_FALLBACK = "jipgjmkblebmogmipckjkegghoijeich";

/** Get extension ID: from URL (?extensionId=) when dashboard opened from popup, then chrome.runtime.id, then fallback. */
function getExtensionId() {
  if (typeof window !== 'undefined' && window.location?.search) {
    const fromUrl = new URLSearchParams(window.location.search).get('extensionId');
    if (fromUrl?.trim()) return fromUrl.trim();
  }
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) return chrome.runtime.id;
  return EXTENSION_ID_FALLBACK || null;
}

const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL || "https://www.onextap.com";
const API_URL = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? 'https://www.onextap.com' : '')
).replace(/\/$/, '');
const ANSWER_STUDIO_MODEL = import.meta.env.VITE_ANSWER_STUDIO_MODEL || "llama-3.3-70b-versatile";
const ANSWER_STYLE_OPTIONS = [
  { value: 'balanced', label: 'Balanced & professional' },
  { value: 'impact', label: 'Impact-driven' },
  { value: 'technical', label: 'Technical depth' },
  { value: 'leadership', label: 'Leadership & ownership' },
];
const ANSWER_STYLE_INSTRUCTIONS = {
  balanced: 'Balanced and professional: confident, clear, and credible.',
  impact: 'Impact-driven: emphasize outcomes, business value, and measurable results.',
  technical: 'Technical depth: highlight tools, systems, and practical execution detail.',
  leadership: 'Leadership and ownership: show initiative, decision-making, and collaboration.',
};

const AI_MATCH_CATEGORY_ORDER = ['Strong Match', 'Good Match', 'Stretch Match', 'Low Match'];

const AUTOFILL_SECTION_META = [
  { key: 'personalInfo', label: 'Personal Info', icon: '👤' },
  { key: 'education', label: 'Education', icon: '🎓' },
  { key: 'workExperience', label: 'Work Experience', icon: '💼' },
  { key: 'openEnded', label: 'Open-ended Answers', icon: '💬' },
  { key: 'coverLetter', label: 'Cover Letter', icon: '📄' },
];

const DEFAULT_SECTION_TOGGLES = {
  personalInfo: true,
  education: true,
  workExperience: true,
  openEnded: true,
  coverLetter: true,
};

// --- 1. CONFIGURATION ---
const DEFAULT_PROFILE = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  urls: [
    { type: 'LinkedIn', value: '' },
    { type: 'GitHub', value: '' }, 
    { type: 'Portfolio', value: '' }
  ],
  country: 'United States', 
  countryCode: '+1',
  birthDate: '', 
  gender: '',
  vault: [
    { id: 1, question: "Why do you want to work here?", answer: "I've always admired companies that push boundaries. My skills in problem-solving align perfectly with your mission to innovate." },
    { id: 2, question: "Tell us about a challenge you faced.", answer: "In a previous project, we faced a tight deadline. I organized the team, prioritized tasks, and we delivered on time." }
  ],
  address: {
    country: 'United States',
    city: '',
    state: '',
    postalCode: '',
    addressLine1: '',
    addressLine2: '',
    addressLine3: ''
  },
  education: [
    { school: '', degree: '', field: '', start: '', end: '', cgpa: '', specialization: '', minor: '', graduationYear: '', enrollmentYear: '', graduationDate: '', expectedGraduation: '' }
  ],
  experience: [
    { company: '', title: '', start: '', end: '', startDate: '', endDate: '', description: '', duration: '', type: '', isCurrent: false }
  ],
  certificates: [
    { name: '', issuer: '', date: '', expiry: '' }
  ],
  skills: [],
  currentJob: {
    company: '',
    title: '',
    isCurrent: true
  },
  currentSalary: '',
  payExpectation: '',
  noticePeriod: '',
  race: [], 
  ethnicity: '', 
  veteran: '',   
  disability: ''
};

// Simple password strength helper
// Returns: 'weak' | 'medium' | 'strong' | null
const getPasswordStrength = (password) => {
  if (!password) return null;

  const lengthScore = password.length;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  // Very basic guardrails
  if (lengthScore < 8 || !(hasUpper && hasLower && hasNumber)) {
    return 'weak';
  }

  // Strong: long and uses multiple character types
  if (lengthScore >= 12 && hasUpper && hasLower && hasNumber && hasSymbol) {
    return 'strong';
  }

  // Everything else that passes the minimum is "medium"
  return 'medium';
};

const RACES = ["American Indian", "Asian", "Black or African American", "Native Hawaiian", "White", "Two or More"];
const VETERAN_STATUS = ["I am not a protected veteran", "I am a protected veteran", "Decline to identify"];

// Helper to get icon URL
const getIconUrl = () => {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL('icon.png');
  }
  return '/icon.png';
};

// --- TOAST COMPONENT ---
const Toast = ({ message, type = 'success', isVisible, onDismiss }) => {
  useEffect(() => {
    if (!isVisible || !message || type === 'loading') return;
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [isVisible, message, type, onDismiss]);

  if (!isVisible || !message) return null;
  return (
    <div 
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl shadow-lg border flex items-center gap-2 toast-enter ${
        type === 'loading' 
          ? 'bg-onextap-dark text-white border-onextap-primary/30' 
          : type === 'error'
          ? 'bg-red-50 text-red-800 border-red-200'
          : 'bg-white text-onextap-dark border-onextap-primary/30'
      }`}
      role="status"
    >
      {type === 'loading' && <Activity className="animate-spin shrink-0" size={18} />}
      {type === 'success' && <CheckCircle className="text-onextap-primary shrink-0" size={18} />}
      {type === 'error' && <AlertTriangle className="text-red-600 shrink-0" size={18} />}
      <span className="text-sm font-medium">{message}</span>
    </div>
  );
};

// --- PREMIUM MODAL (Dodo Payments Checkout) ---
const PremiumModal = ({ isOpen, onClose, user }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleUpgrade = async () => {
    if (!user?.id) {
      setError('Please sign in first to upgrade.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const { url } = await creditManager.createCheckoutSession();
      window.location.href = url;
    } catch (err) {
      console.error('Checkout error:', err);
      setError(err.message || 'Failed to start checkout. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-onextap-primary/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-br from-onextap-primary to-onextap-primary-dark p-6 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
          <div className="flex justify-between items-start relative z-10">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Crown size={22} />
                <h2 className="text-xl font-bold">Upgrade to Premium</h2>
              </div>
              <p className="text-white/90 text-sm">Unlimited AI-powered answer generation</p>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="p-6 space-y-5">
          {/* Price */}
          <div className="text-center py-2">
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-4xl font-bold text-onextap-dark">$5.00</span>
              <span className="text-onextap-dark/60 text-sm">/month</span>
            </div>
            <p className="text-xs text-onextap-dark/50 mt-1">Billed monthly. Cancel anytime.</p>
          </div>

          {/* Features */}
          <div className="space-y-3 bg-onextap-primary/5 rounded-xl p-4 border border-onextap-primary/15">
            {[
              'Unlimited AI answer generations',
              'Priority AI processing speed',
              'Advanced job-page context analysis',
              'Cancel anytime — no lock-in',
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-3 text-sm text-onextap-dark/80">
                <CheckCircle size={16} className="text-onextap-primary shrink-0" />
                <span>{feature}</span>
              </div>
            ))}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg flex items-center gap-2">
              <AlertTriangle size={14} /> {error}
            </p>
          )}

          <button 
            onClick={handleUpgrade}
            disabled={isLoading}
            className="w-full bg-gradient-to-r from-onextap-primary to-onextap-primary-dark text-white py-3.5 rounded-xl font-bold text-base hover:opacity-90 transition-opacity shadow-lg shadow-onextap-primary/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <><Activity className="animate-spin" size={18} /> Redirecting to checkout...</>
            ) : (
              <><CreditCard size={18} /> Subscribe Now</>
            )}
          </button>

          <p className="text-xs text-onextap-dark/50 text-center flex items-center justify-center gap-1.5">
            <Lock size={10} /> Secure payment powered by Dodo Payments
          </p>
        </div>
      </div>
    </div>
  );
};

// --- SUB-COMPONENTS ---

const OverviewPage = ({ user, onNavigate, isPremium }) => {
  return (
    <div className="mx-auto max-w-3xl animate-fade-in space-y-6">
      <div className="relative overflow-hidden rounded-[14px] border border-[rgba(42,60,28,0.12)] bg-white p-10 text-center shadow-[0_8px_32px_rgba(42,60,28,0.06)] transition-colors dark:border-onextap-primary-light/20 dark:bg-onextap-night-surface dark:shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
        <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-gradient-to-bl from-onextap-olive-muted to-transparent blur-2xl dark:from-onextap-primary/25 dark:to-transparent" />
        <div className="relative z-10">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-onextap-olive-pale bg-onextap-olive-muted px-4 py-2 dark:border-[rgba(90,122,58,0.4)] dark:bg-[rgba(90,122,58,0.2)]">
            <Sparkles size={14} className="text-onextap-primary dark:text-onextap-olive-pale" />
            <span className="text-sm font-medium text-onextap-primary dark:text-onextap-olive-pale">Your job application hub</span>
          </div>

          <h1 className="mb-3 font-display text-4xl font-normal tracking-tight text-onextap-dark dark:text-[#E8EFD8]">
            Welcome to <em className="not-italic text-onextap-primary dark:text-onextap-olive-pale">Onextap</em>
          </h1>
          <p className="mx-auto mb-8 max-w-md leading-relaxed text-onextap-secondary dark:text-[#9AB07A]">
            Configure your profile and Answer Studio to autofill job applications in one click.
          </p>
          
          <div className={`inline-flex items-center gap-2 rounded-2xl border px-5 py-2.5 text-sm font-medium shadow-sm ${
            user
              ? 'border-onextap-primary/25 bg-gradient-to-r from-onextap-primary/15 to-onextap-primary/5 text-onextap-primary dark:border-onextap-primary-light/35 dark:from-onextap-primary/30 dark:to-onextap-primary/10 dark:text-onextap-olive-pale'
              : 'border-onextap-primary/15 bg-white/80 text-onextap-dark/60 dark:border-onextap-primary-light/20 dark:bg-onextap-night-card dark:text-[#C5D4A8]'
          }`}>
            <Cloud size={16} />
            {user ? `Signed in as ${user.user_metadata?.full_name || user.email?.split('@')[0]}` : "Local Mode (Sign in to Sync)"}
            {user && isPremium && <Crown size={14} className="text-amber-500" />}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <button
          type="button"
          onClick={() => onNavigate?.('profiles')}
          className="group rounded-[14px] border border-[rgba(42,60,28,0.12)] bg-white p-6 text-left shadow-sm transition-all duration-300 hover:bg-onextap-cream hover:shadow-md dark:border-onextap-primary-light/25 dark:bg-onextap-night-card dark:hover:border-onextap-primary-light/40 dark:hover:bg-[#2a3824] dark:hover:shadow-[0_8px_28px_rgba(0,0,0,0.35)]"
        >
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-[10px] bg-onextap-olive-muted transition-colors group-hover:bg-onextap-olive-pale/40 dark:bg-onextap-primary/25 dark:group-hover:bg-onextap-primary/35">
            <User size={22} className="text-onextap-primary dark:text-onextap-olive-pale" />
          </div>
          <h3 className="mb-1 font-semibold text-onextap-dark dark:text-[#E8EFD8]">My Profiles</h3>
          <p className="text-sm text-onextap-secondary dark:text-[#9AB07A]">Add your personal info, education, and experience</p>
        </button>
        <button
          type="button"
          onClick={() => onNavigate?.('vault')}
          className="group rounded-[14px] border border-[rgba(42,60,28,0.12)] bg-white p-6 text-left shadow-sm transition-all duration-300 hover:bg-onextap-cream hover:shadow-md dark:border-onextap-primary-light/25 dark:bg-onextap-night-card dark:hover:border-onextap-primary-light/40 dark:hover:bg-[#2a3824] dark:hover:shadow-[0_8px_28px_rgba(0,0,0,0.35)]"
        >
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-[10px] bg-onextap-olive-muted transition-colors group-hover:bg-onextap-olive-pale/40 dark:bg-onextap-primary/25 dark:group-hover:bg-onextap-primary/35">
            <PenTool size={22} className="text-onextap-primary dark:text-onextap-olive-pale" />
          </div>
          <h3 className="mb-1 font-semibold text-onextap-dark dark:text-[#E8EFD8]">Answer Studio</h3>
          <p className="text-sm text-onextap-secondary dark:text-[#9AB07A]">
            {isPremium
              ? 'Unlimited high-quality AI generation with deeper rewrites and profile-tailored answers'
              : 'Fast standard AI generation with 3 credits, plus profile-tailored answer improvements'}
          </p>
        </button>
        <button
          type="button"
          onClick={() => onNavigate?.('intel')}
          className="group rounded-[14px] border border-[rgba(42,60,28,0.12)] bg-white p-6 text-left shadow-sm transition-all duration-300 hover:bg-onextap-cream hover:shadow-md dark:border-onextap-primary-light/25 dark:bg-onextap-night-card dark:hover:border-onextap-primary-light/40 dark:hover:bg-[#2a3824] dark:hover:shadow-[0_8px_28px_rgba(0,0,0,0.35)]"
        >
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-[10px] bg-onextap-olive-muted transition-colors group-hover:bg-onextap-olive-pale/40 dark:bg-onextap-primary/25 dark:group-hover:bg-onextap-primary/35">
            <Briefcase size={22} className="text-onextap-primary dark:text-onextap-olive-pale" />
          </div>
          <h3 className="mb-1 font-semibold text-onextap-dark dark:text-[#E8EFD8]">Job Intelligence</h3>
          <p className="text-sm text-onextap-secondary dark:text-[#9AB07A]">
            AI-ranked opportunities for each resume profile, filtered to competitive matches.
          </p>
        </button>
      </div>
    </div>
  );
};

const JobIntelligencePage = ({ showToast }) => {
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [hiddenLowMatches, setHiddenLowMatches] = useState(0);
  const [feedSource, setFeedSource] = useState('');
  const [lookbackDays, setLookbackDays] = useState(10);
  const [selectedJob, setSelectedJob] = useState(null);
  const [applications, setApplications] = useState([]);
  const [isSyncingApplications, setIsSyncingApplications] = useState(false);
  const [filters, setFilters] = useState({
    remoteOnly: false,
    visaRequired: false,
    location: '',
    seniority: '',
  });
  const [savedJobIds, setSavedJobIds] = useState([]);
  const hasChrome = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage;

  const sendToExtension = (action, payload = {}) =>
    new Promise((resolve, reject) => {
      if (!hasChrome) return reject(new Error('Extension context not available'));
      const msg = { action, data: payload };
      const cb = (res) => {
        if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(res);
      };
      const id = getExtensionId();
      if (id) chrome.runtime.sendMessage(id, msg, cb);
      else chrome.runtime.sendMessage(msg, cb);
    });

  useEffect(() => {
    const load = async () => {
      const saved = await storage.get('onextap_resume_profiles');
      const savedProfile = await storage.get('user_profile');
      const savedJobs = await storage.get('onextap_saved_jobs');
      const localApplications = await storage.get('onextap_job_applications');
      const normalizedSaved = Array.isArray(savedJobs) ? savedJobs : [];
      setSavedJobIds(normalizedSaved);
      setApplications(Array.isArray(localApplications) ? localApplications : []);

      if (Array.isArray(saved) && saved.length > 0) {
        setProfiles(saved);
        setActiveProfileId(saved[0].id);
      } else {
        const fallbackProfile = {
          id: `resume-${Date.now()}`,
          name: 'Primary Resume',
          focusRole: savedProfile?.currentJob?.title || '',
          yearsExperience: '',
          needsVisaSponsorship: false,
          wantsRemote: true,
          domainTags: [],
          skills: Array.isArray(savedProfile?.skills) ? savedProfile.skills : [],
          source: 'user_profile',
        };
        setProfiles([fallbackProfile]);
        setActiveProfileId(fallbackProfile.id);
        await storage.set('onextap_resume_profiles', [fallbackProfile]);
      }

      if (!API_URL) return;
      try {
        const token = await getAccessToken();
        if (!token) return;
        setIsSyncingApplications(true);
        const res = await fetch(`${API_URL}/api/job-intelligence/applications`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(body.applications)) {
          setApplications(body.applications);
          await storage.set('onextap_job_applications', body.applications);
        }
      } catch {
        // Keep local fallback only.
      } finally {
        setIsSyncingApplications(false);
      }
    };
    load();
  }, []);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || null;

  const saveProfiles = async (nextProfiles) => {
    setProfiles(nextProfiles);
    await storage.set('onextap_resume_profiles', nextProfiles);
  };

  const addResumeProfile = async () => {
    const next = {
      id: `resume-${Date.now()}`,
      name: `Resume ${profiles.length + 1}`,
      focusRole: '',
      yearsExperience: '',
      needsVisaSponsorship: false,
      wantsRemote: true,
      domainTags: [],
      skills: [],
    };
    const updated = [...profiles, next];
    await saveProfiles(updated);
    setActiveProfileId(next.id);
    showToast?.('New resume profile added', 'success');
  };

  const updateActiveProfile = async (patch) => {
    if (!activeProfile) return;
    const updated = profiles.map((p) => (p.id === activeProfile.id ? { ...p, ...patch } : p));
    await saveProfiles(updated);
  };

  const fetchMatches = async () => {
    if (!activeProfile) return;
    setIsLoading(true);
    setError('');
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Please sign in to generate personalized matches.');
      if (!API_URL) throw new Error('Missing VITE_API_URL for job intelligence API.');

      const candidateProfile = {
        ...activeProfile,
        yearsExperience: Number(activeProfile.yearsExperience || 0),
      };
      const response = await fetch(`${API_URL}/api/job-intelligence/match-feed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lookbackDays,
          profileName: activeProfile.name,
          candidateProfile,
          filters,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      setHiddenLowMatches(Number(data.hiddenLowMatchCount || 0));
      setFeedSource(String(data.source || ''));
      showToast?.('AI-ranked feed refreshed', 'success');
    } catch (e) {
      const msg = e?.message || 'Failed to generate recommendations';
      setError(msg);
      showToast?.(msg, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSaveJob = async (jobId) => {
    const next = savedJobIds.includes(jobId)
      ? savedJobIds.filter((id) => id !== jobId)
      : [...savedJobIds, jobId];
    setSavedJobIds(next);
    await storage.set('onextap_saved_jobs', next);
  };

  const getApplicationStatus = (jobId) =>
    applications.find((a) => a.job_id === jobId)?.status || '';

  const trackApplicationStatus = async (job, status) => {
    if (!job?.id) return;
    const nextRecord = {
      job_id: job.id,
      status,
      profile_name: activeProfile?.name || 'Primary Resume',
      company: job.company || '',
      title: job.title || '',
      url: job.url || '',
      updated_at: new Date().toISOString(),
    };
    const nextLocal = [nextRecord, ...applications.filter((a) => a.job_id !== job.id)];
    setApplications(nextLocal);
    await storage.set('onextap_job_applications', nextLocal);

    if (!API_URL) return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      await fetch(`${API_URL}/api/job-intelligence/applications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jobId: job.id,
          status,
          profileName: activeProfile?.name || 'Primary Resume',
          company: job.company || '',
          title: job.title || '',
          url: job.url || '',
        }),
      });
    } catch {
      // Local tracking still works; backend sync can happen later.
    }
  };

  const handleQuickApply = async (job) => {
    if (!job?.url) return;
    try {
      await sendToExtension('OPEN_JOB_AND_PREPARE_APPLY', {
        url: job.url,
        jobId: job.id,
        title: job.title,
        company: job.company,
        profileName: activeProfile?.name || 'Primary Resume',
      });
      await trackApplicationStatus(job, 'in_progress');
      showToast?.('Opened in extension for quick apply', 'success');
    } catch (e) {
      showToast?.(e?.message || 'Could not trigger extension quick apply', 'error');
    }
  };

  return (
    <div className="mx-auto max-w-6xl animate-fade-in space-y-5">
      <div className="rounded-[14px] border border-[rgba(42,60,28,0.12)] bg-white p-6 shadow-sm dark:border-onextap-primary-light/25 dark:bg-onextap-night-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-onextap-dark dark:text-[#E8EFD8]">AI Job Intelligence</h2>
            <p className="mt-1 text-sm text-onextap-secondary dark:text-[#9AB07A]">
              Surfaces only competitive opportunities for each resume profile instead of a generic job board.
            </p>
          </div>
          <button
            type="button"
            onClick={addResumeProfile}
            className="inline-flex items-center gap-2 rounded-xl bg-onextap-dark px-3.5 py-2 text-sm font-semibold text-white hover:bg-onextap-dark/90"
          >
            <Plus size={14} /> Add Resume Feed
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-onextap-dark/60 dark:text-[#9AB07A]">Active Resume Profile</label>
            <select
              value={activeProfileId || ''}
              onChange={(e) => setActiveProfileId(e.target.value)}
              className="w-full rounded-lg border border-onextap-primary/30 bg-white p-2.5 text-sm focus:outline-none focus:border-onextap-primary"
            >
              {(profiles || []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-onextap-dark/60 dark:text-[#9AB07A]">Freshness Window</label>
            <select
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Number(e.target.value))}
              className="w-full rounded-lg border border-onextap-primary/30 bg-white p-2.5 text-sm focus:outline-none focus:border-onextap-primary"
            >
              <option value={7}>Last 7 days</option>
              <option value={10}>Last 10 days</option>
              <option value={14}>Last 14 days</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={fetchMatches}
              disabled={!activeProfile || isLoading}
              className="w-full rounded-lg bg-onextap-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-onextap-primary-dark disabled:opacity-60"
            >
              {isLoading ? 'Ranking jobs...' : 'Refresh Feed'}
            </button>
          </div>
        </div>

        {activeProfile && (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
            <input
              className="rounded-lg border border-onextap-primary/30 bg-white p-2.5 text-sm focus:outline-none focus:border-onextap-primary"
              placeholder="Resume profile name"
              value={activeProfile.name || ''}
              onChange={(e) => updateActiveProfile({ name: e.target.value })}
            />
            <input
              className="rounded-lg border border-onextap-primary/30 bg-white p-2.5 text-sm focus:outline-none focus:border-onextap-primary"
              placeholder="Target role (e.g. Frontend Engineer)"
              value={activeProfile.focusRole || ''}
              onChange={(e) => updateActiveProfile({ focusRole: e.target.value })}
            />
            <input
              className="rounded-lg border border-onextap-primary/30 bg-white p-2.5 text-sm focus:outline-none focus:border-onextap-primary"
              placeholder="Years of experience"
              value={activeProfile.yearsExperience || ''}
              onChange={(e) => updateActiveProfile({ yearsExperience: e.target.value.replace(/[^\d.]/g, '') })}
            />
            <input
              className="rounded-lg border border-onextap-primary/30 bg-white p-2.5 text-sm focus:outline-none focus:border-onextap-primary"
              placeholder="Skills (comma separated)"
              value={Array.isArray(activeProfile.skills) ? activeProfile.skills.join(', ') : ''}
              onChange={(e) => updateActiveProfile({ skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <input
            className="rounded-lg border border-onextap-primary/30 bg-white p-2.5 text-sm focus:outline-none focus:border-onextap-primary"
            placeholder="Location filter"
            value={filters.location}
            onChange={(e) => setFilters((f) => ({ ...f, location: e.target.value }))}
          />
          <select
            value={filters.seniority}
            onChange={(e) => setFilters((f) => ({ ...f, seniority: e.target.value }))}
            className="rounded-lg border border-onextap-primary/30 bg-white p-2.5 text-sm focus:outline-none focus:border-onextap-primary"
          >
            <option value="">Any seniority</option>
            <option value="Junior">Junior</option>
            <option value="Mid-Senior">Mid-Senior</option>
            <option value="Senior">Senior</option>
            <option value="Staff">Staff</option>
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-onextap-primary/20 bg-onextap-primary/5 px-3 text-sm">
            <input
              type="checkbox"
              checked={filters.remoteOnly}
              onChange={(e) => setFilters((f) => ({ ...f, remoteOnly: e.target.checked }))}
            />
            Remote only
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-onextap-primary/20 bg-onextap-primary/5 px-3 text-sm">
            <input
              type="checkbox"
              checked={filters.visaRequired}
              onChange={(e) => setFilters((f) => ({ ...f, visaRequired: e.target.checked }))}
            />
            Visa sponsorship
          </label>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {(jobs || []).length === 0 ? (
          <div className="rounded-[14px] border border-[rgba(42,60,28,0.12)] bg-white p-6 text-sm text-onextap-secondary dark:border-onextap-primary-light/25 dark:bg-onextap-night-card">
            No ranked opportunities yet. Configure a resume profile and click <span className="font-semibold">Refresh Feed</span>.
          </div>
        ) : (
          jobs
            .sort((a, b) => AI_MATCH_CATEGORY_ORDER.indexOf(a.category) - AI_MATCH_CATEGORY_ORDER.indexOf(b.category))
            .map((job) => (
              <div key={job.id} className="rounded-[14px] border border-[rgba(42,60,28,0.12)] bg-white p-5 shadow-sm dark:border-onextap-primary-light/25 dark:bg-onextap-night-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-onextap-dark dark:text-[#E8EFD8]">{job.title}</h3>
                    <p className="mt-1 text-sm text-onextap-secondary dark:text-[#9AB07A]">{job.company}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-onextap-dark/70">
                      <span className="inline-flex items-center gap-1"><MapPin size={12} /> {job.location}</span>
                      <span className="inline-flex items-center gap-1"><Calendar size={12} /> {job.postedDaysAgo}d ago</span>
                      <span className="inline-flex items-center gap-1"><Flag size={12} /> {job.seniority}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                      job.category === 'Strong Match'
                        ? 'bg-emerald-100 text-emerald-700'
                        : job.category === 'Good Match'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {job.category}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-onextap-dark dark:text-[#E8EFD8]">{job.finalScore}% fit</p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-onextap-secondary dark:text-[#9AB07A]">
                  {Array.isArray(job.reasons) && job.reasons.length ? job.reasons.join(' • ') : 'Potentially relevant based on profile match.'}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedJob((prev) => (prev?.id === job.id ? null : job))}
                    className="rounded-lg border border-onextap-primary/30 px-3 py-1.5 text-xs font-semibold text-onextap-primary hover:bg-onextap-primary/10"
                  >
                    {selectedJob?.id === job.id ? 'Hide Match Details' : 'View Match Details'}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSaveJob(job.id)}
                    className="rounded-lg border border-onextap-primary/30 px-3 py-1.5 text-xs font-semibold text-onextap-primary hover:bg-onextap-primary/10"
                  >
                    {savedJobIds.includes(job.id) ? 'Saved' : 'Save Job'}
                  </button>
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-onextap-dark px-3 py-1.5 text-xs font-semibold text-white hover:bg-onextap-dark/90"
                  >
                    Open Job <ExternalLink size={12} />
                  </a>
                  <button
                    type="button"
                    onClick={() => handleQuickApply(job)}
                    className="rounded-lg bg-onextap-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-onextap-primary-dark"
                  >
                    Quick Apply
                  </button>
                  <select
                    value={getApplicationStatus(job.id)}
                    onChange={(e) => trackApplicationStatus(job, e.target.value)}
                    className="rounded-lg border border-onextap-primary/30 bg-white px-2 py-1.5 text-xs focus:outline-none focus:border-onextap-primary"
                  >
                    <option value="">Track status</option>
                    <option value="saved">Saved</option>
                    <option value="in_progress">In progress</option>
                    <option value="applied">Applied</option>
                    <option value="interview">Interview</option>
                    <option value="offer">Offer</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
                {selectedJob?.id === job.id && (
                  <div className="mt-4 rounded-xl border border-onextap-primary/20 bg-onextap-primary/5 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-onextap-dark/60">Match Breakdown</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div>Required skills: <span className="font-semibold">{job.subScores?.requiredSkill ?? 0}</span></div>
                      <div>Preferred skills: <span className="font-semibold">{job.subScores?.preferredSkill ?? 0}</span></div>
                      <div>Semantic fit: <span className="font-semibold">{job.subScores?.semanticSimilarity ?? 0}</span></div>
                      <div>Experience fit: <span className="font-semibold">{job.subScores?.experienceAlignment ?? 0}</span></div>
                      <div>Seniority fit: <span className="font-semibold">{job.subScores?.seniorityFit ?? 0}</span></div>
                      <div>Domain relevance: <span className="font-semibold">{job.subScores?.domainRelevance ?? 0}</span></div>
                    </div>
                    {!!(job.missingCriticalRequirements || []).length && (
                      <p className="mt-2 text-xs text-amber-700">
                        Missing critical requirements: {(job.missingCriticalRequirements || []).join(', ')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))
        )}
      </div>

      {hiddenLowMatches > 0 && (
        <p className="text-center text-xs text-onextap-dark/55 dark:text-[#9AB07A]">
          {hiddenLowMatches} low-match jobs are hidden to keep this feed focused on competitive opportunities.
        </p>
      )}
      {!!feedSource && (
        <p className="text-center text-xs text-onextap-dark/45 dark:text-[#9AB07A]">
          Feed source: {feedSource === 'supabase' ? 'Supabase live job_openings' : 'sample fallback'}
        </p>
      )}
      {isSyncingApplications && (
        <p className="text-center text-xs text-onextap-dark/55 dark:text-[#9AB07A]">
          Syncing application tracker...
        </p>
      )}
    </div>
  );
};

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
                  console.warn("Onextap: Extension sync failed —", chrome.runtime.lastError.message);
                  resolve(false);
                } else {
                  console.log("Extension synced:", response);
                  resolve(response?.success === true);
                }
              });
            });
          } catch (e) {
            console.warn("Onextap: Extension sync error", e);
          }
        } else {
          console.warn("Onextap: Extension ID not available, skipping extension sync");
        }
      }
  
      setStatus(syncOk ? 'Saved & Synced!' : 'Saved');
      showToast?.(syncOk ? 'Saved successfully' : 'Saved (sync to extension failed)', 'success');
    } catch (error) {
      console.error("Save failed:", error);
      setStatus('Error saving');
      showToast?.('Error saving', 'error');
    }
    
    setTimeout(() => setStatus(''), 4000);
  };

  // --- RESUME PARSING LOGIC ---
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsParsing(true);
    setStatus('Parsing resume...');

    try {
      const base64 = await fileToBase64(file);
      const isImage = file.type.startsWith('image/');
      const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const token = await getAccessToken();
      if (!token) {
        setStatus('Error: Not authenticated. Please sign in first.');
        setIsParsing(false);
        return;
      }
      if (API_URL) {
        const meRes = await fetch(`${API_URL}/api/me`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!meRes.ok) {
          const meBody = await meRes.json().catch(() => ({}));
          setStatus(`Error: Session token rejected (${meBody.error || meRes.status}). Please sign out and sign in again.`);
          setIsParsing(false);
          return;
        }
      }
      
      // Send message to extension using extension ID (required when dashboard is external)
      if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        setStatus('Error: Chrome runtime not available. Make sure the extension is installed.');
        setIsParsing(false);
        return;
      }
      
      const extId = getExtensionId();
      if (!extId) {
        setStatus('Error: Extension ID not available. Open the dashboard from the extension popup (Dashboard button) to link it.');
        setIsParsing(false);
        return;
      }
      
      console.log('Onextap: Sending resume parse request to extension:', extId);
      chrome.runtime.sendMessage(extId, {
        action: "PARSE_RESUME",
        data: {
          fileData: base64,
          fileName: file.name,
          fileType: file.type,
          isImage: isImage,
          isPDF: isPDF,
          token
        }
      }, async (response) => {
        if (chrome.runtime.lastError) {
          console.error("Onextap: Runtime error:", chrome.runtime.lastError);
          setStatus('Error: ' + chrome.runtime.lastError.message + '. Make sure the extension is installed and reloaded.');
          setIsParsing(false);
          return;
        }
        
        if (!response) {
          setStatus('Error: No response from extension. Make sure the extension is installed and reloaded.');
          setIsParsing(false);
          return;
        }
        
        if (!response.success || !response.data) {
          const debug = response?.debug
            ? ` [debug: ${JSON.stringify(response.debug)}]`
            : '';
          setStatus('Error: ' + (response?.error || 'Parse failed') + debug);
          setIsParsing(false);
          return;
        }

        const extracted = response.data;

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
        setStatus('Resume parsed!');
        setIsParsing(false);
        showToast?.('Resume parsed successfully', 'success');
        setTimeout(() => setStatus(''), 3000);
      });
    } catch (error) {
      console.error("Onextap: File upload error:", error);
      setStatus('Error: ' + (error.message || 'Failed to read file. Please try again.'));
      setIsParsing(false);
    }
  };

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const base64 = reader.result.split(',')[1];
            if (!base64) {
              reject(new Error('Failed to convert file to base64'));
            } else {
              resolve(base64);
            }
          } catch (e) {
            reject(new Error('Failed to process file data: ' + e.message));
          }
        };
        reader.onerror = (error) => {
          reject(new Error('File read error: ' + (error.message || 'Unknown error')));
        };
        reader.readAsDataURL(file);
      } catch (error) {
        reject(new Error('Failed to read file: ' + error.message));
      }
    });
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
              <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleFileUpload} className="hidden" id="resume-upload" />
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
          <label className="block text-sm font-bold text-onextap-dark mb-3 flex items-center gap-2"><ExternalLink size={16} /> Links</label>
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

// Timeout for AI so it doesn't hang forever (seconds)
const PUTER_AI_TIMEOUT_SEC = 90;
const EXTENSION_SCRAPE_TIMEOUT_MS = 10000;
const CREDIT_API_TIMEOUT_MS = 10000;

const withTimeout = (promise, ms, message) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);

// --- VAULT PAGE (Answer Improver - Anthropic AI via backend) ---
const VaultPage = ({ showToast, user }) => {
  const normalizeVaultItems = (items = []) =>
    (Array.isArray(items) ? items : []).map((item) => ({
      ...item,
      aiImprovementsLeft: Number.isFinite(Number(item?.aiImprovementsLeft))
        ? Math.max(0, Number(item.aiImprovementsLeft))
        : 0,
    }));

  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [tempItem, setTempItem] = useState({ question: '', answer: '' });
  const [activeVaultItemId, setActiveVaultItemId] = useState(null);
  const [manualCompany, setManualCompany] = useState('');
  const [manualJobDescription, setManualJobDescription] = useState('');
  const [answerStyle, setAnswerStyle] = useState('balanced');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [hasAutoGeneratedOnce, setHasAutoGeneratedOnce] = useState(false);
  const [remainingImprovements, setRemainingImprovements] = useState(0);
  const [credits, setCredits] = useState(null);
  const [creditsError, setCreditsError] = useState(null);
  const [premiumStatus, setPremiumStatus] = useState(false);
  const hasChrome = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage;

  const syncProfileToExtension = async (profilePayload) => {
    if (!hasChrome) return;
    const extId = getExtensionId();
    if (!extId) return;
    await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        extId,
        {
          type: 'ONEXTAP_SYNC_DATA',
          payload: profilePayload,
        },
        () => {
          // Keep UI responsive even if extension sync fails.
          resolve();
        }
      );
    });
  };

  const loadCredits = async () => {
    setCreditsError(null);
    try {
      const isPrem = await creditManager.isPremium();
      setPremiumStatus(isPrem);
      const { credits: c, error } = await creditManager.getCreditsWithStatus();
      if (error) {
        setCreditsError(error);
        setCredits(null);
      } else {
        setCredits(isPrem ? Infinity : (c ?? 0));
      }
    } catch (e) {
      setCreditsError(e?.message || 'Failed to load credits');
      setCredits(null);
    }
  };

  useEffect(() => {
    const load = async () => {
      await loadProfileStore();
      const saved = await getActiveLegacyProfile();
      if (saved) {
        setProfile({
          ...DEFAULT_PROFILE,
          ...saved,
          vault: normalizeVaultItems(saved.vault ?? DEFAULT_PROFILE.vault),
        });
      }
      await loadCredits();
    };
    load();
  }, []);

  const saveVault = async (newVault) => {
    const newProfile = { ...profile, vault: normalizeVaultItems(newVault) };
    setProfile(newProfile);
    await saveLegacyUserProfile(newProfile);
    await syncProfileToExtension(newProfile);
    setTempItem({ question: '', answer: '' });
    setActiveVaultItemId(null);
    setHasAutoGeneratedOnce(false);
    setRemainingImprovements(0);
  };

  const handleAdd = () => {
    const q = (tempItem.question || '').trim();
    const a = (tempItem.answer || '').trim();
    const qLower = q.toLowerCase();
    const aLower = a.toLowerCase();
    const isDuplicate = (profile.vault || []).some(
      (item) =>
        (item.question || '').trim().toLowerCase() === qLower ||
        (item.answer || '').trim().toLowerCase() === aLower
    );
    if (!activeVaultItemId && isDuplicate) {
      showToast?.('Answer exists', 'error');
      return;
    }
    if (activeVaultItemId) {
      const updatedVault = (profile.vault || []).map((item) =>
        item.id === activeVaultItemId
          ? {
              ...item,
              question: q,
              answer: a,
              aiImprovementsLeft: premiumStatus ? 0 : remainingImprovements,
            }
          : item
      );
      saveVault(updatedVault);
      showToast?.('Saved changes', 'success');
      return;
    }
    saveVault([
      ...(profile.vault || []),
      {
        id: Date.now(),
        question: q,
        answer: a,
        aiImprovementsLeft: premiumStatus ? 0 : remainingImprovements,
      },
    ]);
    showToast?.('Added to vault', 'success');
  };

  const loadVaultItemToEditor = (item) => {
    setActiveVaultItemId(item.id);
    setTempItem({
      question: String(item.question || ''),
      answer: String(item.answer || ''),
    });
    setRemainingImprovements(premiumStatus ? 0 : Math.max(0, Number(item.aiImprovementsLeft || 0)));
    setHasAutoGeneratedOnce(true);
    setGenerateError('');
    showToast?.('Loaded saved answer into editor', 'success');
  };

  const persistActiveItemState = async (nextAnswer, nextImprovements) => {
    if (!activeVaultItemId) return;
    const updatedVault = (profile.vault || []).map((item) =>
      item.id === activeVaultItemId
        ? {
            ...item,
            answer: nextAnswer,
            aiImprovementsLeft: premiumStatus ? 0 : Math.max(0, Number(nextImprovements || 0)),
          }
        : item
    );
    const newProfile = { ...profile, vault: normalizeVaultItems(updatedVault) };
    setProfile(newProfile);
    await saveLegacyUserProfile(newProfile);
    await syncProfileToExtension(newProfile);
  };

  const sendToExtension = (action, payload = {}) =>
    new Promise((resolve, reject) => {
      if (!hasChrome) return reject(new Error('Extension context not available'));
      const msg = { action, ...payload };
      const cb = (res) => {
        if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(res);
      };
      const id = getExtensionId();
      if (id) chrome.runtime.sendMessage(id, msg, cb);
      else chrome.runtime.sendMessage(msg, cb);
    });

  const handleImproveWithAI = async () => {
    const q = (tempItem.question || '').trim();
    if (!q) {
      setGenerateError('Enter a question first.');
      return;
    }

    let latestCredits = credits;
    if (!premiumStatus && latestCredits === null) {
      try {
        const { credits: fetchedCredits, error } = await creditManager.getCreditsWithStatus();
        if (!error && Number.isFinite(fetchedCredits)) {
          latestCredits = fetchedCredits;
          setCredits(fetchedCredits);
        }
      } catch {
        // Fall through; normal generation flow will still show server errors if any.
      }
    }
    const consumesCredit = !premiumStatus && remainingImprovements <= 0;
    if (consumesCredit && Number(latestCredits || 0) <= 0) {
      setGenerateError('No credits remaining.');
      showToast?.('No credits remaining. Upgrade to continue.', 'error');
      return;
    }

    setIsGenerating(true);
    setGenerateError('');
    showToast?.('AI is thinking...', 'loading');

    try {
      // Get job context from extension (SCRAPE_ACTIVE_TAB)
      let company = '';
      let description = '';
      if (hasChrome) {
        try {
          const scrapeRes = await withTimeout(
            sendToExtension('SCRAPE_ACTIVE_TAB'),
            EXTENSION_SCRAPE_TIMEOUT_MS,
            'Timed out reading job listing from extension. Try again.'
          );
          if (scrapeRes?.success && scrapeRes?.context) {
            company = scrapeRes.context.company || '';
            description = scrapeRes.context.description || '';
          }
        } catch (e) {
          console.warn('Could not scrape job page:', e);
        }
      }
      const manualDescription = (manualJobDescription || '').trim();
      const manualCompanyName = (manualCompany || '').trim();
      const contextDescription = manualDescription || (description || '').trim();
      const hasJobContext = !!contextDescription;
      const jdSnippet = hasJobContext ? String(contextDescription).substring(0, 6000) : '';
      const companyName = (manualCompanyName || company || 'Not specified').trim();
      const userAnswer = (tempItem.answer || '').trim();
      const hasGeneric = userAnswer.length > 0;
      const profileSkills = (profile.skills || [])
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .slice(0, 8)
        .join(', ');
      const currentRole = [profile.currentJob?.title, profile.currentJob?.company]
        .map((v) => String(v || '').trim())
        .filter(Boolean)
        .join(' at ');
      const recentExperience = (profile.experience || [])
        .filter((ex) => (ex?.title || ex?.company))
        .slice(0, 2)
        .map((ex) => {
          const title = String(ex?.title || '').trim();
          const org = String(ex?.company || '').trim();
          return [title, org].filter(Boolean).join(' at ');
        })
        .filter(Boolean)
        .join(' | ');
      const profileLines = [
        currentRole ? `Current role: ${currentRole}` : '',
        profileSkills ? `Core skills: ${profileSkills}` : '',
        recentExperience ? `Recent experience: ${recentExperience}` : '',
      ].filter(Boolean);
      const profileContext = profileLines.length
        ? profileLines.join('\n')
        : '';
      const selectedStyleInstruction =
        ANSWER_STYLE_INSTRUCTIONS[answerStyle] || ANSWER_STYLE_INSTRUCTIONS.balanced;
      const richerLengthRule = 'Target length: 170-240 words unless the question clearly needs less.';
      const measurableImpactRule =
        'Include at least one measurable or observable impact/result. Prefer numbers/percentages/timeframes when truthful; never invent facts.';

      const jobContext = hasJobContext
        ? `${companyName ? `Company: ${companyName}\n\n` : ''}${jdSnippet}`
        : '';

      const vaultAnswers = (profile.vault || []).map((item) => ({
        question: String(item.question || ''),
        answer: String(item.answer || ''),
      }));

      let taskHint = '';
      if (hasGeneric) {
        taskHint = hasJobContext
          ? `Rewrite the candidate draft to target the job description and company. Answer the application question directly. Tone: human, natural, confident. ${richerLengthRule} First person. At least two concrete details tied to the role; weave in 2-4 phrases from the job description. ${measurableImpactRule} No filler, cliches, headings, or bullet points.`
          : `Improve the candidate draft so it is stronger and clearer. Answer the application question directly. Preserve the candidate's intent; add specificity and one concrete example or outcome. ${richerLengthRule} First person. ${measurableImpactRule} No filler, cliches, headings, or bullet points.`;
      } else {
        taskHint = hasJobContext
          ? `Write a tailored answer to the application question. Use the job description and company to ground specifics. ${richerLengthRule} First person. At least two concrete details; reflect 2-4 ideas from the job description. ${measurableImpactRule} Interview-ready, not a template. No filler, cliches, headings, or bullet points.`
          : `Write a strong, portable first-draft answer that works across employers. Target length: 160-230 words unless the question clearly needs less. First person. At least one concrete skill and one measurable or observable result. ${measurableImpactRule} Specific enough to sound real; broadly reusable. No filler, cliches, headings, or bullet points.`;
      }

      const token = await getAccessToken();
      if (!token) throw new Error('Please sign in first.');

      const requestBody = {
        question: q,
        draft: userAnswer,
        jobContext: jobContext || 'Not provided',
        vaultAnswers,
        ...(profileContext ? { profileContext } : {}),
        taskHint,
        styleHint: selectedStyleInstruction,
        model: ANSWER_STUDIO_MODEL,
      };

      const generatePromise = fetch(`${API_URL}/api/answer-vault/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
      }).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `Generation failed (${res.status})`);
        return body;
      });

      const result = await withTimeout(
        generatePromise,
        PUTER_AI_TIMEOUT_SEC * 1000,
        'AI is taking too long. Check your connection and try again.'
      );
      const improvedText = String(result?.text || '').trim();
      if (!improvedText || improvedText.includes('Error')) {
        throw new Error(improvedText || 'Failed to generate improved answer');
      }

      if (!hasJobContext) {
        showToast?.('Generated without job-page context. Open a job listing and click Improve again to tailor it.', 'error');
      } else if (manualDescription) {
        showToast?.('Generated using pasted job description context.', 'success');
      }

      setTempItem(prev => ({ ...prev, answer: improvedText }));
      setHasAutoGeneratedOnce(true);

      if (!premiumStatus) {
        let nextImprovements = remainingImprovements;
        if (consumesCredit) {
          // 1 credit purchases one generation + up to 3 subsequent improvements.
          try {
            const deductResult = await withTimeout(
              creditManager.deductCredit(),
              CREDIT_API_TIMEOUT_MS,
              'Credit update timed out after generation.'
            );
            if (!deductResult.success) {
              setGenerateError(deductResult.error || 'Answer generated, but credits could not be updated.');
              setRemainingImprovements(0);
              nextImprovements = 0;
            } else {
              setCredits(deductResult.isPremium ? Infinity : deductResult.remaining);
              setRemainingImprovements(3);
              nextImprovements = 3;
            }
          } catch (creditErr) {
            console.warn('Credit deduction failed after generation:', creditErr);
            setGenerateError('Answer generated, but credit update failed. Please refresh credits.');
            setRemainingImprovements(0);
            nextImprovements = 0;
          }
        } else {
          nextImprovements = Math.max(0, remainingImprovements - 1);
          setRemainingImprovements(nextImprovements);
        }
        try {
          await persistActiveItemState(improvedText, nextImprovements);
        } catch (persistErr) {
          console.warn('Could not persist AI improvement balance:', persistErr);
        }
      }

      showToast?.('AI answer generated!', 'success');
    } catch (e) {
      setGenerateError(e?.message || 'Something went wrong.');
      showToast?.(e?.message || 'AI generation failed', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const canImprove = !!user && !!tempItem.question?.trim();

  const reloadVaultProfile = async () => {
    const saved = await getActiveLegacyProfile();
    if (saved) {
      setProfile({
        ...DEFAULT_PROFILE,
        ...saved,
        vault: normalizeVaultItems(saved.vault ?? DEFAULT_PROFILE.vault),
      });
    }
  };

  return (
    <div className="animate-fade-in max-w-3xl mx-auto space-y-6">
      <ProfileSwitcher onProfileChange={reloadVaultProfile} />
      {/* Header card */}
      <div className="bg-white/80 backdrop-blur-sm rounded-3xl border border-onextap-primary/15 p-8 shadow-lg shadow-onextap-dark/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-onextap-primary/10 to-transparent rounded-full blur-2xl" />
        
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-bold text-2xl text-onextap-dark tracking-tight mb-1">Answer Studio</h2>
              <p className="text-onextap-dark/60 text-sm">Create and improve your job application answers</p>
            </div>
            <div className="flex items-center gap-2">
              {/* Credits badge */}
              {credits !== null && (
                <div className={`flex items-center gap-1.5 px-3 py-2 rounded-2xl text-sm font-medium border shadow-sm ${
                  premiumStatus 
                    ? 'bg-gradient-to-r from-amber-50 to-amber-100/50 text-amber-700 border-amber-200'
                    : credits === 0 
                      ? 'bg-red-50 text-red-600 border-red-200'
                      : 'bg-onextap-primary/10 text-onextap-dark border-onextap-primary/20'
                }`}>
                  {premiumStatus ? (
                    <><Crown size={14} /> Premium</>
                  ) : (
                    <><Zap size={14} /> {credits} credits left</>
                  )}
                </div>
              )}
              {user && !premiumStatus && (
                <div className="flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-medium bg-gradient-to-r from-onextap-primary/15 to-onextap-primary/5 text-onextap-primary border border-onextap-primary/25 shadow-sm">
                  <Sparkles size={14} />
                  Standard AI
                </div>
              )}
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-white to-onextap-bg-light p-6 rounded-2xl border border-onextap-primary/15 shadow-sm">
            <input 
              className="w-full px-4 py-3 mb-3 border border-onextap-primary/20 rounded-xl text-sm bg-white/80 focus:outline-none focus:border-onextap-primary/40 focus:ring-2 focus:ring-onextap-primary/10 transition-all placeholder:text-onextap-dark/40" 
              placeholder="Question (e.g. Why do you want to work here?)"
              value={tempItem.question}
              onChange={e => {
                setTempItem({ ...tempItem, question: e.target.value });
                setGenerateError('');
                if (!activeVaultItemId) {
                  setHasAutoGeneratedOnce(false);
                  setRemainingImprovements(0);
                }
              }}
            />
            <input
              className="w-full px-4 py-3 mb-3 border border-onextap-primary/20 rounded-xl text-sm bg-white/80 focus:outline-none focus:border-onextap-primary/40 focus:ring-2 focus:ring-onextap-primary/10 transition-all placeholder:text-onextap-dark/40"
              placeholder="Company (optional, manual override)"
              value={manualCompany}
              onChange={e => { setManualCompany(e.target.value); setGenerateError(''); }}
            />
            <textarea
              className="w-full px-4 py-3 mb-3 border border-onextap-primary/20 rounded-xl text-sm h-24 bg-white/80 focus:outline-none focus:border-onextap-primary/40 focus:ring-2 focus:ring-onextap-primary/10 transition-all resize-none placeholder:text-onextap-dark/40"
              placeholder="Paste job description here (optional). If provided, this is used for tailoring."
              value={manualJobDescription}
              onChange={e => { setManualJobDescription(e.target.value); setGenerateError(''); }}
            />
            <select
              className="w-full px-4 py-3 mb-3 border border-onextap-primary/20 rounded-xl text-sm bg-white/80 focus:outline-none focus:border-onextap-primary/40 focus:ring-2 focus:ring-onextap-primary/10 transition-all"
              value={answerStyle}
              onChange={e => { setAnswerStyle(e.target.value); setGenerateError(''); }}
            >
              {ANSWER_STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <textarea 
              className="w-full px-4 py-3 border border-onextap-primary/20 rounded-xl text-sm h-28 bg-white/80 focus:outline-none focus:border-onextap-primary/40 focus:ring-2 focus:ring-onextap-primary/10 transition-all resize-none placeholder:text-onextap-dark/40" 
              placeholder="Your answer (optional). Click Improve to generate or refine with AI."
              value={tempItem.answer}
              onChange={e => setTempItem({...tempItem, answer: e.target.value})}
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button 
                disabled={!tempItem.question || !tempItem.answer}
                onClick={handleAdd}
                className="bg-onextap-dark text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-onextap-dark/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-md shadow-onextap-dark/20 hover:shadow-lg transition-all duration-200"
              >
                <Plus size={16} /> Add to Vault
              </button>
              <button 
                type="button"
                disabled={!canImprove || isGenerating}
                onClick={handleImproveWithAI}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 bg-gradient-to-r from-onextap-primary/15 to-onextap-primary/5 text-onextap-dark border border-onextap-primary/25 hover:from-onextap-primary/25 hover:to-onextap-primary/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm"
              >
                {isGenerating ? <Activity className="animate-spin" size={16} /> : <Sparkles size={16} />}
                {isGenerating
                  ? (tempItem.answer?.trim() ? 'Improving…' : 'Generating…')
                  : (!tempItem.answer?.trim() ? 'Generate answer' : hasAutoGeneratedOnce ? 'Improve answer' : 'Generate answer')}
              </button>
              <span className="text-xs text-onextap-dark/50">
                Mode: {premiumStatus ? 'High Quality (Premium)' : 'Standard (Faster)'}
              </span>
              {!premiumStatus && (
                <span className="text-xs text-onextap-dark/50">
                  Free improvements left on this answer: {remainingImprovements}
                </span>
              )}
            </div>
            <div className="mt-3 text-xs text-onextap-dark/55 bg-onextap-primary/5 px-3 py-2 rounded-lg border border-onextap-primary/15">
              Credit rules: 1 credit generates 1 answer and includes 3 free improvements for that saved answer. Free improvements persist per saved answer across page reloads.
            </div>
            {creditsError && (
              <div className="mt-3 text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
                Couldn't load credits: {creditsError}
                <p className="text-xs mt-1">
                  Check the message above, then: server running (<code className="text-[11px]">npm run dev</code> in <code className="text-[11px]">server/</code>),
                  <code className="text-[11px]"> VITE_API_URL</code> pointing at it, and <code className="text-[11px]">SUPABASE_URL</code> + <code className="text-[11px]">SUPABASE_SERVICE_ROLE_KEY</code> in <code className="text-[11px]">server/.env</code>.
                </p>
                <button onClick={loadCredits} className="mt-2 text-sm font-medium text-amber-800 underline hover:no-underline">Try again</button>
              </div>
            )}
            {generateError && <p className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{generateError}</p>}
            {hasChrome && (
              <p className="mt-3 text-xs text-onextap-dark/50 bg-onextap-primary/5 px-3 py-2 rounded-lg">
                <Sparkles size={10} className="inline mr-1" />
                AI uses pasted JD first, otherwise it tries current/recent job tabs and your saved profile strengths.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Saved answers */}
      {profile.vault && profile.vault.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-bold text-lg text-onextap-dark px-1">Saved Answers ({profile.vault.length})</h3>
          <div className="space-y-3">
            {profile.vault.map(item => (
              <div key={item.id} className="bg-white/70 backdrop-blur-sm border border-onextap-primary/15 rounded-2xl p-5 relative group hover:bg-white/90 hover:shadow-md transition-all duration-200">
                <button 
                  onClick={() => saveVault(profile.vault.filter(i => i.id !== item.id))} 
                  className="absolute top-4 right-4 p-2 text-onextap-dark/30 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={16} />
                </button>
                <h4 className="font-bold text-onextap-dark text-sm mb-2 pr-10">{item.question}</h4>
                <p className="text-onextap-dark/60 text-sm leading-relaxed">{item.answer}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  {!premiumStatus && (
                    <span className="text-xs text-onextap-dark/50">
                      Free improvements left: {Math.max(0, Number(item.aiImprovementsLeft || 0))}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => loadVaultItemToEditor(item)}
                    className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-onextap-primary/20 text-onextap-primary hover:bg-onextap-primary/10 transition-colors"
                  >
                    Use in editor
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// --- ACCOUNT SETTINGS MODAL ---
const AccountSettingsModal = ({ isOpen, onClose, user, onSignOut, onOpenPremiumModal }) => {
  const [credits, setCredits] = useState(null);
  const [creditsError, setCreditsError] = useState(null);
  const [isPremium, setIsPremium] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [isManagingSubscription, setIsManagingSubscription] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadAccountData();
      setDeleteConfirm('');
      setDeleteError('');
    }
  }, [isOpen]);

  const loadAccountData = async () => {
    setIsLoading(true);
    setCreditsError(null);
    try {
      const premiumStatus = await creditManager.verifyPremium();
      setIsPremium(premiumStatus);
      const { credits: c, error } = await creditManager.getCreditsWithStatus();
      if (error) {
        setCreditsError(error);
        setCredits(null);
      } else {
        setCredits(premiumStatus ? Infinity : (c ?? 0));
      }
    } catch (error) {
      console.error('Error loading account data:', error);
      setCreditsError(error?.message || 'Failed to load credits');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE') {
      setDeleteError('Please type DELETE to confirm');
      return;
    }

    setIsDeleting(true);
    setDeleteError('');

    try {
      // Clear local storage
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          await new Promise((resolve) => {
            chrome.storage.local.clear(() => resolve());
          });
        } else {
          localStorage.clear();
        }
      } catch (err) {
        console.warn('Failed to clear local storage:', err);
      }

      // Sign out via Supabase
      await supaSignOut();
      onClose();
      if (onSignOut) onSignOut();
      
      // Reload page to reset state
      window.location.reload();
    } catch (error) {
      console.error('Account deletion failed:', error);
      setDeleteError(error.message || 'Failed to delete account. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOpen) return null;

  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
  const userInitial = displayName[0]?.toUpperCase() || 'U';
  const creditsDisplay = isPremium ? '∞' : (credits !== null ? credits : '...');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-onextap-primary/20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-onextap-bg-light border-b border-onextap-primary/20 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-onextap-dark">Account Settings</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-onextap-primary/10 rounded-lg transition-colors text-onextap-dark"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* User Info Section */}
          <div className="bg-onextap-primary/5 rounded-xl p-6 border border-onextap-primary/20">
            <h3 className="text-sm font-semibold text-onextap-dark mb-4 flex items-center gap-2">
              <User size={16} className="text-onextap-primary" /> Account Information
            </h3>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-onextap-primary/20 text-onextap-primary rounded-full flex items-center justify-center font-bold text-xl border-2 border-onextap-primary/40 shrink-0">
                {userInitial}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-lg font-bold text-onextap-dark mb-0.5 truncate flex items-center gap-2">
                  {displayName}
                  {isPremium && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 bg-gradient-to-r from-amber-100 to-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                      <Crown size={11} /> Premium
                    </span>
                  )}
                </div>
                <div className="text-xs text-onextap-dark/60 mb-2 truncate">{user?.email || 'N/A'}</div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-onextap-primary/10 text-onextap-primary border border-onextap-primary/30">
                  <Shield size={12} />
                  Authenticated
                </div>
              </div>
            </div>
          </div>

          {/* Credits Section */}
          <div className="bg-onextap-primary/5 rounded-xl p-6 border border-onextap-primary/20">
            <h3 className="text-sm font-semibold text-onextap-dark mb-4 flex items-center gap-2">
              <Sparkles size={16} className="text-onextap-primary" /> AI Credits
            </h3>
            {isLoading ? (
              <div className="flex items-center gap-2 text-onextap-dark/70">
                <Activity className="animate-spin" size={16} />
                <span>Loading...</span>
              </div>
            ) : creditsError ? (
              <div className="text-sm text-amber-700 bg-amber-50 px-3 py-3 rounded-lg border border-amber-200">
                <strong>Couldn't load credits:</strong> {creditsError}
                <p className="mt-2 text-xs text-amber-800/80">
                  Server running, <code className="text-[11px]">VITE_API_URL</code> correct, and Supabase keys in <code className="text-[11px]">server/.env</code>.
                </p>
                <button onClick={loadAccountData} className="mt-2 text-sm font-medium text-amber-800 underline hover:no-underline">Try again</button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-onextap-dark/80 font-medium">Available</span>
                  <span className="text-2xl font-bold text-onextap-dark">{isPremium ? '∞' : `${creditsDisplay} credits`}</span>
                </div>
                {isPremium ? (
                  <div className="space-y-3">
                    <div className="text-sm text-onextap-dark/80 bg-onextap-primary/10 px-3 py-2 rounded-lg border border-onextap-primary/20 flex items-center gap-2">
                      <Crown size={16} className="text-onextap-primary" />
                      Premium Account — Unlimited High-Quality AI Generations
                    </div>
                    <button
                      onClick={async () => {
                        if (!confirm('Are you sure you want to cancel your Premium subscription? You will lose access to unlimited high-quality AI generations.')) return;
                        setIsManagingSubscription(true);
                        try {
                          await creditManager.cancelSubscription();
                          window.location.reload();
                        } catch (err) {
                          console.error('Cancel error:', err);
                          setDeleteError(err.message || 'Failed to cancel subscription');
                        } finally {
                          setIsManagingSubscription(false);
                        }
                      }}
                      disabled={isManagingSubscription}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-red-300 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      {isManagingSubscription ? (
                        <><Activity className="animate-spin" size={14} /> Cancelling...</>
                      ) : (
                        <><CreditCard size={14} /> Cancel Subscription</>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm text-onextap-dark/70 flex-1">
                      {credits === 0 ? (
                        <span className="text-red-600 font-medium">No credits remaining.</span>
                      ) : (
                        <span>You have {credits} fast standard generation{credits !== 1 ? 's' : ''} remaining.</span>
                      )}
                    </div>
                    <button
                      onClick={() => { onClose(); onOpenPremiumModal?.(); }}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-onextap-primary to-onextap-primary-dark text-white hover:opacity-90 transition-opacity shadow-sm"
                    >
                      <Crown size={14} />
                      Upgrade to Premium
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Danger Zone */}
          <div className="bg-red-50/80 rounded-xl p-6 border-2 border-red-200/80">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={18} className="text-red-600" />
              <h3 className="text-sm font-semibold text-red-900">Danger Zone</h3>
            </div>
            <p className="text-sm text-red-800/90 mb-4">
              Deleting your account will permanently remove all your data including your profile, vault answers, and credits. This action cannot be undone.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-red-900 mb-2">
                  Type <span className="font-mono bg-red-100 px-2 py-1 rounded">DELETE</span> to confirm:
                </label>
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => {
                    setDeleteConfirm(e.target.value);
                    setDeleteError('');
                  }}
                  placeholder="DELETE"
                  className="w-full px-4 py-2 border-2 border-red-300 rounded-lg focus:outline-none focus:border-red-500 text-sm text-onextap-dark bg-white"
                />
              </div>
              {deleteError && (
                <p className="text-sm text-red-600">{deleteError}</p>
              )}
              <button
                onClick={handleDeleteAccount}
                disabled={deleteConfirm !== 'DELETE' || isDeleting}
                className="w-full bg-red-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <Activity className="animate-spin" size={16} />
                    Deleting Account...
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    Delete My Account
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-onextap-bg-light border-t border-onextap-primary/20 px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-onextap-dark hover:bg-onextap-primary/10 rounded-lg font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};


// --- PROFILE SWITCHER (Feature 1) ---
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

  const refresh = useCallback(async () => {
    const next = await loadProfileStore();
    setStore(next);
    onProfileChange?.(next);
    return next;
  }, [onProfileChange]);

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

// --- WHAT TO FILL (Feature 3) ---
const WhatToFillSection = ({ detectedSections, sectionToggles, setSectionToggles, hasCoverLetterTemplates }) => {
  const [expanded, setExpanded] = useState(false);

  const visibleSections = AUTOFILL_SECTION_META.filter((s) => {
    if (s.key === 'coverLetter') {
      return detectedSections.coverLetter && hasCoverLetterTemplates;
    }
    return detectedSections[s.key];
  });

  const enabledCount = visibleSections.filter((s) => sectionToggles[s.key]).length;
  const totalCount = visibleSections.length;

  const setAll = (value) => {
    const next = { ...sectionToggles };
    visibleSections.forEach((s) => { next[s.key] = value; });
    setSectionToggles(next);
  };

  if (totalCount === 0) return null;

  return (
    <div className="rounded-xl border border-onextap-primary/15 bg-white/80 dark:bg-onextap-night-card dark:border-onextap-primary-light/20">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-onextap-dark dark:text-[#E8EFD8]"
      >
        <span>What to fill</span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {expanded && (
        <div className="border-t border-onextap-primary/10 px-3 py-2.5 space-y-2">
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={() => setAll(true)} className="text-onextap-primary font-medium hover:underline">Select all</button>
            <button type="button" onClick={() => setAll(false)} className="text-onextap-dark/50 font-medium hover:underline dark:text-[#9AB07A]">Deselect all</button>
          </div>
          {visibleSections.map((s) => (
            <label key={s.key} className={`flex items-center gap-2.5 cursor-pointer text-sm ${sectionToggles[s.key] ? 'text-onextap-dark dark:text-[#E8EFD8]' : 'text-onextap-dark/40 line-through dark:text-[#9AB07A]/60'}`}>
              <input
                type="checkbox"
                checked={!!sectionToggles[s.key]}
                onChange={(e) => setSectionToggles((prev) => ({ ...prev, [s.key]: e.target.checked }))}
                className="rounded border-onextap-primary/30 text-onextap-primary focus:ring-onextap-primary/30"
              />
              <span>{s.icon}</span>
              <span>{s.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

// --- COVER LETTER (Feature 2) ---
const CoverLetterPanel = ({ showToast, user, compact = false }) => {
  const [coverLetters, setCoverLetters] = useState([]);
  const [activeTemplateId, setActiveTemplateId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [originalText, setOriginalText] = useState('');
  const [suggestionText, setSuggestionText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [hasJobDescription, setHasJobDescription] = useState(false);
  const [coverFieldDetected, setCoverFieldDetected] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [addingTemplate, setAddingTemplate] = useState(false);
  const saveDebounceRef = useRef(null);
  const hasChrome = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage;

  const loadTemplates = useCallback(async () => {
    const store = await loadProfileStore();
    const active = store.profiles[store.activeProfileId];
    const templates = active?.coverLetters || [];
    setCoverLetters(templates);
    if (templates.length && !activeTemplateId) {
      setActiveTemplateId(templates[0].id);
      setOriginalText(templates[0].body || '');
    }
  }, [activeTemplateId]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  useEffect(() => {
    const checkPage = async () => {
      if (!hasChrome) return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch { /* restricted page */ }
      chrome.tabs.sendMessage(tab.id, { action: 'SCRAPE_CONTEXT' }, (ctxRes) => {
        const desc = ctxRes?.context?.description || '';
        setHasJobDescription(desc.trim().length > 100);
      });
      chrome.tabs.sendMessage(tab.id, { action: 'DETECT_SECTIONS', profile: {} }, (detRes) => {
        setCoverFieldDetected(!!detRes?.sections?.coverLetter);
      });
    };
    checkPage();
  }, [hasChrome]);

  const persistTemplates = async (templates) => {
    setCoverLetters(templates);
    await updateActiveProfileData({ coverLetters: templates });
  };

  const debouncedSaveBody = (templateId, body) => {
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(async () => {
      const store = await loadProfileStore();
      const active = store.profiles[store.activeProfileId];
      const current = active?.coverLetters || [];
      const next = current.map((t) => (t.id === templateId ? { ...t, body } : t));
      await persistTemplates(next);
    }, 500);
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

  const sendToExtension = (action, payload = {}) =>
    new Promise((resolve, reject) => {
      if (!hasChrome) return reject(new Error('Extension not available'));
      const cb = (res) => {
        if (chrome.runtime?.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(res);
      };
      if (chrome.runtime.id) chrome.runtime.sendMessage({ action, ...payload }, cb);
      else chrome.runtime.sendMessage({ action, ...payload }, cb);
    });

  const handlePersonalize = async () => {
    const template = coverLetters.find((t) => t.id === activeTemplateId);
    if (!template?.body?.trim()) {
      setGenerateError('Add a cover letter template first.');
      return;
    }
    if (!user) {
      setGenerateError('Sign in to use AI personalization.');
      return;
    }

    setIsGenerating(true);
    setGenerateError('');
    setSuggestionText('');
    setOriginalText(template.body);

    try {
      let company = '';
      let description = '';
      if (hasChrome) {
        const scrapeRes = await sendToExtension('SCRAPE_ACTIVE_TAB');
        if (scrapeRes?.success && scrapeRes?.context) {
          company = scrapeRes.context.company || '';
          description = scrapeRes.context.description || '';
        }
      }
      if (!description?.trim()) {
        setGenerateError('Open a job posting to personalize.');
        setIsGenerating(false);
        return;
      }

      const token = await getAccessToken();
      if (!token) throw new Error('Please sign in first.');

      const jdSnippet = String(description).substring(0, 6000);
      const taskHint = `Rewrite the cover letter template for this specific job. Preserve the candidate's writing style and voice — do not make it generic. Reference the company and role by name. Weave in 2-4 key requirements from the job description. Keep length within ±10% of the original. First person. No headings or bullet points.`;

      const res = await fetch(`${API_URL}/api/answer-vault/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          question: 'Cover letter for this job application',
          draft: template.body,
          jobContext: `${company ? `Company: ${company}\n\n` : ''}${jdSnippet}`,
          taskHint,
          styleHint: ANSWER_STYLE_INSTRUCTIONS.balanced,
          model: ANSWER_STUDIO_MODEL,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Generation failed (${res.status})`);

      const text = String(body?.text || '').trim();
      if (!text) throw new Error('Empty response from AI');
      setSuggestionText(text);

      const next = coverLetters.map((t) =>
        t.id === template.id ? { ...t, lastUsed: new Date().toISOString() } : t
      );
      await persistTemplates(next);
      showToast?.('Cover letter personalized', 'success');
    } catch (e) {
      setGenerateError(e?.message || 'AI generation failed');
      showToast?.(e?.message || 'Generation failed', 'error');
    } finally {
      setIsGenerating(false);
    }
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

  const handleAutofillSuggestion = async () => {
    if (!suggestionText || !hasChrome) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      chrome.tabs.sendMessage(tab.id, { action: 'FILL_COVER_LETTER', text: suggestionText }, (res) => {
        if (res?.success) showToast?.('Cover letter filled', 'success');
        else showToast?.('No cover letter field found', 'error');
      });
    } catch {
      showToast?.('Cannot access this page', 'error');
    }
  };

  const activeTemplate = coverLetters.find((t) => t.id === activeTemplateId);

  return (
    <div className={`space-y-4 ${compact ? '' : 'max-w-3xl mx-auto'}`}>
      {coverLetters.length === 0 && !addingTemplate ? (
        <div className="rounded-2xl border border-dashed border-onextap-primary/25 bg-white/70 p-6 text-center dark:bg-onextap-night-card">
          <FileText size={28} className="mx-auto mb-2 text-onextap-primary/60" />
          <p className="text-sm text-onextap-dark/70 dark:text-[#9AB07A] mb-3">Add a cover letter template to get started.</p>
          <button type="button" onClick={() => setAddingTemplate(true)} className="rounded-xl bg-onextap-primary px-4 py-2 text-sm font-semibold text-white">
            Add template
          </button>
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
                    }}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="text-sm font-semibold text-onextap-dark dark:text-[#E8EFD8]">{t.name}</p>
                    <p className="text-xs text-onextap-dark/50 truncate dark:text-[#9AB07A]">{(t.body || '').slice(0, 60)}{(t.body || '').length > 60 ? '…' : ''}</p>
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
                      placeholder="Paste your base cover letter…"
                    />
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
            <button type="button" onClick={() => setAddingTemplate(true)} className="text-sm font-medium text-onextap-primary flex items-center gap-1"><Plus size={14} /> Add template</button>
          )}

          <div className="relative">
            <button
              type="button"
              disabled={!hasJobDescription || !activeTemplate?.body?.trim() || isGenerating || !user}
              onClick={handlePersonalize}
              title={!hasJobDescription ? 'Open a job posting to personalize.' : undefined}
              className="w-full rounded-xl bg-gradient-to-br from-onextap-primary to-onextap-primary-dark py-3 text-sm font-bold text-white shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? 'Personalizing…' : 'Personalize for this job'}
            </button>
            {!hasJobDescription && (
              <p className="mt-1 text-[11px] text-onextap-dark/45 text-center dark:text-[#9AB07A]">Open a job posting to personalize.</p>
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
                    <button type="button" onClick={handleCopySuggestion} className="flex items-center gap-1 rounded-lg border border-onextap-primary/20 px-3 py-1.5 text-xs font-medium"><Copy size={12} /> Copy</button>
                    {coverFieldDetected && (
                      <button type="button" onClick={handleAutofillSuggestion} className="flex items-center gap-1 rounded-lg bg-onextap-dark px-3 py-1.5 text-xs font-medium text-white">Use this</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

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

const CoverLetterPage = ({ showToast, user }) => {
  const [panelKey, setPanelKey] = useState(0);
  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <ProfileSwitcher onProfileChange={() => setPanelKey((k) => k + 1)} />
      </div>
      <div className="bg-white/80 backdrop-blur-sm rounded-3xl border border-onextap-primary/15 p-8 shadow-lg">
        <h2 className="font-bold text-2xl text-onextap-dark tracking-tight mb-1">Cover Letter</h2>
        <p className="text-onextap-dark/60 text-sm mb-6">Save templates per profile and personalize them with AI for each job.</p>
        <CoverLetterPanel key={panelKey} showToast={showToast} user={user} />
      </div>
    </div>
  );
};

// --- POPUP VIEW (Landing - Animated, two states: signed-in vs onboarding) ---
const PopupView = ({ onLaunchDashboard, onLaunchAnswerStudio }) => {
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
    const { data: { subscription } } = onAuthStateChange((_, session) => {
      setPopupUser(session?.user || null);
    });
    return () => subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await loadProfileStore();
      const profile = await refreshProfileState();
      if (mounted) {
        setChecking(false);
        if (profile) await detectSectionsOnPage(profile);
      }
    })();
    return () => { mounted = false; };
  }, [refreshProfileState, detectSectionsOnPage]);

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
        console.error('Onextap: Failed to inject content script:', err);
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
          <ProfileSwitcher compact onProfileChange={async () => {
            const profile = await refreshProfileState();
            setCoverPanelKey((k) => k + 1);
            if (profile) detectSectionsOnPage(profile);
          }} />
        )}
        {hasProfile && (
          <div className="flex gap-1 rounded-xl bg-white/60 p-1 dark:bg-onextap-night-card">
            {[
              { id: 'autofill', label: 'Autofill', icon: Clipboard },
              { id: 'answers', label: 'Saved Answers', icon: MessageSquare },
              { id: 'cover', label: 'Cover Letter', icon: FileText },
            ].map((t) => (
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
              <CoverLetterPanel key={coverPanelKey} showToast={showPopupToast} user={popupUser} compact />
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

const PublicLandingPage = ({
  authMode,
  setAuthMode,
  authName,
  setAuthName,
  authEmail,
  setAuthEmail,
  authPassword,
  setAuthPassword,
  showPassword,
  setShowPassword,
  passwordStrength,
  setPasswordStrength,
  authError,
  isSigningIn,
  handleSignIn,
  handleGoogleSignIn,
  onOpenPremiumModal
}) => {
  const [openFaq, setOpenFaq] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('onextap_dark_mode');
      if (stored !== null) return stored === 'true';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('onextap_dark_mode', darkMode);
  }, [darkMode]);

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMobileMenuOpen(false);
  };

  const toggleFaq = (i) => setOpenFaq(openFaq === i ? null : i);

  useEffect(() => {
    const revealEls = document.querySelectorAll('.reveal, .reveal-scale, .reveal-left');
    if (!revealEls.length) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); obs.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });
    revealEls.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  });

  return (
    <div className="w-full min-h-screen relative overflow-x-hidden bg-onextap-cream text-onextap-dark transition-colors duration-300 dark:bg-onextap-night dark:text-[#E8EFD8]">
      <button
        type="button"
        onClick={() => setDarkMode(!darkMode)}
        className="fixed top-5 right-6 z-[100] hidden items-center gap-2 rounded-full border border-[rgba(42,60,28,0.25)] bg-white px-3.5 py-1.5 text-[12px] font-medium text-onextap-secondary shadow-sm transition-all hover:border-onextap-primary hover:bg-onextap-primary hover:text-white dark:border-[rgba(200,216,168,0.2)] dark:bg-onextap-night-card dark:text-[#E8EFD8] dark:hover:bg-onextap-primary-dark md:flex"
        aria-label="Toggle dark mode"
      >
        {darkMode ? <Sun size={14} /> : <Moon size={14} />}
        <span className="hidden sm:inline">{darkMode ? 'Light' : 'Dark'}</span>
      </button>

      <header className="sticky top-0 z-50 border-b border-[rgba(42,60,28,0.12)] bg-onextap-cream/92 backdrop-blur-xl transition-colors dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night/92">
        <nav className="mx-auto flex h-[68px] max-w-[1100px] items-center justify-between px-6 md:h-[72px] md:px-12">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex items-center gap-2.5 text-left"
          >
            <img src={getIconUrl()} alt="Onextap" className="h-8 w-8 shrink-0 rounded-lg shadow-sm ring-1 ring-black/[0.06] dark:ring-white/10" />
            <span className="text-[16px] font-semibold tracking-tight text-onextap-dark dark:text-[#E8EFD8]">Onextap</span>
          </button>
          <div className="hidden items-center gap-8 md:flex">
            <button type="button" onClick={() => scrollToSection('features')} className="text-[14px] font-normal text-onextap-secondary transition-colors hover:text-onextap-primary dark:text-[#9AB07A] dark:hover:text-onextap-olive-pale">
              Features
            </button>
            <button type="button" onClick={() => scrollToSection('pricing')} className="text-[14px] font-normal text-onextap-secondary transition-colors hover:text-onextap-primary dark:text-[#9AB07A] dark:hover:text-onextap-olive-pale">
              Pricing
            </button>
            <button type="button" onClick={() => scrollToSection('faq')} className="text-[14px] font-normal text-onextap-secondary transition-colors hover:text-onextap-primary dark:text-[#9AB07A] dark:hover:text-onextap-olive-pale">
              FAQ
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('auth')}
              className="rounded-md bg-onextap-primary px-5 py-2 text-[14px] font-medium text-white transition-colors hover:bg-onextap-primary-dark"
            >
              Get Extension
            </button>
          </div>
          <div className="flex items-center gap-1 md:hidden">
            <button
              type="button"
              onClick={() => setDarkMode(!darkMode)}
              className="rounded-xl p-2 text-onextap-secondary transition-colors hover:bg-black/[0.04] dark:text-[#9AB07A] dark:hover:bg-white/[0.06]"
              aria-label="Toggle dark mode"
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="rounded-xl p-2 text-onextap-secondary transition-colors hover:bg-black/[0.04] dark:text-[#9AB07A] dark:hover:bg-white/[0.06]"
              aria-label="Open menu"
            >
              {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </nav>
        {mobileMenuOpen && (
          <div className="animate-fade-in border-b border-[rgba(42,60,28,0.12)] bg-onextap-cream/98 backdrop-blur-xl dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night/98">
            <div className="space-y-1 px-6 py-4">
              {[
                { id: 'features', label: 'Features' },
                { id: 'pricing', label: 'Pricing' },
                { id: 'faq', label: 'FAQ' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToSection(item.id)}
                  className="w-full rounded-xl px-4 py-3 text-left text-[15px] font-medium text-onextap-secondary transition-colors hover:bg-black/[0.04] hover:text-onextap-primary dark:text-[#E8EFD8]/80 dark:hover:bg-white/[0.06]"
                >
                  {item.label}
                </button>
              ))}
              <div className="mt-2 space-y-1 border-t border-[rgba(42,60,28,0.12)] pt-2 dark:border-[rgba(200,216,168,0.15)]">
                <button
                  type="button"
                  onClick={() => scrollToSection('auth')}
                  className="w-full rounded-xl px-4 py-3 text-left text-[15px] font-medium text-onextap-secondary dark:text-[#E8EFD8]/80"
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => scrollToSection('auth')}
                  className="w-full rounded-md bg-onextap-primary py-3 text-center text-[15px] font-medium text-white hover:bg-onextap-primary-dark"
                >
                  Get Extension
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="relative z-10">
        <section className="px-6 pb-16 pt-14 md:px-12 md:pb-24 md:pt-20">
          <div className="mx-auto grid max-w-[1100px] items-center gap-12 md:grid-cols-2 md:gap-20">
            <div>
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-onextap-olive-pale bg-onextap-olive-muted px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-onextap-primary dark:border-[rgba(90,122,58,0.4)] dark:bg-[rgba(90,122,58,0.2)] dark:text-onextap-olive-pale">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-onextap-primary-light" />
                Now on Chrome & Opera
              </div>
              <h1 className="font-display text-[44px] font-normal leading-[1.05] tracking-[-0.02em] text-onextap-dark md:text-[56px] dark:text-[#E8EFD8]">
                Apply to jobs <em className="not-italic text-onextap-primary dark:text-onextap-olive-pale">in one tap.</em>
              </h1>
              <p className="mt-6 max-w-[440px] text-[17px] font-light leading-relaxed text-onextap-secondary dark:text-[#9AB07A]">
                Enter your profile once. Onextap autofills every job application instantly — with AI that personalizes your answers for each role.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => scrollToSection('auth')}
                  className="group inline-flex items-center gap-2 rounded-lg bg-onextap-primary px-7 py-3.5 text-[15px] font-medium text-white shadow-sm transition-all hover:-translate-y-px hover:bg-onextap-primary-dark"
                >
                  Get the Extension <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollToSection('features')}
                  className="inline-flex items-center gap-1.5 text-[15px] font-normal text-onextap-secondary transition-colors hover:text-onextap-primary dark:text-[#9AB07A] dark:hover:text-onextap-olive-pale"
                >
                  See how it works <ArrowRight size={16} />
                </button>
              </div>
            </div>
            <div>
              <div className="overflow-hidden rounded-[14px] border border-[rgba(42,60,28,0.25)] bg-white shadow-[0_20px_60px_rgba(42,60,28,0.12)] dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night-card dark:shadow-black/30">
                <div className="flex items-center gap-2 border-b border-[rgba(42,60,28,0.12)] bg-onextap-cream-dark px-4 py-3 dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night-surface">
                  <div className="flex gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#FFBD2E]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#28CA41]" />
                  </div>
                  <div className="mx-3 flex-1 rounded-md border border-[rgba(42,60,28,0.12)] bg-white px-3 py-1 text-[12px] text-onextap-muted dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night-card dark:text-[#9AB07A]">
                    linkedin.com/jobs/apply/...
                  </div>
                </div>
                <div className="p-6">
                  <div className="mb-4 text-[13px] font-semibold text-onextap-dark dark:text-[#E8EFD8]">Senior Product Designer — Application</div>
                  {[
                    { l: 'Full Name', v: 'John Doe' },
                    { l: 'Email', v: 'John@email.com' },
                    { l: 'Years of Experience', v: '5 years' },
                    { l: 'Cover Note (AI Generated)', v: "Tailored to this role's requirements...", tall: true },
                  ].map((row) => (
                    <div key={row.l} className="mb-3">
                      <div className="mb-1 text-[11px] font-normal uppercase tracking-[0.06em] text-onextap-muted dark:text-[#9AB07A]">{row.l}</div>
                      <div
                        className={`flex items-center gap-1.5 rounded-md border border-onextap-olive-pale bg-onextap-olive-muted px-3 py-2 text-[13px] font-medium text-onextap-primary dark:border-[rgba(90,122,58,0.4)] dark:bg-[rgba(90,122,58,0.25)] dark:text-onextap-olive-pale ${row.tall ? 'min-h-[40px] items-start pt-2' : ''}`}
                      >
                        <span className="text-[11px] text-onextap-primary-light dark:text-onextap-olive-pale" aria-hidden>
                          ✓
                        </span>
                        {row.v}
                      </div>
                    </div>
                  ))}
                  <div className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-onextap-primary py-2.5 text-[13px] font-medium text-white">
                    <Zap size={14} className="shrink-0" /> Autofill Complete — 1 tap
                  </div>
                </div>
              </div>
              <div className="mt-3 flex gap-px">
                {[
                  ['1', 'Tap to apply'],
                  ['∞', 'Applications'],
                  ['Free', 'To start'],
                ].map(([strong, label]) => (
                  <div
                    key={label}
                    className="m-0.5 flex-1 rounded-[10px] border border-[rgba(42,60,28,0.12)] bg-white px-4 py-4 text-center dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night-card"
                  >
                    <strong className="block text-2xl font-semibold tracking-tight text-onextap-primary dark:text-onextap-olive-pale">{strong}</strong>
                    <span className="text-[11px] font-normal uppercase tracking-[0.04em] text-onextap-muted dark:text-[#9AB07A]">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="scroll-mt-20 bg-white px-6 py-20 md:px-12 md:py-24 dark:bg-onextap-night-surface">
          <div className="mx-auto max-w-[1100px]">
            <div className="mb-14 flex flex-col justify-between gap-8 md:mb-16 md:flex-row md:items-end">
              <div>
                <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-onextap-primary-light dark:text-onextap-olive-pale">Features</p>
                <h2 className="font-display text-[36px] font-normal leading-[1.1] tracking-[-0.02em] text-onextap-dark md:text-[44px] dark:text-[#E8EFD8]">
                  Everything you need
                  <br />
                  to apply <em className="not-italic text-onextap-primary dark:text-onextap-olive-pale">faster</em>
                </h2>
              </div>
              <p className="max-w-[520px] text-[16px] font-light leading-relaxed text-onextap-secondary dark:text-[#9AB07A]">
                A focused tool, not a bloated platform. We handle the friction so you can focus on finding the right role.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-px bg-[rgba(42,60,28,0.12)] sm:grid-cols-2 lg:grid-cols-3 dark:bg-[rgba(200,216,168,0.08)]">
              {[
                { emoji: '📋', title: 'One-Click Autofill', desc: 'Scans form fields using DOM analysis and pattern matching. Fills every field in one click, every time.' },
                { emoji: '🗺', title: 'Smart Field Mapping', desc: 'Encounter an unusual field? Map it once — Onextap remembers for every future application automatically.' },
                { emoji: '✦', title: 'AI Personalization', desc: 'Our AI reads the job description and suggests improvements to your answers before you submit.' },
                { emoji: '👤', title: 'Multiple Profiles', desc: 'Different profile for design, engineering, or management roles. Switch between them effortlessly.' },
                { emoji: '📈', title: 'Application Tracker', desc: 'Stay organized without a separate platform. Onextap automatically logs every application you submit.' },
                { emoji: '🔒', title: 'Secure Storage', desc: 'Data stored locally on your device with optional encrypted cloud backup and seamless sync.' },
              ].map(({ emoji, title, desc }) => (
                <div
                  key={title}
                  className="bg-white p-8 transition-colors hover:bg-onextap-cream dark:bg-onextap-night-surface dark:hover:bg-onextap-night-card"
                >
                  <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-[10px] bg-onextap-olive-muted text-xl dark:bg-[rgba(90,122,58,0.2)]">{emoji}</div>
                  <h3 className="mb-2.5 text-[16px] font-semibold tracking-tight text-onextap-dark dark:text-[#E8EFD8]">{title}</h3>
                  <p className="text-[14px] font-light leading-relaxed text-onextap-secondary dark:text-[#9AB07A]">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 py-20 md:px-12 md:py-24">
          <div className="mx-auto max-w-[1100px]">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-onextap-primary-light dark:text-onextap-olive-pale">How it works</p>
            <h2 className="font-display mb-14 text-[36px] font-normal leading-[1.1] tracking-[-0.02em] text-onextap-dark md:text-[44px] md:mb-16 dark:text-[#E8EFD8]">
              Three steps.
              <br />
              <em className="not-italic text-onextap-primary dark:text-onextap-olive-pale">Done.</em>
            </h2>
            <div className="grid grid-cols-1 gap-12 md:grid-cols-3 md:gap-12">
              {[
                { n: '01', t: 'Build your profile', d: 'Enter your details once or upload a resume. Onextap parses and structures everything automatically.' },
                { n: '02', t: 'Open any job form', d: 'Navigate to any job application on any platform. The Onextap extension activates automatically.' },
                { n: '03', t: 'Tap to apply', d: 'Hit autofill. Review your AI-personalized answers in seconds. Submit. Move to the next one.' },
              ].map((step, si) => (
                <div key={step.n} className="relative">
                  <div className="font-display mb-4 text-[56px] font-normal leading-none tracking-[-0.03em] text-onextap-olive-pale dark:text-[rgba(90,122,58,0.35)] md:text-[72px]">
                    {step.n}
                  </div>
                  <h3 className="mb-2.5 text-lg font-semibold text-onextap-dark dark:text-[#E8EFD8]">{step.t}</h3>
                  <p className="text-[14px] font-light leading-relaxed text-onextap-secondary dark:text-[#9AB07A]">{step.d}</p>
                  {si < 2 && (
                    <div className="absolute right-0 top-9 hidden w-12 border-t border-dashed border-[rgba(42,60,28,0.25)] md:block dark:border-[rgba(200,216,168,0.2)]" style={{ right: '-1.5rem' }} aria-hidden />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-20 bg-onextap-cream-dark px-6 py-20 md:px-12 md:py-24 dark:bg-onextap-night-surface">
          <div className="mx-auto max-w-[1100px]">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-onextap-primary-light dark:text-onextap-olive-pale">Pricing</p>
            <h2 className="font-display max-w-md text-[36px] font-normal leading-[1.1] tracking-[-0.02em] text-onextap-dark md:text-[44px] dark:text-[#E8EFD8]">
              Simple,
              <br />
              <em className="not-italic text-onextap-primary dark:text-onextap-olive-pale">transparent.</em>
            </h2>
            <p className="mt-4 max-w-lg text-[16px] font-light leading-relaxed text-onextap-secondary dark:text-[#9AB07A]">
              Start free with fast standard AI, then upgrade for unlimited high-quality AI generation.
            </p>
            <div className="mx-auto mt-14 grid max-w-[780px] grid-cols-1 gap-6 md:grid-cols-2">
              <div className="reveal-scale stagger-1 flex flex-col rounded-[14px] border border-[rgba(42,60,28,0.12)] bg-white p-9 transition-shadow hover:shadow-[0_8px_32px_rgba(42,60,28,0.08)] dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night-card">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-onextap-muted dark:text-[#9AB07A]">Free</p>
                <div className="font-display mt-6 text-[52px] font-normal leading-none tracking-[-0.02em] text-onextap-dark dark:text-[#E8EFD8]">$0</div>
                <p className="mt-2 text-[13px] text-onextap-muted dark:text-[#9AB07A]">Forever free</p>
                <ul className="mt-8 flex-1 space-y-0">
                  {[
                    'Unlimited autofill applications',
                    'Local data storage',
                    'Multiple profiles',
                    'Smart field mapping',
                    '3 fast standard AI credits for personalized answers',
                    'Application tracking',
                  ].map((f) => (
                    <li
                      key={f}
                      className="flex items-center gap-2.5 border-b border-[rgba(42,60,28,0.12)] py-2 text-[14px] font-light text-onextap-secondary last:border-0 dark:border-[rgba(200,216,168,0.15)] dark:text-[#E8EFD8]/90"
                    >
                      <span className="shrink-0 text-xs text-onextap-primary-light dark:text-onextap-olive-pale" aria-hidden>
                        →
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => scrollToSection('auth')}
                  className="mt-8 block w-full rounded-lg border-[1.5px] border-[rgba(42,60,28,0.25)] py-3.5 text-center text-[14px] font-medium text-onextap-dark transition-colors hover:bg-onextap-cream dark:border-[rgba(200,216,168,0.2)] dark:text-[#E8EFD8] dark:hover:bg-onextap-night-surface"
                >
                  Get started free
                </button>
              </div>
              <div className="reveal-scale stagger-2 relative flex flex-col rounded-[14px] border border-onextap-primary bg-onextap-primary p-9 text-white shadow-lg transition-shadow hover:shadow-xl dark:border-onextap-primary-dark dark:bg-onextap-primary-dark">
                <span className="mb-5 inline-block w-fit rounded bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-onextap-primary">
                  Most Popular
                </span>
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-onextap-olive-pale">Premium</p>
                <div className="font-display mt-4 text-[52px] font-normal leading-none">$5</div>
                <p className="mt-2 text-[13px] text-onextap-olive-pale">per month</p>
                <ul className="mt-8 flex-1 space-y-0 text-white">
                  {[
                    'Everything in Free',
                    'Unlimited high-quality AI answer generation',
                    'Two-pass AI rewrites for stronger final answers',
                    'Deeper profile-tailored answer personalization',
                    'Encrypted cloud backup & sync',
                    'Priority support',
                    'Early access to new features',
                  ].map((f) => (
                    <li
                      key={f}
                      className="flex items-center gap-2.5 border-b border-[rgba(200,216,168,0.2)] py-2 text-[14px] font-light last:border-0"
                    >
                      <span className="shrink-0 text-xs text-onextap-olive-pale" aria-hidden>
                        →
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={onOpenPremiumModal}
                  className="mt-8 block w-full rounded-lg bg-white py-3.5 text-center text-[14px] font-medium text-onextap-primary transition-colors hover:bg-onextap-olive-muted"
                >
                  Upgrade to Premium
                </button>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-20 px-6 py-20 md:px-12 md:py-24">
          <div className="mx-auto max-w-[720px]">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-onextap-primary-light dark:text-onextap-olive-pale">FAQ</p>
            <h2 className="font-display mb-14 text-[36px] font-normal leading-[1.1] tracking-[-0.02em] text-onextap-dark md:text-[44px] md:mb-16 dark:text-[#E8EFD8]">
              Questions,
              <br />
              <em className="not-italic text-onextap-primary dark:text-onextap-olive-pale">answered.</em>
            </h2>
            <div>
              {[
                { q: 'How is my data stored and protected?', a: 'By default, all your data is stored locally on your device in the browser\'s secure storage. If you enable Cloud Sync, data is transmitted via SSL/TLS encryption to our secure database (Supabase). We never sell, rent, or trade your personal data.' },
                { q: 'Do I have control over AI suggestions?', a: 'Absolutely. AI suggestions are just that — suggestions. You review every AI-generated answer before it\'s saved or used. The AI reads the job description context and your existing answers to suggest improvements, but you always have the final say.' },
                { q: 'Which browsers are supported?', a: 'Onextap is currently available for Chrome and Chromium-based browsers (including Opera, Brave, and Edge). Safari support is coming soon.' },
                { q: 'What happens when I run out of free AI credits?', a: 'Free accounts come with 3 fast standard AI credits for personalized answer generation. Once used, you can upgrade to Premium ($5.00/month) for unlimited high-quality AI generation with deeper rewrites, or continue using all other features like autofill, profiles, and field mapping for free.' },
                { q: 'Can I use different profiles for different job types?', a: 'Yes! You can create multiple profiles for different industries or job types and switch between them when applying. Each profile stores its own set of personal details, experience, and saved answers.' },
                { q: 'Is Onextap an Applicant Tracking System (ATS)?', a: 'No. Onextap is a personal productivity tool and application copilot. We help you fill out applications faster — we don\'t manage hiring pipelines or act as an employer-side ATS. Your data stays with you.' },
              ].map(({ q, a }, i) => (
                <div
                  key={i}
                  className={`reveal stagger-${i + 1} cursor-pointer border-b border-[rgba(42,60,28,0.12)] py-5 dark:border-[rgba(200,216,168,0.15)]`}
                >
                  <button type="button" onClick={() => toggleFaq(i)} className="flex w-full items-center justify-between gap-4 text-left">
                    <span className="text-[15px] font-medium text-onextap-dark dark:text-[#E8EFD8]">{q}</span>
                    <Plus
                      size={18}
                      className={`shrink-0 text-onextap-muted transition-transform duration-300 dark:text-[#9AB07A] ${openFaq === i ? 'rotate-45' : ''}`}
                    />
                  </button>
                  {openFaq === i && (
                    <p className="mt-3 text-[14px] font-light leading-relaxed text-onextap-secondary dark:text-[#9AB07A]">{a}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-onextap-primary px-6 py-20 text-center text-white md:px-12 md:py-24 dark:bg-onextap-primary-dark">
          <h2 className="font-display mx-auto max-w-lg text-[36px] font-normal leading-[1.1] tracking-[-0.02em] md:text-[44px]">
            Ready to transform
            <br />
            your job <em className="not-italic text-onextap-olive-pale">search?</em>
          </h2>
          <p className="mx-auto mt-4 max-w-[440px] text-[16px] font-light leading-relaxed text-white/65">
            Join thousands of job seekers applying faster with Onextap.
          </p>
          <button
            type="button"
            onClick={() => scrollToSection('auth')}
            className="group mt-10 inline-flex items-center gap-2 rounded-lg bg-onextap-cream px-8 py-3.5 text-[15px] font-semibold text-onextap-primary transition-all hover:bg-white"
          >
            Get the Extension <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
          </button>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-[13px] text-white/50">
            <span>Available for</span>
            <span className="rounded-full bg-white/10 px-3 py-1 text-[12px] text-white/80">Chrome</span>
            <span className="rounded-full bg-white/10 px-3 py-1 text-[12px] text-white/80">Opera</span>
            <span className="rounded-full bg-white/10 px-3 py-1 text-[12px] text-white/45 opacity-80">Safari — Soon</span>
          </div>
        </section>

        <section id="auth" className="scroll-mt-20 bg-onextap-cream px-6 py-20 md:px-12 md:py-24 dark:bg-onextap-night">
          <div className="mx-auto max-w-md text-center reveal-scale">
            <h2 className="mb-2 font-display text-[32px] font-normal tracking-tight text-onextap-dark md:text-[36px] dark:text-[#E8EFD8]">
              {authMode === 'signup' ? 'Create your account' : 'Welcome back'}
            </h2>
            <p className="mb-8 text-[15px] text-onextap-muted dark:text-[#9AB07A]">
              {authMode === 'signup' ? 'Get started for free — no credit card required.' : 'Sign in to access your dashboard.'}
            </p>
            <div className="space-y-4 rounded-[14px] border border-[rgba(42,60,28,0.12)] bg-white p-8 shadow-sm dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night-card">
              {/* Google OAuth */}
              <button
                onClick={handleGoogleSignIn}
                disabled={isSigningIn}
                className="w-full bg-white dark:bg-white/[0.08] text-onextap-dark dark:text-white py-3.5 rounded-xl text-[14px] font-semibold flex items-center justify-center gap-3 border border-onextap-dark/10 dark:border-white/10 hover:border-onextap-dark/20 dark:hover:border-white/20 hover:shadow-md transition-all disabled:opacity-50"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/><path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>
                Continue with Google
              </button>
              {/* Divider */}
              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-onextap-dark/[0.08] dark:bg-white/[0.08]" />
                <span className="text-[12px] text-onextap-dark/35 dark:text-white/35 font-medium">or</span>
                <div className="flex-1 h-px bg-onextap-dark/[0.08] dark:bg-white/[0.08]" />
              </div>
              {/* Email form */}
              {authMode === 'signup' && (
                <input
                  type="text"
                  placeholder="Full name"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  className="w-full px-4 py-3.5 border border-onextap-dark/10 dark:border-white/10 rounded-xl text-[14px] bg-white dark:bg-white/[0.06] dark:text-white dark:placeholder-white/35 focus:outline-none focus:border-onextap-primary/50 focus:ring-2 focus:ring-onextap-primary/10 transition-all"
                />
              )}
              <input
                type="email"
                placeholder="Email address"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full px-4 py-3.5 border border-onextap-dark/10 dark:border-white/10 rounded-xl text-[14px] bg-white dark:bg-white/[0.06] dark:text-white dark:placeholder-white/35 focus:outline-none focus:border-onextap-primary/50 focus:ring-2 focus:ring-onextap-primary/10 transition-all"
                onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
              />
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  value={authPassword}
                  onChange={(e) => {
                    const val = e.target.value;
                    setAuthPassword(val);
                    if (!val) setPasswordStrength(null);
                    else if (val.length < 8 || !/[A-Z]/.test(val) || !/[0-9]/.test(val)) setPasswordStrength('weak');
                    else if (val.length >= 10 && /[A-Z]/.test(val) && /[0-9]/.test(val) && /[^A-Za-z0-9]/.test(val)) setPasswordStrength('strong');
                    else setPasswordStrength('medium');
                  }}
                  className="w-full px-4 py-3.5 pr-16 border border-onextap-dark/10 dark:border-white/10 rounded-xl text-[14px] bg-white dark:bg-white/[0.06] dark:text-white dark:placeholder-white/35 focus:outline-none focus:border-onextap-primary/50 focus:ring-2 focus:ring-onextap-primary/10 transition-all"
                  onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
                />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 right-4 flex items-center text-[12px] font-semibold text-onextap-dark/50 dark:text-white/50 hover:text-onextap-dark dark:hover:text-white transition-colors">
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {passwordStrength && (
                <div className="flex items-center justify-between px-1 text-[12px]">
                  <span className="text-onextap-dark/40 dark:text-white/40">Password strength</span>
                  <span className={`font-semibold ${passwordStrength === 'strong' ? 'text-green-600' : passwordStrength === 'medium' ? 'text-yellow-600' : 'text-red-500'}`}>
                    {passwordStrength.charAt(0).toUpperCase() + passwordStrength.slice(1)}
                  </span>
                </div>
              )}
              {authError && <p className="text-[13px] text-red-600 dark:text-red-400 text-left px-1">{authError}</p>}
              <button
                onClick={handleSignIn}
                disabled={isSigningIn}
                className="w-full bg-onextap-dark dark:bg-white text-white dark:text-onextap-dark py-3.5 rounded-xl text-[14px] font-semibold flex items-center justify-center gap-2 hover:bg-onextap-dark/90 dark:hover:bg-white/90 transition-all disabled:opacity-50"
              >
                {isSigningIn ? <><Activity size={16} className="animate-spin shrink-0" /> Connecting...</> : (authMode === 'signup' ? 'Create Account' : 'Sign In')}
              </button>
              <p className="text-[13px] text-onextap-dark/45 dark:text-white/45 text-center pt-1">
                {authMode === 'signup' ? (
                  <>Already have an account? <button onClick={() => setAuthMode('signin')} className="text-onextap-primary font-semibold hover:underline">Sign in</button></>
                ) : (
                  <>Don&apos;t have an account? <button onClick={() => setAuthMode('signup')} className="text-onextap-primary font-semibold hover:underline">Sign up</button></>
                )}
              </p>
            </div>
          </div>
        </section>

      </main>

      <footer className="bg-onextap-bark px-6 pb-9 pt-14 text-onextap-cream md:px-12">
        <div className="reveal mx-auto max-w-[1100px]">
          <div className="mb-12 grid grid-cols-1 gap-10 md:grid-cols-[2fr_1fr_1fr_1fr] md:gap-12">
            <div>
              <div className="mb-3 flex items-center gap-2.5 text-[16px] font-semibold tracking-tight text-onextap-cream">
                <img
                  src={getIconUrl()}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded-md ring-1 ring-onextap-cream/25"
                />
                Onextap
              </div>
              <p className="mt-3 max-w-sm text-[14px] font-light leading-relaxed text-onextap-cream/55">
                Your personal job application copilot. Apply faster with AI-powered autofill and personalization.
              </p>
            </div>
            <div>
              <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-onextap-cream/40">Product</h4>
              <div className="space-y-2.5">
                <button type="button" onClick={() => scrollToSection('features')} className="block text-left text-[14px] font-light text-onextap-cream/65 transition-colors hover:text-onextap-cream">
                  Features
                </button>
                <button type="button" onClick={() => scrollToSection('pricing')} className="block text-left text-[14px] font-light text-onextap-cream/65 transition-colors hover:text-onextap-cream">
                  Pricing
                </button>
                <button type="button" onClick={() => scrollToSection('faq')} className="block text-left text-[14px] font-light text-onextap-cream/65 transition-colors hover:text-onextap-cream">
                  FAQ
                </button>
              </div>
            </div>
            <div>
              <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-onextap-cream/40">Support</h4>
              <div className="space-y-2.5">
                <a href="mailto:mazzah70@gmail.com" className="block text-[14px] font-light text-onextap-cream/65 transition-colors hover:text-onextap-cream">
                  Contact Us
                </a>
                <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="block text-[14px] font-light text-onextap-cream/65 transition-colors hover:text-onextap-cream">
                  Privacy Policy
                </a>
              </div>
            </div>
            <div>
              <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-onextap-cream/40">Get Started</h4>
              <div className="space-y-2.5">
                <button type="button" onClick={() => scrollToSection('auth')} className="block text-left text-[14px] font-light text-onextap-cream/65 transition-colors hover:text-onextap-cream">
                  Install Extension
                </button>
                <button type="button" onClick={() => scrollToSection('auth')} className="block text-left text-[14px] font-light text-onextap-cream/65 transition-colors hover:text-onextap-cream">
                  Sign In
                </button>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-center justify-between gap-3 border-t border-onextap-cream/10 pt-6 text-[13px] text-onextap-cream/35 md:flex-row">
            <p>&copy; {new Date().getFullYear()} Onextap. All rights reserved.</p>
            <p className="text-[12px] text-onextap-cream/25">Chrome · Opera · Safari coming soon</p>
          </div>
        </div>
      </footer>

    </div>
  );
};
// --- DASHBOARD VIEW (Main Auth Logic — Supabase) ---
// --- GUIDED TOUR ---
const TOUR_STEPS = [
  {
    target: 'sidebar-nav',
    title: 'Your navigation hub',
    desc: 'Use the sidebar to switch between Overview, My Profiles, and Answer Studio. Everything you need is one click away.',
    position: 'right',
    icon: Layout,
  },
  {
    target: 'nav-profiles',
    title: 'My Profiles',
    desc: 'Add your personal details, education, work experience, and skills. You can also upload a resume — we\'ll parse it automatically.',
    position: 'right',
    icon: User,
  },
  {
    target: 'nav-vault',
    title: 'Answer Studio',
    desc: 'Save answers to common application questions. Use AI mode to generate smart, job-specific answers from a job description — or switch to manual mode to write your own.',
    position: 'right',
    icon: PenTool,
  },
  {
    target: 'dark-toggle',
    title: 'Dark mode',
    desc: 'Prefer working at night? Toggle between light and dark themes here.',
    position: 'right',
    icon: Moon,
  },
];

const TourOverlay = ({ step, totalSteps, currentStep, onNext, onSkip, onDismiss }) => {
  const [pos, setPos] = useState(null);
  const [targetRect, setTargetRect] = useState(null);

  useEffect(() => {
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) return;

    const updatePosition = () => {
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);

      const tooltipWidth = 320;
      const tooltipHeight = 200;
      const gap = 16;
      let top, left;

      if (step.position === 'right') {
        left = rect.right + gap;
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
      } else if (step.position === 'bottom') {
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        top = rect.bottom + gap;
      } else if (step.position === 'left') {
        left = rect.left - tooltipWidth - gap;
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
      } else {
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        top = rect.top - tooltipHeight - gap;
      }

      // Keep tooltip on screen
      top = Math.max(16, Math.min(top, window.innerHeight - tooltipHeight - 16));
      left = Math.max(16, Math.min(left, window.innerWidth - tooltipWidth - 16));

      setPos({ top, left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [step.target, step.position]);

  if (!pos || !targetRect) return null;

  const padding = 6;
  const spotlightStyle = {
    position: 'fixed',
    top: targetRect.top - padding,
    left: targetRect.left - padding,
    width: targetRect.width + padding * 2,
    height: targetRect.height + padding * 2,
    borderRadius: '16px',
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
    zIndex: 49,
    pointerEvents: 'none',
    transition: 'all 0.3s ease',
  };

  const arrowStyle = {};
  if (step.position === 'right') {
    arrowStyle.left = '-6px';
    arrowStyle.top = '50%';
    arrowStyle.transform = 'translateY(-50%) rotate(45deg)';
  } else if (step.position === 'bottom') {
    arrowStyle.top = '-6px';
    arrowStyle.left = '50%';
    arrowStyle.transform = 'translateX(-50%) rotate(45deg)';
  } else if (step.position === 'left') {
    arrowStyle.right = '-6px';
    arrowStyle.top = '50%';
    arrowStyle.transform = 'translateY(-50%) rotate(45deg)';
  } else {
    arrowStyle.bottom = '-6px';
    arrowStyle.left = '50%';
    arrowStyle.transform = 'translateX(-50%) rotate(45deg)';
  }

  const StepIcon = step.icon;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[48] pointer-events-auto" onClick={onDismiss} />
      
      {/* Spotlight cutout */}
      <div style={spotlightStyle} />

      {/* Tooltip */}
      <div
        className="fixed z-50 w-80 animate-fade-in pointer-events-auto"
        style={{ top: pos.top, left: pos.left }}
      >
        <div className="relative bg-white dark:bg-[#262520] rounded-2xl border border-onextap-primary/25 dark:border-white/[0.1] shadow-2xl shadow-onextap-dark/20 dark:shadow-black/40 p-5 overflow-hidden">
          {/* Decorative gradient */}
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-onextap-primary/10 to-transparent rounded-full blur-2xl pointer-events-none" />

          {/* Arrow */}
          <div
            className="absolute w-3 h-3 bg-white dark:bg-[#262520] border border-onextap-primary/25 dark:border-white/[0.1]"
            style={arrowStyle}
          />

          <div className="relative z-10">
            {/* Step counter & skip */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-onextap-primary/15 flex items-center justify-center">
                  <StepIcon size={14} className="text-onextap-primary" />
                </div>
                <span className="text-[11px] font-semibold text-onextap-dark/40 dark:text-white/40 uppercase tracking-wider">
                  Step {currentStep + 1} of {totalSteps}
                </span>
              </div>
              <button onClick={onSkip} className="text-[12px] text-onextap-dark/40 dark:text-white/40 hover:text-onextap-dark dark:hover:text-white font-medium transition-colors">
                Skip tour
              </button>
            </div>

            {/* Content */}
            <h3 className="font-bold text-[15px] text-onextap-dark dark:text-white mb-1.5">{step.title}</h3>
            <p className="text-[13px] text-onextap-dark/60 dark:text-white/50 leading-relaxed mb-4">{step.desc}</p>

            {/* Progress & nav */}
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                {Array.from({ length: totalSteps }).map((_, i) => (
                  <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === currentStep ? 'w-5 bg-onextap-primary' : i < currentStep ? 'w-1.5 bg-onextap-primary/50' : 'w-1.5 bg-onextap-dark/15 dark:bg-white/15'
                  }`} />
                ))}
              </div>
              <button
                onClick={onNext}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-onextap-primary text-white hover:bg-onextap-primary-dark transition-colors shadow-sm"
              >
                {currentStep < totalSteps - 1 ? 'Next' : 'Get Started'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

const DashboardView = ({ onClose }) => {
  const viewFromUrl = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('view') : null;
  const [activeNav, setActiveNav] = useState(
    viewFromUrl === 'vault' ? 'vault'
      : viewFromUrl === 'intel' ? 'intel'
      : viewFromUrl === 'cover' ? 'cover'
      : 'overview'
  );
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('onextap_dark_mode');
      if (stored !== null) return stored === 'true';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('onextap_dark_mode', darkMode);
  }, [darkMode]);
  const [user, setUser] = useState(null); // Supabase User Object
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [contentKey, setContentKey] = useState(0);
  const [isPremiumUser, setIsPremiumUser] = useState(false);

  // Guided tour state
  const [showTour, setShowTour] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  // Auth form state
  const [authMode, setAuthMode] = useState('signin'); // 'signin' | 'signup'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authError, setAuthError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(null); // 'weak' | 'medium' | 'strong' | null

  // Initialize Supabase & Check Auth
  useEffect(() => {
    const { unsubscribe } = onAuthStateChange((event, session) => {
      if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
        setUser(session.user);
        creditManager.verifyPremium().then(p => setIsPremiumUser(p)).catch(console.warn);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setContentKey((k) => k + 1);
      }
      if (event === 'INITIAL_SESSION') {
        setIsCheckingAuth(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Trigger guided tour only for brand-new accounts (created within the last 2 minutes)
  useEffect(() => {
    if (user && !isCheckingAuth) {
      const checkTour = async () => {
        const seen = await storage.get('onextap_tutorial_seen');
        if (seen) return;

        const createdAt = user.created_at ? new Date(user.created_at) : null;
        const isNewAccount = createdAt && (Date.now() - createdAt.getTime() < 2 * 60 * 1000);
        if (isNewAccount) {
          setTimeout(() => setShowTour(true), 600);
        } else {
          await storage.set('onextap_tutorial_seen', true);
        }
      };
      checkTour();
    }
  }, [user, isCheckingAuth]);

  const dismissTour = async () => {
    setShowTour(false);
    setTourStep(0);
    await storage.set('onextap_tutorial_seen', true);
  };

  const nextTourStep = () => {
    if (tourStep < TOUR_STEPS.length - 1) {
      setTourStep(tourStep + 1);
    } else {
      dismissTour();
    }
  };

  const handleSignIn = async () => {
    if (!authEmail || !authPassword) {
      setAuthError('Please enter your email and password.');
      return;
    }

    // On signup, enforce at least a medium-strength password
    if (authMode === 'signup') {
      const strength = getPasswordStrength(authPassword);
      setPasswordStrength(strength);
      if (strength === 'weak') {
        setAuthError('Please use a stronger password (min 8 characters, with upper/lowercase letters and numbers).');
        return;
      }
    }

    setIsSigningIn(true);
    setAuthError('');
    try {
      if (authMode === 'signup') {
        const { user: newUser, error } = await supaSignUp(authEmail, authPassword, authName);
        if (error) throw error;
        if (newUser) {
          setUser(newUser);
          creditManager.verifyPremium().catch(console.warn);
        } else {
          setAuthError('Check your email for a confirmation link.');
        }
      } else {
        const { user: existingUser, error } = await supaSignIn(authEmail, authPassword);
        if (error) throw error;
        setUser(existingUser);
        creditManager.verifyPremium().catch(console.warn);
      }
    } catch (error) {
      console.error('Auth failed:', error);
      setAuthError(error.message || 'Authentication failed. Please try again.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setAuthError('');
    try {
      const { error } = await signInWithOAuth('google');
      if (error) throw error;
      // OAuth redirect will handle the rest
    } catch (error) {
      console.error('Google sign in failed:', error);
      setAuthError(error.message || 'Google sign-in failed.');
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await supaSignOut();
    setUser(null);

    const keysToRemove = ['user_profile', 'onextap_profiles'];
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await new Promise((resolve) => {
          chrome.storage.local.remove(keysToRemove, () => resolve());
        });
      }
      if (typeof localStorage !== 'undefined') {
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      }
    } catch (err) {
      console.warn('Storage clear on sign-out:', err);
    }

    setContentKey((k) => k + 1);
  };

  const [toast, setToast] = useState({ message: '', type: 'success', visible: false });
  const [isPremiumModalOpen, setIsPremiumModalOpen] = useState(false);

  // Handle ?payment=success after checkout redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success' && user?.id) {
      // Clean up URL params (including Dodo's appended params)
      const url = new URL(window.location);
      ['payment', 'session_id', 'payment_id', 'status', 'email', 'license_key'].forEach(p => url.searchParams.delete(p));
      window.history.replaceState({}, '', url);

      // Poll for premium activation — webhook can take up to a few minutes
      setToast({ message: 'Payment received! Activating your Premium subscription...', type: 'success', visible: true });
      let attempts = 0;
      const maxAttempts = 15;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const isPrem = await creditManager.verifyPremium();
          if (isPrem) {
            clearInterval(poll);
            setIsPremiumUser(true);
            setToast({ message: 'Premium activated! You now have unlimited AI credits.', type: 'success', visible: true });
          } else if (attempts >= maxAttempts) {
            clearInterval(poll);
            setToast({ message: 'Payment received! Premium may take a moment to activate — please refresh shortly.', type: 'success', visible: true });
          }
        } catch {
          if (attempts >= maxAttempts) clearInterval(poll);
        }
      }, 8000);
      return () => clearInterval(poll);
    } else if (params.get('payment') === 'cancelled') {
      setToast({ message: 'Payment cancelled.', type: 'error', visible: true });
      const url = new URL(window.location);
      url.searchParams.delete('payment');
      window.history.replaceState({}, '', url);
    }
  }, [user]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type, visible: true });
  };
  const hideToast = () => setToast((t) => ({ ...t, visible: false }));

  const renderContent = () => {
    switch(activeNav) {
      case 'overview': return <OverviewPage key={contentKey} user={user} onNavigate={setActiveNav} isPremium={isPremiumUser} />;
      case 'profiles': return <ProfilesPage key={contentKey} showToast={showToast} />;
      case 'vault': return <VaultPage key={contentKey} showToast={showToast} user={user} />;
      case 'cover': return <CoverLetterPage key={contentKey} showToast={showToast} user={user} />;
      case 'intel': return <JobIntelligencePage key={contentKey} showToast={showToast} />;
      default: return <OverviewPage key={contentKey} user={user} onNavigate={setActiveNav} isPremium={isPremiumUser} />;
    }
  };

  // Landing page when not signed in (same style as popup)
  if (!isCheckingAuth && !user) {
    return (
      <PublicLandingPage
        authMode={authMode}
        setAuthMode={setAuthMode}
        authName={authName}
        setAuthName={setAuthName}
        authEmail={authEmail}
        setAuthEmail={setAuthEmail}
        authPassword={authPassword}
        setAuthPassword={setAuthPassword}
        showPassword={showPassword}
        setShowPassword={setShowPassword}
        passwordStrength={passwordStrength}
        setPasswordStrength={setPasswordStrength}
        authError={authError}
        isSigningIn={isSigningIn}
        handleSignIn={handleSignIn}
        handleGoogleSignIn={handleGoogleSignIn}
        onOpenPremiumModal={() => setIsPremiumModalOpen(true)}
      />
    );
  }

  return (
    <div className="relative flex min-h-screen w-full overflow-hidden bg-onextap-cream text-onextap-dark transition-colors duration-300 dark:bg-onextap-night dark:text-[#E8EFD8]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-onextap-primary/[0.07] blur-3xl dark:bg-onextap-primary/[0.12]" />
        <div className="absolute bottom-0 left-1/4 h-64 w-64 rounded-full bg-onextap-olive-muted/40 blur-3xl dark:opacity-20" />
      </div>

      <aside className="sidebar-enter fixed z-10 flex h-full w-72 flex-col border-r border-[rgba(42,60,28,0.12)] bg-onextap-cream/95 backdrop-blur-md transition-colors dark:border-[rgba(200,216,168,0.12)] dark:bg-onextap-night-surface/95">
        <div className="flex items-center gap-3 border-b border-[rgba(42,60,28,0.12)] p-6 dark:border-[rgba(200,216,168,0.12)]">
          <img src={getIconUrl()} alt="Onextap" className="h-10 w-10 shrink-0 rounded-xl shadow-sm ring-1 ring-black/[0.06] dark:ring-white/10" />
          <span className="text-xl font-semibold tracking-tight text-onextap-dark dark:text-[#E8EFD8]">Onextap</span>
        </div>
        
        <div className="border-b border-[rgba(42,60,28,0.12)] p-5 dark:border-[rgba(200,216,168,0.12)]">
          {isCheckingAuth ? (
            <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-onextap-olive-muted py-3 text-sm font-medium text-onextap-primary dark:bg-[rgba(90,122,58,0.2)] dark:text-onextap-olive-pale">
              <Activity className="animate-spin" size={16} /> Connecting...
            </div>
          ) : user ? (
            <div className="rounded-[14px] border border-[rgba(42,60,28,0.12)] bg-white p-4 shadow-sm dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night-card">
              <div className="flex items-center gap-3 mb-3">
                <div className="relative shrink-0">
                  <div className="w-10 h-10 bg-gradient-to-br from-onextap-primary/30 to-onextap-primary/10 text-onextap-primary rounded-xl flex items-center justify-center font-bold text-sm border border-onextap-primary/30 shadow-sm">
                    {(user.user_metadata?.full_name || user.email || 'U')[0]?.toUpperCase()}
                  </div>
                  {isPremiumUser && (
                    <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gradient-to-br from-amber-400 to-amber-500 rounded-full flex items-center justify-center shadow-sm border-2 border-white dark:border-gray-900">
                      <Crown size={10} className="text-white" />
                    </div>
                  )}
                </div>
                <div className="overflow-hidden flex-1 min-w-0">
                  <div className="text-sm font-bold text-onextap-dark dark:text-white truncate flex items-center gap-1.5">
                    {user.user_metadata?.full_name || user.email?.split('@')[0]}
                    {isPremiumUser && <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded-full leading-none">PRO</span>}
                  </div>
                  <div className="mt-1">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold leading-none ${
                        isPremiumUser
                          ? 'text-amber-700 bg-amber-100 border border-amber-200 dark:text-amber-300 dark:bg-amber-900/25 dark:border-amber-700/40'
                          : 'text-onextap-primary bg-onextap-primary/10 border border-onextap-primary/20 dark:text-onextap-primary-light dark:bg-onextap-primary/15 dark:border-onextap-primary/30'
                      }`}
                    >
                      {isPremiumUser ? <Crown size={10} /> : <Zap size={10} />}
                      {isPremiumUser ? 'PREMIUM HQ' : 'STANDARD'}
                    </span>
                  </div>
                  <div className="text-xs text-onextap-primary flex items-center gap-1 truncate"><Shield size={10}/> {user.email}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setIsAccountModalOpen(true)} 
                  className="flex-1 text-xs text-onextap-dark/80 dark:text-white/70 hover:text-onextap-primary flex items-center justify-center gap-1.5 py-2 hover:bg-onextap-primary/10 rounded-xl transition-all duration-200 border border-onextap-primary/20 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.04]"
                >
                  <Settings size={13} /> Settings
                </button>
                <button 
                  onClick={handleSignOut} 
                  className="flex-1 text-xs text-onextap-dark/70 dark:text-white/60 hover:text-red-500 dark:hover:text-red-400 flex items-center justify-center gap-1.5 py-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all duration-200 border border-onextap-primary/20 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.04]"
                >
                  <LogOut size={13} /> Sign Out
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-onextap-dark/60 dark:text-white/50 text-center px-2">
                Sign in from the main page to get started.
              </p>
            </div>
          )}
        </div>

        <nav className="flex-1 p-5 space-y-2" data-tour="sidebar-nav">
          {[{id:'overview', icon:Layout, label:'Overview'}, {id:'profiles', icon:User, label:'My Profiles'}, {id:'vault', icon:PenTool, label:'Answer Studio'}, {id:'cover', icon:FileText, label:'Cover Letter'}, {id:'intel', icon:Briefcase, label:'Job Intelligence'}].map((i, idx) => (
            <button 
              key={i.id} 
              onClick={()=>setActiveNav(i.id)} 
              data-tour={`nav-${i.id}`}
              className={`nav-item-enter flex w-full items-center gap-3 rounded-lg px-4 py-3.5 text-sm font-medium transition-all duration-200 ${
                activeNav === i.id
                  ? 'bg-onextap-primary text-white shadow-sm dark:bg-onextap-primary-dark'
                  : 'text-onextap-secondary hover:bg-onextap-olive-muted/60 dark:text-[#9AB07A] dark:hover:bg-white/[0.06] dark:hover:text-[#E8EFD8]'
              }`}
              style={{ animationDelay: `${0.2 + idx * 0.08}s` }}
            >
              <i.icon size={18} className={activeNav === i.id ? 'text-white opacity-95' : 'text-onextap-primary'} />
              {i.label}
            </button>
          ))}
        </nav>

        <div className="border-t border-[rgba(42,60,28,0.12)] p-5 dark:border-[rgba(200,216,168,0.12)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src={getIconUrl()} alt="" className="h-7 w-7 shrink-0 rounded-lg ring-1 ring-black/[0.06] dark:ring-white/10" />
              <span className="text-xs font-medium text-onextap-muted dark:text-[#9AB07A]">Onextap</span>
            </div>
            <button onClick={() => setDarkMode(!darkMode)} data-tour="dark-toggle" className="p-2 rounded-xl text-onextap-dark/40 dark:text-white/40 hover:text-onextap-dark dark:hover:text-white hover:bg-onextap-dark/[0.04] dark:hover:bg-white/[0.06] transition-all" aria-label="Toggle dark mode">
              {darkMode ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>
      </aside>
      <main className="main-content-enter relative z-10 ml-72 flex-1 p-8">{renderContent()}</main>
      
      {/* Account Settings Modal */}
      <AccountSettingsModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        user={user}
        onSignOut={handleSignOut}
        onOpenPremiumModal={() => setIsPremiumModalOpen(true)}
      />

      {/* Toast notifications */}
      <Toast message={toast.message} type={toast.type} isVisible={toast.visible} onDismiss={hideToast} />

      {/* Premium Upgrade Modal (Dodo Payments Checkout) */}
      <PremiumModal isOpen={isPremiumModalOpen} onClose={() => setIsPremiumModalOpen(false)} user={user} />

      {/* Guided Tour Overlay */}
      {showTour && (
        <TourOverlay
          step={TOUR_STEPS[tourStep]}
          totalSteps={TOUR_STEPS.length}
          currentStep={tourStep}
          onNext={nextTourStep}
          onSkip={dismissTour}
          onDismiss={dismissTour}
        />
      )}
    </div>
  );
};

// --- APP ROOT ---
import ExtensionBridge from './ExtensionBridge';

export default function App({ initialView = 'dashboard' }) {
  const [viewMode, setViewMode] = useState(initialView); 
  const [showSplash, setShowSplash] = useState(() => initialView === 'dashboard');
  const [splashExiting, setSplashExiting] = useState(false);

  useEffect(() => {
    if (!showSplash) return;
    const exitTimer = setTimeout(() => setSplashExiting(true), 1500);
    const removeTimer = setTimeout(() => setShowSplash(false), 2000);
    return () => { clearTimeout(exitTimer); clearTimeout(removeTimer); };
  }, [showSplash]);

  const openDashboardTab = (view = null) => { 
    if (window.chrome && chrome.tabs && chrome.runtime?.id) { 
      const sep = DASHBOARD_URL.includes('?') ? '&' : '?';
      let url = `${DASHBOARD_URL}${sep}extensionId=${chrome.runtime.id}`;
      if (view) url += `&view=${view}`;
      chrome.tabs.create({ url }); 
    } else { 
      setViewMode('dashboard');
      if (view) {
        const url = new URL(window.location);
        url.searchParams.set('view', view);
        window.history.replaceState({}, '', url);
      }
    } 
  };
  
  const params = new URLSearchParams(window.location.search);
  if (params.get('mode') === 'extension-bridge') {
    return <ExtensionBridge />;
  }

  return (
    <>
      {showSplash && (
        <div className={`splash-screen ${splashExiting ? 'splash-exit' : ''}`}>
          <img src={getIconUrl()} alt="Onextap" className="splash-logo" />
          <div className="splash-text">Onextap</div>
          <div className="splash-bar"><div className="splash-bar-fill" /></div>
        </div>
      )}
      {viewMode === 'popup'
        ? <PopupView onLaunchDashboard={openDashboardTab} onLaunchAnswerStudio={() => openDashboardTab('vault')} />
        : <DashboardView onClose={() => window.close()} />
      }
    </>
  );
}
