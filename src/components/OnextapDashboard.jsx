import React, { useState, useEffect, useRef } from 'react';
import { 
  Layout, FileText, Shield, Plus, CheckCircle, 
  User, ExternalLink, Lock, Save, Activity, Trash2, Calendar, 
  PenTool, Sparkles, Clipboard, ChevronLeft, ChevronDown, Briefcase, GraduationCap, Flag,
  MapPin, Award, Code, Cloud, LogOut, Terminal, Settings, X, AlertTriangle, Crown, ArrowRight,
  CreditCard, Zap, Moon, Sun, Menu
} from 'lucide-react';
import { storage } from '../storage'; 
import { COUNTRIES, GENDERS } from '../../extension/constants';
import { signIn as supaSignIn, signUp as supaSignUp, signOut as supaSignOut, onAuthStateChange, signInWithOAuth, getAccessToken } from '../auth';
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
const API_URL = import.meta.env.VITE_API_URL || '';
const ANSWER_STUDIO_MODEL = import.meta.env.VITE_ANSWER_STUDIO_MODEL || "gemini-2.5-pro";
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
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      <div className="bg-white/80 dark:bg-white/[0.05] backdrop-blur-sm p-10 rounded-3xl border border-onextap-primary/15 dark:border-white/[0.06] shadow-lg shadow-onextap-dark/5 dark:shadow-black/10 text-center relative overflow-hidden transition-colors">
        <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-onextap-primary/10 to-transparent rounded-full blur-2xl" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-gradient-to-tr from-onextap-cream/40 dark:from-onextap-cream/[0.04] to-transparent rounded-full blur-xl" />
        
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-onextap-primary/10 border border-onextap-primary/20 mb-6">
            <Sparkles size={14} className="text-onextap-primary" />
            <span className="text-onextap-dark/80 dark:text-white/80 text-sm font-medium">Your job application hub</span>
          </div>
          
          <h1 className="text-3xl font-bold text-onextap-dark dark:text-white mb-3 tracking-tight">Welcome to Onextap</h1>
          <p className="text-onextap-dark/60 dark:text-white/50 mb-8 max-w-md mx-auto leading-relaxed">
            Configure your profile and Answer Studio to autofill job applications in one click.
          </p>
          
          <div className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium shadow-sm ${
            user 
              ? 'bg-gradient-to-r from-onextap-primary/15 to-onextap-primary/5 text-onextap-primary border border-onextap-primary/25' 
              : 'bg-white/80 dark:bg-white/[0.06] text-onextap-dark/60 dark:text-white/60 border border-onextap-primary/15 dark:border-white/[0.08]'
          }`}>
            <Cloud size={16} />
            {user ? `Signed in as ${user.user_metadata?.full_name || user.email?.split('@')[0]}` : "Local Mode (Sign in to Sync)"}
            {user && isPremium && <Crown size={14} className="text-amber-500" />}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-4">
        <button onClick={() => onNavigate?.('profiles')} className="bg-white/70 dark:bg-white/[0.04] backdrop-blur-sm p-6 rounded-2xl border border-onextap-primary/15 dark:border-white/[0.06] shadow-sm hover:shadow-md hover:bg-white/90 dark:hover:bg-white/[0.07] transition-all duration-300 group text-left">
          <div className="p-3 rounded-xl bg-onextap-primary/10 dark:bg-onextap-primary/15 w-fit mb-4 group-hover:bg-onextap-primary/15 dark:group-hover:bg-onextap-primary/25 transition-colors">
            <User size={22} className="text-onextap-primary" />
          </div>
          <h3 className="font-bold text-onextap-dark dark:text-white mb-1">My Profiles</h3>
          <p className="text-sm text-onextap-dark/60 dark:text-white/50">Add your personal info, education, and experience</p>
        </button>
        <button onClick={() => onNavigate?.('vault')} className="bg-white/70 dark:bg-white/[0.04] backdrop-blur-sm p-6 rounded-2xl border border-onextap-primary/15 dark:border-white/[0.06] shadow-sm hover:shadow-md hover:bg-white/90 dark:hover:bg-white/[0.07] transition-all duration-300 group text-left">
          <div className="p-3 rounded-xl bg-onextap-primary/10 dark:bg-onextap-primary/15 w-fit mb-4 group-hover:bg-onextap-primary/15 dark:group-hover:bg-onextap-primary/25 transition-colors">
            <PenTool size={22} className="text-onextap-primary" />
          </div>
          <h3 className="font-bold text-onextap-dark dark:text-white mb-1">Answer Studio</h3>
          <p className="text-sm text-onextap-dark/60 dark:text-white/50">
            {isPremium
              ? 'Unlimited high-quality AI generation with deeper rewrites and profile-tailored answers'
              : 'Fast standard AI generation with 3 credits, plus profile-tailored answer improvements'}
          </p>
        </button>
      </div>
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
      const saved = await storage.get('user_profile');
      if (saved) {
        const mergedProfile = { ...DEFAULT_PROFILE, ...saved };
        // Deep merge safe-guards
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
      // Save using storage wrapper (handles local + Chrome storage)
      await storage.set('user_profile', profile);
  
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

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
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
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [tempItem, setTempItem] = useState({ question: '', answer: '' });
  const [manualCompany, setManualCompany] = useState('');
  const [manualJobDescription, setManualJobDescription] = useState('');
  const [answerStyle, setAnswerStyle] = useState('balanced');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [hasAutoGeneratedOnce, setHasAutoGeneratedOnce] = useState(false);
  const [credits, setCredits] = useState(null);
  const [creditsError, setCreditsError] = useState(null);
  const [premiumStatus, setPremiumStatus] = useState(false);
  const hasChrome = typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage;

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
      const saved = await storage.get('user_profile');
      if (saved) setProfile({ ...DEFAULT_PROFILE, ...saved });
      await loadCredits();
    };
    load();
  }, []);

  const saveVault = async (newVault) => {
    const newProfile = { ...profile, vault: newVault };
    setProfile(newProfile);
    await storage.set('user_profile', newProfile);
    setTempItem({ question: '', answer: '' });
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
    if (isDuplicate) {
      showToast?.('Answer exists', 'error');
      return;
    }
    saveVault([...profile.vault, { id: Date.now(), ...tempItem }]);
    showToast?.('Added to vault', 'success');
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
      const jdSnippet = hasJobContext ? String(contextDescription).substring(0, 2000) : '';
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
      const profileStrengthHighlights = [
        profileSkills ? `Top skills: ${profileSkills}` : '',
        recentExperience ? `Relevant experience: ${recentExperience}` : '',
      ].filter(Boolean).join('\n');
      const profileContext = [
        currentRole ? `Current Role: ${currentRole}` : '',
        profileSkills ? `Core Skills: ${profileSkills}` : '',
        recentExperience ? `Recent Experience: ${recentExperience}` : '',
      ].filter(Boolean).join('\n');
      const profileContextBlock = profileContext
        ? `Candidate Profile Context (use when relevant and avoid inventing facts):\n${profileContext}\n`
        : '';
      const profileStrengthBlock = profileStrengthHighlights
        ? `Candidate Strength Highlights (prioritize these when relevant):\n${profileStrengthHighlights}\n`
        : '';
      const selectedStyleInstruction =
        ANSWER_STYLE_INSTRUCTIONS[answerStyle] || ANSWER_STYLE_INSTRUCTIONS.balanced;
      const richerLengthRule = 'Target length: 170-240 words unless the question clearly needs less.';
      const measurableImpactRule = 'Include at least one measurable or observable impact/result. Prefer numbers/percentages/timeframes when truthful; never invent facts.';

      const prompt = hasGeneric
        ? hasJobContext
          ? `You are an expert career coach and ghostwriter.
