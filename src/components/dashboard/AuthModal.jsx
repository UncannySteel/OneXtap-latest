import React, { useEffect, useRef } from 'react';
import { Activity, X } from 'lucide-react';

/**
 * Sign-in / sign-up dialog.
 *
 * Fully controlled: every field and its setter belongs to `useAuthForm` in
 * DashboardView, so this holds no auth state of its own — only the dialog
 * behaviour (escape, backdrop, scroll lock, focus). It unmounts with the
 * landing page the moment a sign-in succeeds, which is what dismisses it.
 *
 * @param {object} props
 * @param {boolean} props.isOpen Returns null when false.
 * @param {() => void} props.onClose
 * @param {'signin'|'signup'} props.authMode
 * @param {(mode: 'signin'|'signup') => void} props.setAuthMode
 * @param {string} props.authName
 * @param {(v: string) => void} props.setAuthName
 * @param {string} props.authEmail
 * @param {(v: string) => void} props.setAuthEmail
 * @param {string} props.authPassword
 * @param {(v: string) => void} props.setAuthPassword
 * @param {boolean} props.showPassword
 * @param {(v: boolean) => void} props.setShowPassword
 * @param {'weak'|'medium'|'strong'|null} props.passwordStrength
 * @param {(v: 'weak'|'medium'|'strong'|null) => void} props.setPasswordStrength
 * @param {string} props.authError
 * @param {boolean} props.isSigningIn
 * @param {() => void} props.handleSignIn Handles both sign-in and sign-up.
 * @param {() => void} props.handleGoogleSignIn
 */
const AuthModal = ({
  isOpen,
  onClose,
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
}) => {
  const cardRef = useRef(null);
  // Held in a ref so a fresh inline onClose from the parent cannot re-run the
  // effect below and steal focus back on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return undefined;

    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    const focusTimer = setTimeout(() => cardRef.current?.querySelector('input')?.focus(), 0);

    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const isSignup = authMode === 'signup';

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-in-scale relative max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-[rgba(42,60,28,0.12)] bg-white p-8 shadow-xl dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night-card"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-lg p-2 text-onextap-muted transition-colors hover:bg-black/[0.04] hover:text-onextap-dark dark:text-[#9AB07A] dark:hover:bg-white/[0.06] dark:hover:text-[#E8EFD8]"
        >
          <X size={18} />
        </button>

        <div className="mb-7 text-center">
          <h2
            id="auth-modal-title"
            className="mb-2 font-display text-[28px] font-normal tracking-tight text-onextap-dark dark:text-[#E8EFD8]"
          >
            {isSignup ? 'Create your account' : 'Welcome back'}
          </h2>
          <p className="text-[14px] text-onextap-muted dark:text-[#9AB07A]">
            {isSignup ? 'Get started for free — no credit card required.' : 'Sign in to access your dashboard.'}
          </p>
        </div>

        <div className="space-y-4">
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
          {isSignup && (
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
            {isSigningIn ? <><Activity size={16} className="animate-spin shrink-0" /> Connecting...</> : (isSignup ? 'Create Account' : 'Sign In')}
          </button>
          <p className="text-[13px] text-onextap-dark/45 dark:text-white/45 text-center pt-1">
            {isSignup ? (
              <>Already have an account? <button onClick={() => setAuthMode('signin')} className="text-onextap-primary font-semibold hover:underline dark:text-onextap-olive-pale">Sign in</button></>
            ) : (
              <>Don&apos;t have an account? <button onClick={() => setAuthMode('signup')} className="text-onextap-primary font-semibold hover:underline dark:text-onextap-olive-pale">Sign up</button></>
            )}
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
