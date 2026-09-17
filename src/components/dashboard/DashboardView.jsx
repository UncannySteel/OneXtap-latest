import React, { useState, useEffect } from 'react';
import { Activity, Briefcase, Crown, FileText, Layout, LogOut, Moon, PenTool, Settings, Shield, Sun, User, Zap } from 'lucide-react';
import { getApplicationType, setApplicationType } from '../../applicationTypeStorage';
import { APPLICATION_TYPES, getApplicationTypeConfig } from '../../applicationTypes';
import { onAuthStateChange, signOut as supaSignOut } from '../../auth';
import { DASHBOARD_URL } from '../../config';
import { creditManager } from '../../creditManager';
import { getIconUrl } from '../../extensionClient';
import { storage } from '../../storage';
import Toast from '../shared/Toast';
import PremiumModal from './PremiumModal';
import OverviewPage from './OverviewPage';
import AccountSettingsModal from './AccountSettingsModal';
import PublicLandingPage from './PublicLandingPage';
import { useAuthForm } from './useAuthForm';
import TourOverlay, { TOUR_STEPS } from './TourOverlay';
import ProfilesPage from './ProfilesPage';
import VaultPage from './VaultPage';
import CoverLetterPage from './CoverLetterPage';
import JobMatchesPage from './JobMatchesPage';
import { log as baseLog } from '../../logger';

const log = baseLog.child('ui');

// Simple password strength helper
// Returns: 'weak' | 'medium' | 'strong' | null
// --- DASHBOARD VIEW (Main Auth Logic — Supabase) ---
/**
 * Root of the signed-in dashboard, and the app's auth boundary.
 *
 * Owns the Supabase session (via onAuthStateChange), the sign-in form state it
 * passes down to PublicLandingPage, premium status, the active tab, the
 * application type, and the guided tour. Renders PublicLandingPage until a
 * session exists.
 *
 * Also handles the post-checkout `?payment=success` return by polling
 * verify-premium until the Dodo webhook lands.
 *
 * @param {object} props
 * @param {() => void} props.onClose Closes the surrounding window — meaningful
 *   in the popup, a no-op on the web dashboard.
 */