Task: Rewrite the candidate's "Generic Answer" to specifically target the "Job Description" and "Company" provided.
Constraints: 1) Tone: Human, natural, and confident (not robotic). 2) ${richerLengthRule} 3) Use first-person voice ("I"). 4) Include at least two concrete details (skills, results, tools, or achievements) tied to the role. 5) Weave in 2-3 job-description keywords naturally. 6) ${measurableImpactRule} 7) Prioritize relevant strengths from Candidate Profile Context and Candidate Strength Highlights. 8) No filler, no cliches, no headings, no bullet points. 9) Do NOT use placeholders like "job profile", "company name", "this role", or bracketed tokens. If company is unknown, avoid naming one. 10) Make it sound like a high-potential, hire-ready candidate while staying truthful. 11) Style preference: ${selectedStyleInstruction}
Company: ${companyName}
Job Description Snippet: ${jdSnippet}
${profileContextBlock}${profileStrengthBlock}Application Question: "${q}"
Candidate's Generic Answer: "${userAnswer}"
Refined Answer:`
          : `You are an expert career coach and ghostwriter.
Task: Improve the candidate's answer so it is stronger, clearer, and more professional.
Constraints: 1) Tone: Human, natural, and confident. 2) ${richerLengthRule} 3) Keep the original meaning, but make it more specific and compelling. 4) Use first-person voice and include one concrete example or outcome. 5) ${measurableImpactRule} 6) Prioritize relevant strengths from Candidate Profile Context and Candidate Strength Highlights. 7) No filler, no cliches, no headings, no bullet points. 8) Do NOT use placeholders like "job profile", "company name", "this role", or bracketed tokens. 9) Make it sound polished and hire-ready while staying truthful. 10) Style preference: ${selectedStyleInstruction}
${profileContextBlock}${profileStrengthBlock}Application Question: "${q}"
Candidate's Existing Answer: "${userAnswer}"
Improved Answer:`
        : hasJobContext
          ? `You are an expert career coach and ghostwriter.
Task: Write a short, professional answer to the following application question. Use the "Job Description" and "Company" to tailor your answer.
Constraints: 1) Tone: Human, natural, and confident. 2) ${richerLengthRule} 3) Use first-person voice. 4) Include at least two concrete details (skills, results, tools, or achievements). 5) Mention 2-3 keywords from the job description naturally. 6) ${measurableImpactRule} 7) Prioritize relevant strengths from Candidate Profile Context and Candidate Strength Highlights. 8) No filler, no cliches, no headings, no bullet points. 9) Make the answer open-ended and interview-ready (not a template). 10) Do NOT use placeholders like "job profile", "company name", "this role", or bracketed tokens. 11) Make it sound polished and like a strong potential hire while staying factual. 12) Style preference: ${selectedStyleInstruction}
Company: ${companyName}
Job Description Snippet: ${jdSnippet}
${profileContextBlock}${profileStrengthBlock}Application Question: "${q}"
Your Answer:`
          : `You are an expert career coach and ghostwriter.
