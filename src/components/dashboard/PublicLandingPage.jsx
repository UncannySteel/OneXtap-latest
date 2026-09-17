import React, { useState, useEffect } from 'react';
import { Plus, Activity, X, ArrowRight, Zap, Moon, Sun, Menu } from 'lucide-react';
import { getIconUrl, openChromeWebStore } from '../../extensionClient';

/**
 * Signed-out marketing page with the inline sign-in / sign-up form.
 *
 * Fully controlled: every auth field and its setter is owned by DashboardView
 * and passed down, so this component holds only presentational state (FAQ
 * accordion, mobile menu, dark mode).
 *
 * @param {object} props
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
 * @param {(e: Event) => void} props.handleSignIn Handles both sign-in and sign-up.
 * @param {() => void} props.handleGoogleSignIn
 * @param {() => void} props.onOpenPremiumModal
 * @param {object|null} props.user
 */
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
  onOpenPremiumModal,
  user,
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
              onClick={openChromeWebStore}
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
                  onClick={openChromeWebStore}
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
                  onClick={openChromeWebStore}
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
                { emoji: '📈', title: 'Cover Letter Studio', desc: 'Upload and store cover letters, personalize with AI for each application, and fill them in one click from the extension.' },
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
                  onClick={() => {
                    if (user) {
                      onOpenPremiumModal();
                    } else {
                      scrollToSection('auth');
                    }
                  }}
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
            onClick={openChromeWebStore}
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
                <button type="button" onClick={openChromeWebStore} className="block text-left text-[14px] font-light text-onextap-cream/65 transition-colors hover:text-onextap-cream">
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

export default PublicLandingPage;