const DashboardView = ({ onClose }) => {
  const viewFromUrl = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('view') : null;
  const [activeNav, setActiveNav] = useState(
    viewFromUrl === 'vault' ? 'vault'
      : viewFromUrl === 'cover' ? 'cover'
      : viewFromUrl === 'jobs' ? 'jobs'
      : 'overview'
  );
  const [applicationType, setApplicationTypeState] = useState('job');
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

  useEffect(() => {
    getApplicationType().then(setApplicationTypeState);
  }, []);

  const appConfig = getApplicationTypeConfig(applicationType);

  // `activeNav` is chosen on the very first render, from `?view=`, while
  // `applicationType` is still the hardcoded default above and its real value
  // is loading asynchronously. So a deep link could land on a tab this
  // application type does not have: `?view=jobs` as a Scholarship user opened
  // Job Matches with no sidebar item to match it. handleApplicationTypeChange
  // guards the same thing, but only for a change the user makes by hand — it
  // never runs for that initial load.
  useEffect(() => {
    const enabled = {
      jobs: appConfig.features.jobMatches,
      profiles: appConfig.features.profiles,
      vault: appConfig.features.vault,
      cover: appConfig.features.coverLetter,
    };
    if (activeNav in enabled && !enabled[activeNav]) setActiveNav('overview');
  }, [appConfig, activeNav]);

  const handleApplicationTypeChange = async (nextType) => {
    await setApplicationType(nextType);
    setApplicationTypeState(nextType);
    const nextConfig = getApplicationTypeConfig(nextType);
    if (activeNav === 'vault' && !nextConfig.features.vault) setActiveNav('overview');
    if (activeNav === 'cover' && !nextConfig.features.coverLetter) setActiveNav('overview');
    if (activeNav === 'profiles' && !nextConfig.features.profiles) setActiveNav('overview');
    if (activeNav === 'jobs' && !nextConfig.features.jobMatches) setActiveNav('overview');
  };

  const dashboardNavItems = [
    { id: 'overview', icon: Layout, label: 'Overview', enabled: true },
    { id: 'jobs', icon: Briefcase, label: 'Job Matches', enabled: appConfig.features.jobMatches },
    { id: 'profiles', icon: User, label: 'My Profiles', enabled: appConfig.features.profiles },
    { id: 'vault', icon: PenTool, label: appConfig.vaultLabel, enabled: appConfig.features.vault },
    { id: 'cover', icon: FileText, label: appConfig.coverLetterLabel, enabled: appConfig.features.coverLetter },
  ].filter((item) => item.enabled);
  const [user, setUser] = useState(null); // Supabase User Object
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Sign-in/sign-up form state and handlers. DashboardView stays the auth
  // boundary: the hook reports success here and owns nothing else.
  const authForm = useAuthForm({
    onAuthenticated: (signedInUser) => {
      setUser(signedInUser);
      setIsCheckingAuth(false);
    },
  });
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [contentKey, setContentKey] = useState(0);
  const [isPremiumUser, setIsPremiumUser] = useState(false);

  // Guided tour state
  const [showTour, setShowTour] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  // Initialize Supabase & Check Auth
  useEffect(() => {
    const { unsubscribe } = onAuthStateChange((event, session) => {
      if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session?.user) {
        setUser(session.user);
        // Premium status is not read here — the lazy check keyed on user.id
        // below fetches it once the user is set.
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setIsPremiumUser(false);
        setContentKey((k) => k + 1);
      }
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        setIsCheckingAuth(false);
      }
    });

    // Fallback: never block the UI if auth listener doesn't fire promptly
    const authTimeout = setTimeout(() => setIsCheckingAuth(false), 5000);

    return () => {
      clearTimeout(authTimeout);
      unsubscribe();
    };
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
      log.warn('Storage clear on sign-out:', err);
    }

    setContentKey((k) => k + 1);
  };

  const [toast, setToast] = useState({ message: '', type: 'success', visible: false });
  const [isPremiumModalOpen, setIsPremiumModalOpen] = useState(false);

  // Lazy premium check — fires once after login, non-blocking, doesn't delay the UI
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    creditManager.verifyPremium()
      .then(p => { if (!cancelled) setIsPremiumUser(p); })
      .catch(() => {}); // silent fail — UI shows free tier by default
    return () => { cancelled = true; };
  }, [user?.id]); // only re-runs when the actual user ID changes, not on every re-render

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
      case 'jobs': return <JobMatchesPage key={contentKey} showToast={showToast} />;
      case 'profiles': return <ProfilesPage key={contentKey} showToast={showToast} />;
      case 'vault': return <VaultPage key={contentKey} showToast={showToast} user={user} />;
      case 'cover': return <CoverLetterPage key={contentKey} showToast={showToast} user={user} applicationType={applicationType} />;
      default: return <OverviewPage key={contentKey} user={user} onNavigate={setActiveNav} isPremium={isPremiumUser} />;
    }
  };

  // Auth loading — avoid showing a broken dashboard shell while session is restored
  if (isCheckingAuth && !user) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-onextap-cream text-onextap-dark dark:bg-onextap-night dark:text-[#E8EFD8]">
        <div className="flex items-center gap-3 rounded-xl border border-[rgba(42,60,28,0.12)] bg-white px-6 py-4 shadow-sm dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night-card">
          <Activity className="animate-spin text-onextap-primary" size={20} />
          <span className="text-sm font-medium text-onextap-secondary dark:text-[#9AB07A]">Loading your account...</span>
        </div>
      </div>
    );
  }

  // Landing page when not signed in (same style as popup)
  if (!user) {
    return (
      <>
        <PublicLandingPage
          {...authForm}
          onOpenPremiumModal={() => setIsPremiumModalOpen(true)}
          user={user}
        />
        <Toast message={toast.message} type={toast.type} isVisible={toast.visible} onDismiss={hideToast} />
        <PremiumModal isOpen={isPremiumModalOpen} onClose={() => setIsPremiumModalOpen(false)} user={user} />
      </>
    );
  }

  return (
    <div className="relative flex min-h-screen w-full overflow-hidden bg-onextap-cream text-onextap-dark transition-colors duration-300 dark:bg-onextap-night dark:text-[#E8EFD8]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-onextap-primary/[0.07] blur-3xl dark:bg-onextap-primary/[0.12]" />
        <div className="absolute bottom-0 left-1/4 h-64 w-64 rounded-full bg-onextap-olive-muted/40 blur-3xl dark:opacity-20" />
      </div>

      <aside className="sidebar-enter fixed z-10 flex h-full w-72 flex-col border-r border-[rgba(42,60,28,0.12)] bg-onextap-cream/95 backdrop-blur-md transition-colors dark:border-[rgba(200,216,168,0.12)] dark:bg-onextap-night-surface/95">
        <button
          type="button"
          onClick={() => { window.location.href = DASHBOARD_URL; }}
          className="flex items-center gap-3 border-b border-[rgba(42,60,28,0.12)] p-6 dark:border-[rgba(200,216,168,0.12)] w-full text-left hover:bg-onextap-primary/5 dark:hover:bg-white/[0.04] transition-colors duration-200"
          title="Go to home page"
        >
          <img src={getIconUrl()} alt="Onextap" className="h-10 w-10 shrink-0 rounded-xl shadow-sm ring-1 ring-black/[0.06] dark:ring-white/10" />
          <span className="text-xl font-semibold tracking-tight text-onextap-dark dark:text-[#E8EFD8]">Onextap</span>
        </button>
        
        <div className="border-b border-[rgba(42,60,28,0.12)] p-5 dark:border-[rgba(200,216,168,0.12)]">
          {isCheckingAuth && !user ? (
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

        <div className="border-b border-[rgba(42,60,28,0.12)] px-5 py-4 dark:border-[rgba(200,216,168,0.12)]">
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-onextap-muted dark:text-[#9AB07A]">
            Application type
          </label>
          <select
            value={applicationType}
            onChange={(e) => handleApplicationTypeChange(e.target.value)}
            className="w-full rounded-lg border border-[rgba(42,60,28,0.15)] bg-white px-3 py-2 text-sm text-onextap-dark focus:border-onextap-primary/40 focus:outline-none focus:ring-2 focus:ring-onextap-primary/10 dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night-card dark:text-[#E8EFD8]"
          >
            {APPLICATION_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <p className="mt-1.5 text-[11px] leading-snug text-onextap-muted dark:text-[#9AB07A]">{appConfig.description}</p>
        </div>

        <nav className="flex-1 p-5 space-y-2" data-tour="sidebar-nav">
          {dashboardNavItems.map((i, idx) => (
            <button 
              key={i.id} 
              onClick={() => {
                if (showTour) dismissTour();
                setActiveNav(i.id);
              }}
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

export default DashboardView;