Task: Write a strong, open-ended first-draft answer to the following application question that can work across companies and job descriptions.
Constraints: 1) Tone: Human, natural, and confident. 2) Target length: 160-230 words unless the question clearly needs less. 3) Use first-person voice. 4) Include at least one concrete skill and one measurable or observable result. 5) ${measurableImpactRule} 6) Prioritize relevant strengths from Candidate Profile Context and Candidate Strength Highlights. 7) Make it broadly applicable but still specific enough to sound real. 8) No filler, no cliches, no headings, no bullet points. 9) Do NOT use placeholders like "job profile", "company name", "this role", or bracketed tokens. 10) Keep it open-ended, polished, and professional so it can fit many companies. 11) Style preference: ${selectedStyleInstruction}
${profileContextBlock}${profileStrengthBlock}Application Question: "${q}"
Your Answer:`;

      const token = await getAccessToken();
      if (!token) throw new Error('Please sign in first.');

      const generatePromise = fetch(`${API_URL}/api/answer-vault/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          prompt,
          model: ANSWER_STUDIO_MODEL,
          qualityMode: premiumStatus ? 'high' : 'standard',
        }),
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

      // --- CREDIT DEDUCTION AFTER SUCCESSFUL GENERATION ---
      try {
        const deductResult = await withTimeout(
          creditManager.deductCredit(),
          CREDIT_API_TIMEOUT_MS,
          'Credit update timed out after generation.'
        );
        if (!deductResult.success) {
          setGenerateError(deductResult.error || 'Answer generated, but credits could not be updated.');
        } else {
          setCredits(deductResult.isPremium ? Infinity : deductResult.remaining);
        }
      } catch (creditErr) {
        console.warn('Credit deduction failed after generation:', creditErr);
        setGenerateError('Answer generated, but credit update failed. Please refresh credits.');
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

  return (
    <div className="animate-fade-in max-w-3xl mx-auto space-y-6">
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
              onChange={e => { setTempItem({...tempItem, question: e.target.value}); setGenerateError(''); }}
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
            </div>
            {creditsError && (
              <div className="mt-3 text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
                Couldn't load credits: {creditsError}
                <p className="text-xs mt-1">Make sure the server is running (npm run dev in server/) and SUPABASE_SERVICE_ROLE_KEY is set correctly in server/.env</p>
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
                <p className="mt-2 text-xs text-amber-800/80">Make sure the server is running and SUPABASE_SERVICE_ROLE_KEY is set correctly in server/.env</p>
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


// --- POPUP VIEW (Landing - Animated, two states: signed-in vs onboarding) ---
const PopupView = ({ onLaunchDashboard, onLaunchAnswerStudio }) => {
  const [status, setStatus] = useState('Autofill Application');
  const [hasProfile, setHasProfile] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    storage.get('user_profile').then((profile) => {
      if (mounted) {
        const has = !!profile && (typeof profile === 'object' ? (profile.firstName || profile.email || profile.vault?.length) : true);
        setHasProfile(!!has);
        setChecking(false);
      }
    });
    return () => { mounted = false; };
  }, []);

  const handleAutofill = async () => {
    setStatus('Loading...');
    const profile = await storage.get('user_profile');
    
    if (!profile) { 
      setStatus('No Profile - Open Dashboard'); 
      setTimeout(() => setStatus('Autofill Application'), 3000);
      return; 
    }
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if(tab?.id) {
       try {
         await chrome.scripting.executeScript({
           target: { tabId: tab.id },
           files: ['content.js']
         });
       } catch (err) {
         console.error("Onextap: Failed to inject content script:", err);
         setStatus('Error: Cannot access this page');
         setTimeout(() => setStatus('Autofill Application'), 3000);
         return;
       }

       chrome.tabs.sendMessage(tab.id, { action: "AUTOFILL_TRIGGERED", profile }, (res) => {
         if (chrome.runtime.lastError) {
           console.error("Onextap: Tab message error:", chrome.runtime.lastError);
           setStatus('Error: ' + chrome.runtime.lastError.message);
           setTimeout(() => setStatus('Autofill Application'), 3000);
           return;
         }
         setStatus(res?.filled ? `Filled ${res.filled}!` : (res?.success === false ? 'Error: ' + (res?.error || 'Failed') : 'Done'));
         setTimeout(() => setStatus('Autofill Application'), 2000);
       });
    } else {
      setStatus('Error: No active tab');
      setTimeout(() => setStatus('Autofill Application'), 3000);
    }
  };

  if (checking) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#f8f7f4] via-[#faf9f6] to-[#f0ebe3] p-6">
        <div className="w-9 h-9 rounded-full border-2 border-onextap-primary/20 border-t-onextap-primary animate-spin" />
        <p className="text-onextap-dark/50 text-sm mt-3 font-medium">Loading...</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col relative overflow-hidden min-h-0 bg-gradient-to-br from-[#f8f7f4] via-[#faf9f6] to-[#ebe6de]">
      {/* Soft gradient mesh background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-onextap-primary/10 blur-2xl animate-float-slow opacity-90" />
        <div className="absolute top-1/3 -left-12 w-36 h-36 rounded-full bg-onextap-cream/60 blur-xl animate-float opacity-80" style={{ animationDelay: '0.5s' }} />
        <div className="absolute bottom-1/4 right-0 w-32 h-32 rounded-full bg-onextap-primary-light/15 blur-2xl animate-float-slow opacity-90" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-onextap-primary/5 blur-3xl" />
      </div>

      <header className="relative z-10 px-4 py-4 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2.5 opacity-0 animate-fade-up animate-delay-100" style={{ animationFillMode: 'forwards' }}>
          <img src={getIconUrl()} className="w-9 h-9 rounded-xl shadow-md ring-1 ring-white/60" alt="Onextap" />
          <span className="font-bold text-onextap-dark text-lg tracking-tight">Onextap</span>
        </div>
        {hasProfile && (
          <button
            onClick={onLaunchDashboard}
            className="opacity-0 animate-fade-up animate-delay-200 flex items-center gap-1.5 text-onextap-dark/60 hover:text-onextap-primary hover:bg-white/60 py-2 px-3 rounded-xl text-xs font-medium transition-all duration-300"
            style={{ animationFillMode: 'forwards' }}
          >
            <Layout size={14} className="shrink-0" />
            Dashboard
          </button>
        )}
      </header>
      
      <div className="flex-1 overflow-y-auto px-5 pb-6 flex flex-col items-center justify-center relative z-10 min-h-0">
        {hasProfile ? (
          /* --- Signed in: Open Answer Studio (primary) + Autofill (secondary) --- */
          <div className="w-full space-y-5 max-w-[340px]">
            <div className="text-center space-y-4 opacity-0 animate-fade-up animate-delay-200" style={{ animationFillMode: 'forwards' }}>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/80 backdrop-blur-sm border border-onextap-primary/15 shadow-sm">
                <CheckCircle size={14} className="shrink-0 text-onextap-primary" />
                <span className="text-onextap-dark/90 text-sm font-medium">You&apos;re all set</span>
              </div>
              <p className="text-onextap-dark/60 text-sm leading-relaxed">
                Improve answers with AI, then autofill forms in one click.
              </p>
            </div>
            <div className="space-y-4 opacity-0 animate-scale-in animate-delay-300" style={{ animationFillMode: 'forwards' }}>
              <button 
                onClick={onLaunchAnswerStudio}
                className="w-full relative overflow-hidden bg-gradient-to-br from-onextap-primary via-onextap-primary to-onextap-primary-dark text-white py-4 px-5 rounded-2xl font-bold text-base shadow-lg shadow-onextap-primary/25 hover:shadow-xl hover:shadow-onextap-primary/30 hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-300 flex items-center justify-center gap-3 group"
              >
                <span className="absolute inset-0 bg-[linear-gradient(110deg,transparent_40%,rgba(255,255,255,.15)_50%,transparent_60%)] bg-[length:200%_100%] animate-shine opacity-90" aria-hidden />
                <PenTool size={20} className="shrink-0 relative z-10 group-hover:rotate-6 transition-transform" />
                <span className="relative z-10">Open Answer Studio</span>
              </button>
              <p className="text-xs text-onextap-dark/45 text-center">
                Open the dashboard for AI-powered answer improvement
              </p>
              <button 
                onClick={handleAutofill}
                className="w-full bg-white/90 backdrop-blur-sm text-onextap-dark border border-onextap-primary/20 py-3.5 px-4 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-white hover:border-onextap-primary/35 hover:shadow-md transition-all duration-300"
              >
                <Clipboard size={18} className="shrink-0" />
                {status}
              </button>
            </div>
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
    <div className={`w-full min-h-screen relative overflow-x-hidden bg-[#faf9f6] dark:bg-[#1c1b18] transition-colors duration-300`}>
      {/* Subtle background accents */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full bg-onextap-primary/[0.06] dark:bg-onextap-primary/[0.08] blur-3xl" />
        <div className="absolute top-1/2 -left-24 w-80 h-80 rounded-full bg-onextap-cream/30 dark:bg-onextap-cream/[0.04] blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full bg-onextap-primary/[0.04] dark:bg-onextap-primary/[0.06] blur-3xl" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-[#faf9f6]/80 dark:bg-[#1c1b18]/80 border-b border-onextap-dark/[0.06] dark:border-white/[0.06] transition-colors">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={getIconUrl()} className="w-8 h-8 rounded-lg" alt="Onextap" />
            <span className="font-bold text-onextap-dark dark:text-white text-[17px] tracking-tight">Onextap</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Dark mode toggle */}
            <button onClick={() => setDarkMode(!darkMode)} className="p-2 rounded-xl text-onextap-dark/50 dark:text-white/50 hover:text-onextap-dark dark:hover:text-white hover:bg-onextap-dark/[0.04] dark:hover:bg-white/[0.06] transition-all" aria-label="Toggle dark mode">
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {/* Hamburger */}
            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2 rounded-xl text-onextap-dark/60 dark:text-white/60 hover:bg-onextap-dark/[0.04] dark:hover:bg-white/[0.06] transition-all" aria-label="Open menu">
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Menu overlay */}
        {mobileMenuOpen && (
          <div className="absolute top-full left-0 right-0 bg-[#faf9f6]/95 dark:bg-[#1c1b18]/95 backdrop-blur-xl border-b border-onextap-dark/[0.06] dark:border-white/[0.06] shadow-xl animate-fade-in">
            <div className="px-6 py-4 space-y-1">
              {[
                { id: 'features', label: 'Features' },
                { id: 'pricing', label: 'Pricing' },
                { id: 'faq', label: 'FAQ' },
              ].map((item) => (
                <button key={item.id} onClick={() => scrollToSection(item.id)} className="w-full text-left px-4 py-3 rounded-xl text-[15px] text-onextap-dark/70 dark:text-white/70 hover:bg-onextap-dark/[0.04] dark:hover:bg-white/[0.06] hover:text-onextap-dark dark:hover:text-white font-medium transition-all">
                  {item.label}
                </button>
              ))}
              <div className="pt-2 border-t border-onextap-dark/[0.06] dark:border-white/[0.06] mt-2 space-y-1">
                <button onClick={() => scrollToSection('auth')} className="w-full text-left px-4 py-3 rounded-xl text-[15px] text-onextap-dark/70 dark:text-white/70 hover:bg-onextap-dark/[0.04] dark:hover:bg-white/[0.06] font-medium transition-all">
                  Sign in
                </button>
                <button onClick={() => scrollToSection('auth')} className="w-full bg-onextap-dark dark:bg-white text-white dark:text-onextap-dark px-4 py-3 rounded-xl text-[15px] font-semibold text-center hover:bg-onextap-dark/90 dark:hover:bg-white/90 transition-colors">
                  Get the Extension
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="px-6 pt-20 md:pt-32 pb-16 md:pb-24">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-[42px] md:text-[72px] leading-[1.05] font-bold text-onextap-dark dark:text-white tracking-tight animate-hero-intro">
              Apply to jobs{'\n'}in one click
            </h1>
            <p className="mt-6 md:mt-8 text-[17px] md:text-[20px] leading-[1.6] text-onextap-dark/50 dark:text-white/50 max-w-2xl mx-auto animate-fade-up">
              Onextap is a browser extension that makes job applications fast and effortless. Enter your information once, and autofill any application with AI-powered personalization.
            </p>
            <div className="mt-10 md:mt-12 flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-up animate-delay-200" style={{ animationFillMode: 'forwards' }}>
              <button onClick={() => scrollToSection('auth')} className="bg-onextap-dark dark:bg-white text-white dark:text-onextap-dark px-8 py-4 rounded-2xl text-[15px] font-semibold hover:bg-onextap-dark/90 dark:hover:bg-white/90 transition-all shadow-lg shadow-onextap-dark/15 dark:shadow-black/20 hover:shadow-xl flex items-center gap-2.5 group">
                Get the Extension <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
              <button onClick={() => scrollToSection('features')} className="text-onextap-dark/55 dark:text-white/55 hover:text-onextap-dark dark:hover:text-white text-[15px] font-medium transition-colors flex items-center gap-1.5">
                Learn More <ArrowRight size={16} />
              </button>
            </div>
            {/* Browser badges */}
            <div className="mt-12 flex flex-col items-center gap-3 animate-fade-up animate-delay-300" style={{ animationFillMode: 'forwards' }}>
              <p className="text-[12px] uppercase tracking-[0.16em] text-onextap-dark/40 dark:text-white/35 font-semibold">Available for</p>
              <div className="flex items-center gap-4 flex-wrap justify-center">
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/70 dark:bg-white/[0.06] border border-onextap-dark/[0.06] dark:border-white/[0.08]">
                  <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#4285F4"/><circle cx="8" cy="8" r="3.5" fill="white"/><path d="M8 4.5h7.2a8 8 0 01.3 3.5H8V4.5z" fill="#EA4335"/></svg>
                  <span className="text-[13px] font-semibold text-onextap-dark dark:text-white">Chrome</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/70 dark:bg-white/[0.06] border border-onextap-dark/[0.06] dark:border-white/[0.08]">
                  <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#FF1B2D"/><circle cx="8" cy="8" r="4" fill="white"/></svg>
                  <span className="text-[13px] font-semibold text-onextap-dark dark:text-white">Opera</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-onextap-dark/[0.03] dark:bg-white/[0.04] border border-dashed border-onextap-dark/10 dark:border-white/10">
                  <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="#999" strokeWidth="1.5"/><path d="M5 3a7.5 7.5 0 010 10" stroke="#999" strokeWidth="1.5" fill="none"/></svg>
                  <span className="text-[13px] font-medium text-onextap-dark/45 dark:text-white/40">Safari</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-onextap-primary bg-onextap-primary/10 px-2 py-0.5 rounded-full">Soon</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Description strip */}
        <section className="px-6 py-16 md:py-20 border-y border-onextap-dark/[0.06] dark:border-white/[0.06]">
          <div className="max-w-3xl mx-auto text-center reveal">
            <h2 className="text-[28px] md:text-[36px] font-bold text-onextap-dark dark:text-white tracking-tight leading-[1.15]">
              Everything you need to apply faster
            </h2>
            <p className="mt-4 text-[16px] md:text-[17px] leading-[1.7] text-onextap-dark/50 dark:text-white/50 max-w-2xl mx-auto">
              Onextap is a productivity tool and personal application copilot&mdash;not an ATS platform. We focus purely on simplifying your application process.
            </p>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="px-6 py-20 md:py-28 scroll-mt-20">
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { icon: FileText, title: 'Enter Once, Use Everywhere', desc: 'Manually enter your information or upload your resume for automatic parsing. Your data is securely stored and ready to use.' },
                { icon: Lock, title: 'Secure Local & Cloud Storage', desc: 'Data stored locally on your device with optional encrypted cloud backup for seamless syncing across all your devices.' },
                { icon: Clipboard, title: 'One-Click Autofill', desc: 'Onextap scans job application forms using DOM analysis and pattern matching, then autofills everything with a single click.' },
                { icon: Layout, title: 'Smart Field Mapping', desc: "If a field isn't recognized, map it once manually. Onextap remembers your mapping for all future applications." },
                { icon: Sparkles, title: 'AI-Powered Personalization', desc: 'Save answers to recurring questions. Our AI reads the job description and suggests personalized improvements you can review before submitting.' },
                { icon: User, title: 'Multiple Profiles', desc: 'Create different profiles for various job types or industries. Switch between them effortlessly as you apply.' },
                { icon: Activity, title: 'Automatic Application Tracking', desc: 'Stay organized without a separate job-tracking platform. Onextap automatically tracks your previous applications, helping you manage your job search effortlessly.' },
              ].map(({ icon: Icon, title, desc }, idx) => (
                <div key={title} className={`reveal-scale stagger-${idx + 1} bg-white/60 dark:bg-white/[0.04] backdrop-blur-sm rounded-2xl border border-onextap-dark/[0.06] dark:border-white/[0.06] p-8 hover:bg-white/80 dark:hover:bg-white/[0.07] hover:shadow-lg hover:shadow-onextap-dark/[0.04] dark:hover:shadow-black/10 transition-all duration-300 group feature-card-hover`}>
                  <div className="w-12 h-12 rounded-xl bg-onextap-primary/10 dark:bg-onextap-primary/15 flex items-center justify-center mb-5 group-hover:bg-onextap-primary/15 dark:group-hover:bg-onextap-primary/25 group-hover:scale-110 transition-all duration-300">
                    <Icon size={22} className="text-onextap-primary" />
                  </div>
                  <h3 className="text-[18px] font-bold text-onextap-dark dark:text-white mb-2">{title}</h3>
                  <p className="text-[15px] text-onextap-dark/55 dark:text-white/50 leading-[1.65]">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="px-6 py-20 md:py-28 bg-onextap-dark/[0.02] dark:bg-white/[0.02] scroll-mt-20">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-14 reveal">
              <p className="text-[12px] uppercase tracking-[0.18em] text-onextap-primary font-semibold mb-4">Pricing</p>
              <h2 className="text-[32px] md:text-[42px] font-bold text-onextap-dark dark:text-white tracking-tight leading-[1.1]">
                Simple, transparent pricing
              </h2>
              <p className="mt-4 text-[16px] text-onextap-dark/50 dark:text-white/50 max-w-lg mx-auto leading-relaxed">
                Start free with fast standard AI, then upgrade for unlimited high-quality AI generation
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
              {/* Free plan */}
              <div className="reveal-scale stagger-1 bg-white/60 dark:bg-white/[0.04] backdrop-blur-sm rounded-2xl border border-onextap-dark/[0.06] dark:border-white/[0.06] p-8 flex flex-col feature-card-hover">
                <p className="text-[12px] uppercase tracking-[0.16em] text-onextap-dark/45 dark:text-white/40 font-semibold">Free</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-[48px] font-bold text-onextap-dark dark:text-white leading-none">$0</span>
                </div>
                <p className="mt-3 text-[15px] text-onextap-dark/50 dark:text-white/45">Perfect for getting started with job applications</p>
                <ul className="mt-6 space-y-3.5 flex-1">
                  {[
                    'Unlimited autofill applications',
                    'Local data storage',
                    'Multiple profiles',
                    'Smart field mapping',
                    '3 fast standard AI credits for personalized answers',
                    'Application tracking',
                  ].map(f => (
                    <li key={f} className="flex items-start gap-3 text-[14px] text-onextap-dark/65 dark:text-white/60">
                      <CheckCircle size={16} className="text-onextap-primary shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button onClick={() => scrollToSection('auth')} className="mt-8 w-full py-3.5 rounded-xl border-2 border-onextap-dark/10 dark:border-white/10 text-onextap-dark dark:text-white font-semibold text-[14px] hover:border-onextap-dark/20 dark:hover:border-white/20 hover:bg-onextap-dark/[0.02] dark:hover:bg-white/[0.04] transition-all">
                  Get Started Free
                </button>
              </div>
              {/* Premium plan */}
              <div className="reveal-scale stagger-2 bg-white/80 dark:bg-white/[0.06] backdrop-blur-sm rounded-2xl border-2 border-onextap-primary/30 p-8 flex flex-col relative shadow-lg shadow-onextap-primary/[0.08] dark:shadow-onextap-primary/[0.15] feature-card-hover">
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 bg-onextap-primary text-white text-[11px] font-bold uppercase tracking-wider rounded-full">
                  Most Popular
                </div>
                <p className="text-[12px] uppercase tracking-[0.16em] text-onextap-primary font-semibold">Premium</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-[48px] font-bold text-onextap-dark dark:text-white leading-none">$5.00</span>
                  <span className="text-[15px] text-onextap-dark/40 dark:text-white/35 ml-1">/month</span>
                </div>
                <p className="mt-3 text-[15px] text-onextap-dark/50 dark:text-white/45">Unlimited AI power for serious job seekers</p>
                <ul className="mt-6 space-y-3.5 flex-1">
                  {[
                    'Everything in Free',
                    'Unlimited high-quality AI answer generation',
                    'Two-pass AI rewrites for stronger final answers',
                    'Deeper profile-tailored answer personalization',
                    'Encrypted cloud backup & sync',
                    'Priority support',
                    'Early access to new features',
                  ].map(f => (
                    <li key={f} className="flex items-start gap-3 text-[14px] text-onextap-dark/65 dark:text-white/60">
                      <CheckCircle size={16} className="text-onextap-primary shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button onClick={onOpenPremiumModal} className="mt-8 w-full py-3.5 rounded-xl bg-onextap-dark dark:bg-white text-white dark:text-onextap-dark font-semibold text-[14px] hover:bg-onextap-dark/90 dark:hover:bg-white/90 transition-colors shadow-md shadow-onextap-dark/15 dark:shadow-black/20">
                  Upgrade to Premium
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="px-6 py-20 md:py-28 scroll-mt-20">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-14 reveal">
              <p className="text-[12px] uppercase tracking-[0.18em] text-onextap-primary font-semibold mb-4">FAQ</p>
              <h2 className="text-[32px] md:text-[42px] font-bold text-onextap-dark dark:text-white tracking-tight leading-[1.1]">
                Frequently Asked Questions
              </h2>
              <p className="mt-4 text-[16px] text-onextap-dark/50 dark:text-white/50">Everything you need to know about Onextap</p>
            </div>
            <div className="space-y-3">
              {[
                { q: 'How is my data stored and protected?', a: 'By default, all your data is stored locally on your device in the browser\'s secure storage. If you enable Cloud Sync, data is transmitted via SSL/TLS encryption to our secure database (Supabase). We never sell, rent, or trade your personal data.' },
                { q: 'Do I have control over AI suggestions?', a: 'Absolutely. AI suggestions are just that — suggestions. You review every AI-generated answer before it\'s saved or used. The AI reads the job description context and your existing answers to suggest improvements, but you always have the final say.' },
                { q: 'Which browsers are supported?', a: 'Onextap is currently available for Chrome and Chromium-based browsers (including Opera, Brave, and Edge). Safari support is coming soon.' },
                { q: 'What happens when I run out of free AI credits?', a: 'Free accounts come with 3 fast standard AI credits for personalized answer generation. Once used, you can upgrade to Premium ($5.00/month) for unlimited high-quality AI generation with deeper rewrites, or continue using all other features like autofill, profiles, and field mapping for free.' },
                { q: 'Can I use different profiles for different job types?', a: 'Yes! You can create multiple profiles for different industries or job types and switch between them when applying. Each profile stores its own set of personal details, experience, and saved answers.' },
                { q: 'Is Onextap an Applicant Tracking System (ATS)?', a: 'No. Onextap is a personal productivity tool and application copilot. We help you fill out applications faster — we don\'t manage hiring pipelines or act as an employer-side ATS. Your data stays with you.' },
              ].map(({ q, a }, i) => (
                <div key={i} className={`reveal stagger-${i + 1} bg-white/60 dark:bg-white/[0.04] backdrop-blur-sm rounded-2xl border border-onextap-dark/[0.06] dark:border-white/[0.06] overflow-hidden transition-all duration-200 hover:bg-white/80 dark:hover:bg-white/[0.07]`}>
                  <button onClick={() => toggleFaq(i)} className="w-full flex items-center justify-between gap-4 p-6 text-left">
                    <span className="text-[15px] md:text-[16px] font-semibold text-onextap-dark dark:text-white">{q}</span>
                    <ChevronDown size={20} className={`text-onextap-dark/40 dark:text-white/40 shrink-0 transition-transform duration-200 ${openFaq === i ? 'rotate-180' : ''}`} />
                  </button>
                  {openFaq === i && (
                    <div className="px-6 pb-6 -mt-1">
                      <p className="text-[14px] md:text-[15px] text-onextap-dark/55 dark:text-white/50 leading-[1.7]">{a}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Banner */}
        <section className="px-6 py-20 md:py-28 bg-onextap-dark/[0.02] dark:bg-white/[0.02]">
          <div className="max-w-3xl mx-auto text-center reveal">
            <h2 className="text-[28px] md:text-[40px] font-bold text-onextap-dark dark:text-white tracking-tight leading-[1.1]">
              Ready to transform your job search?
            </h2>
            <p className="mt-4 text-[16px] text-onextap-dark/50 dark:text-white/50 max-w-lg mx-auto leading-relaxed">
              Join thousands of job seekers who are applying faster with Onextap
            </p>
            <button onClick={() => scrollToSection('auth')} className="mt-8 bg-onextap-dark dark:bg-white text-white dark:text-onextap-dark px-8 py-4 rounded-2xl text-[15px] font-semibold hover:bg-onextap-dark/90 dark:hover:bg-white/90 transition-all shadow-lg shadow-onextap-dark/15 dark:shadow-black/20 hover:shadow-xl inline-flex items-center gap-2.5 group">
              Get Started Free <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </section>

        {/* Auth */}
        <section id="auth" className="px-6 py-20 md:py-28 bg-onextap-dark/[0.02] dark:bg-white/[0.02] scroll-mt-20">
          <div className="max-w-md mx-auto text-center reveal-scale">
            <h2 className="text-[28px] md:text-[36px] font-bold text-onextap-dark dark:text-white tracking-tight mb-2">
              {authMode === 'signup' ? 'Create your account' : 'Welcome back'}
            </h2>
            <p className="text-[15px] text-onextap-dark/45 dark:text-white/45 mb-8">
              {authMode === 'signup' ? 'Get started for free — no credit card required.' : 'Sign in to access your dashboard.'}
            </p>
            <div className="bg-white/70 dark:bg-white/[0.05] backdrop-blur-sm rounded-2xl border border-onextap-dark/[0.06] dark:border-white/[0.06] p-8 shadow-sm space-y-4">
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

      {/* Footer */}
      <footer className="px-6 pt-16 pb-10 border-t border-onextap-dark/[0.06] dark:border-white/[0.06]">
        <div className="max-w-6xl mx-auto reveal">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 md:gap-8">
            {/* Brand */}
            <div className="md:col-span-1">
              <div className="flex items-center gap-2.5 mb-4">
                <img src={getIconUrl()} className="w-8 h-8 rounded-lg" alt="Onextap" />
                <span className="font-bold text-onextap-dark dark:text-white text-[16px]">Onextap</span>
              </div>
              <p className="text-[13px] text-onextap-dark/45 dark:text-white/40 leading-[1.7]">
                Your personal job application copilot. Apply faster with AI-powered autofill and personalization.
              </p>
            </div>
            {/* Product */}
            <div>
              <h4 className="text-[12px] uppercase tracking-[0.14em] text-onextap-dark/50 dark:text-white/40 font-semibold mb-4">Product</h4>
              <div className="space-y-3">
                <button onClick={() => scrollToSection('features')} className="block text-[13px] text-onextap-dark/55 dark:text-white/50 hover:text-onextap-primary transition-colors">Features</button>
                <button onClick={() => scrollToSection('pricing')} className="block text-[13px] text-onextap-dark/55 dark:text-white/50 hover:text-onextap-primary transition-colors">Pricing</button>
                <button onClick={() => scrollToSection('faq')} className="block text-[13px] text-onextap-dark/55 dark:text-white/50 hover:text-onextap-primary transition-colors">FAQ</button>
              </div>
            </div>
            {/* Support */}
            <div>
              <h4 className="text-[12px] uppercase tracking-[0.14em] text-onextap-dark/50 dark:text-white/40 font-semibold mb-4">Support</h4>
              <div className="space-y-3">
                <a href="mailto:mazzah70@gmail.com" className="block text-[13px] text-onextap-dark/55 dark:text-white/50 hover:text-onextap-primary transition-colors">Contact Us</a>
                <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="block text-[13px] text-onextap-dark/55 dark:text-white/50 hover:text-onextap-primary transition-colors">Privacy Policy</a>
              </div>
            </div>
            {/* Get Started */}
            <div>
              <h4 className="text-[12px] uppercase tracking-[0.14em] text-onextap-dark/50 dark:text-white/40 font-semibold mb-4">Get Started</h4>
              <div className="space-y-3">
                <button onClick={() => scrollToSection('auth')} className="block text-[13px] text-onextap-dark/55 dark:text-white/50 hover:text-onextap-primary transition-colors">Install Extension</button>
                <button onClick={() => scrollToSection('auth')} className="block text-[13px] text-onextap-dark/55 dark:text-white/50 hover:text-onextap-primary transition-colors">Sign In</button>
              </div>
            </div>
          </div>
          <div className="mt-12 pt-6 border-t border-onextap-dark/[0.06] dark:border-white/[0.06] flex flex-col md:flex-row items-center justify-between gap-3 text-[12px] text-onextap-dark/35 dark:text-white/30">
            <p>&copy; {new Date().getFullYear()} Onextap. All rights reserved.</p>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-onextap-primary" />
              <span>Chrome &middot; Opera &middot; Safari coming soon</span>
            </div>
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
  const [activeNav, setActiveNav] = useState(viewFromUrl === 'vault' ? 'vault' : 'overview');
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

    const keysToRemove = ['user_profile'];
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
    <div className="w-full min-h-screen flex relative overflow-hidden bg-gradient-to-br from-[#f8f7f4] via-[#faf9f6] to-[#f0ebe3] dark:from-[#1c1b18] dark:via-[#1c1b18] dark:to-[#15140f] transition-colors duration-300">
      {/* Soft gradient mesh background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-onextap-primary/10 dark:bg-onextap-primary/[0.08] blur-3xl animate-float-slow opacity-80" />
        <div className="absolute top-1/3 -left-16 w-56 h-56 rounded-full bg-onextap-cream/50 dark:bg-onextap-cream/[0.04] blur-2xl animate-float opacity-70" style={{ animationDelay: '0.5s' }} />
        <div className="absolute bottom-1/4 right-1/4 w-48 h-48 rounded-full bg-onextap-primary-light/10 dark:bg-onextap-primary-light/[0.06] blur-3xl animate-float-slow opacity-70" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/3 w-80 h-80 rounded-full bg-onextap-primary/5 dark:bg-onextap-primary/[0.04] blur-3xl" />
      </div>

      <aside className="w-72 bg-white/80 dark:bg-[#262520]/80 backdrop-blur-md border-r border-onextap-primary/15 dark:border-white/[0.06] flex flex-col fixed h-full z-10 shadow-xl shadow-onextap-dark/5 dark:shadow-black/20 transition-colors sidebar-enter">
        <div className="p-6 flex items-center gap-3 border-b border-onextap-primary/15 dark:border-white/[0.06]">
          <img src={getIconUrl()} alt="Logo" className="w-10 h-10 rounded-xl shadow-md ring-1 ring-white/60 dark:ring-white/10" />
          <span className="font-bold text-xl text-onextap-dark dark:text-white tracking-tight">Onextap</span>
        </div>
        
        <div className="p-5 border-b border-onextap-primary/15 dark:border-white/[0.06]">
          {isCheckingAuth ? (
            <div className="w-full bg-onextap-primary/10 py-3 rounded-2xl text-sm font-medium flex items-center justify-center gap-2 text-onextap-dark/70 dark:text-white/70">
              <Activity className="animate-spin" size={16} /> Connecting...
            </div>
          ) : user ? (
            <div className="bg-gradient-to-br from-white to-onextap-bg-light dark:from-white/[0.05] dark:to-white/[0.02] p-4 rounded-2xl border border-onextap-primary/20 dark:border-white/[0.08] shadow-sm">
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
          {[{id:'overview', icon:Layout, label:'Overview'}, {id:'profiles', icon:User, label:'My Profiles'}, {id:'vault', icon:PenTool, label:'Answer Studio'}].map((i, idx) => (
            <button 
              key={i.id} 
              onClick={()=>setActiveNav(i.id)} 
              data-tour={`nav-${i.id}`}
              className={`nav-item-enter w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-medium transition-all duration-200 ${
                activeNav===i.id
                  ? 'bg-gradient-to-r from-onextap-primary/15 to-onextap-primary/5 text-onextap-primary shadow-sm border border-onextap-primary/20'
                  : 'text-onextap-dark/70 dark:text-white/60 hover:bg-white/60 dark:hover:bg-white/[0.05] hover:text-onextap-dark dark:hover:text-white hover:shadow-sm'
              }`}
              style={{ animationDelay: `${0.2 + idx * 0.08}s` }}
            >
              <i.icon size={18}/>{i.label}
            </button>
          ))}
        </nav>

        <div className="p-5 border-t border-onextap-primary/15 dark:border-white/[0.06]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-onextap-dark/50 dark:text-white/40">
              <Sparkles size={12} />
              <span>Onextap</span>
            </div>
            <button onClick={() => setDarkMode(!darkMode)} data-tour="dark-toggle" className="p-2 rounded-xl text-onextap-dark/40 dark:text-white/40 hover:text-onextap-dark dark:hover:text-white hover:bg-onextap-dark/[0.04] dark:hover:bg-white/[0.06] transition-all" aria-label="Toggle dark mode">
              {darkMode ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 ml-72 p-8 relative z-10 main-content-enter">{renderContent()}</main>
      
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
