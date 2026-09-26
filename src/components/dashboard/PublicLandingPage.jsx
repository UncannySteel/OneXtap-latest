import React, { useState, useEffect } from 'react';
import { Plus, ArrowRight, Mail, MessageSquare } from 'lucide-react';
import { getIconUrl, openChromeWebStore } from '../../extensionClient';
import LandingNav from './LandingNav';
import HeroSpotlight from './HeroSpotlight';
import ManifestoSection from './ManifestoSection';
import FeatureCarousel from './FeatureCarousel';
import AboutSection from './AboutSection';
import SiteFooter from './SiteFooter';
import FeedbackModal from './FeedbackModal';

/** Where the "Contact" card's mailto is addressed. Feedback goes through the server instead — see FeedbackModal. */
const CONTACT_EMAIL = 'mazzah70@gmail.com';

/**
 * Signed-out marketing page.
 *
 * Holds only presentational state (FAQ accordion, dark mode, the feedback
 * dialog). Signing in is AuthModal's job — this page just asks for it by
 * mode. The rail, the top bar and the hamburger menu are LandingNav's; this
 * page owns dark mode and section scrolling for it.
 *
 * @param {object} props
 * @param {(mode: 'signin'|'signup') => void} props.onOpenAuth Opens the sign-in dialog.
 * @param {() => void} props.onOpenPremiumModal
 * @param {(message: string, type?: 'success'|'error') => void} props.showToast
 * @param {object|null} props.user
 */
const PublicLandingPage = ({
  onOpenAuth,
  onOpenPremiumModal,
  showToast,
  user,
}) => {
  const [openFaq, setOpenFaq] = useState(null);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
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

  // Pricing has a hover treatment, and a touch screen can never show it. So on
  // touch the card lights up when it is the one you have actually scrolled to
  // — the band is the middle third of the screen, and whichever card is
  // crossing it is the card being read. Pointer devices take the `:hover` path
  // in CSS and never run this at all.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return undefined;
    if (!window.matchMedia('(hover: none)').matches) return undefined;
    const cards = document.querySelectorAll('.ot-price-card');
    if (!cards.length) return undefined;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.target.classList.toggle('is-near', e.isIntersecting)),
      { rootMargin: '-34% 0px -34% 0px' },
    );
    cards.forEach((c) => obs.observe(c));
    return () => obs.disconnect();
  }, []);

  return (
    /* `overflow-x-clip`, never `hidden`: `hidden` makes this element a scroll
       container, and every `position: sticky` below it then sticks to *this*
       box instead of the viewport — which silently breaks the manifesto, the
       walkthrough and the About crumple at once. `clip` suppresses the same
       sideways overflow without creating that container. */
    <div className="relative min-h-screen w-full overflow-x-clip bg-onextap-cream pt-[68px] text-onextap-dark transition-colors duration-300 dark:bg-onextap-night dark:text-[#E8EFD8] md:pl-16 lg:pl-[72px]">
      <LandingNav
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        onNavigate={scrollToSection}
        onSignIn={() => onOpenAuth('signin')}
        onGetExtension={openChromeWebStore}
      />

      <main className="relative z-10">
        {/* Hero: the animation and nothing else. The wordmark lives inside
            it, and the nav still carries Log in / Get Extension. */}
        <section className="px-6 pb-8 pt-8 sm:pt-12 md:px-12 md:pb-10 md:pt-16">
          <div className="mx-auto w-full max-w-[1100px]">
            <HeroSpotlight />
          </div>
          {/* The hero used to end on empty page. The cue hands the ~2.3s
              animation off to the manifesto instead of letting it just stop. */}
          <div className="ot-scroll-cue mx-auto mt-6 flex w-full max-w-[1100px] justify-center md:mt-10" aria-hidden="true">
            <span className="ot-scroll-cue-rule" />
            <span className="ot-scroll-cue-text">Scroll</span>
            <span className="ot-scroll-cue-rule" />
          </div>
        </section>

        <ManifestoSection />

        {/* Features, as a rail you drag. The six features are the cards; the
            three how-it-works steps are the legend under them, which is what
            each card's chips point at. Both nav anchors still land: `#features`
            is the section, `#how-it-works` is that legend. */}
        <FeatureCarousel />

        <section id="pricing" className="scroll-mt-20 bg-onextap-cream-dark px-6 py-16 md:px-12 md:py-24 dark:bg-onextap-night-surface">
          <div className="mx-auto max-w-[1100px]">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-onextap-primary-light dark:text-onextap-olive-pale">Pricing</p>
            <h2 className="font-display max-w-md text-[32px] font-normal leading-[1.1] tracking-[-0.02em] text-onextap-dark sm:text-[36px] md:text-[44px] dark:text-[#E8EFD8]">
              Simple,
              <br />
              <em className="not-italic text-onextap-primary dark:text-onextap-olive-pale">transparent.</em>
            </h2>
            <p className="mt-4 max-w-lg text-[16px] font-light leading-relaxed text-onextap-secondary dark:text-[#9AB07A]">
              Start free with fast standard AI, then upgrade for unlimited high-quality AI generation.
            </p>
            <div className="mx-auto mt-14 grid max-w-[780px] grid-cols-1 gap-6 md:grid-cols-2">
              <div className="ot-price-card reveal-scale stagger-1 flex flex-col rounded-[14px] border border-[rgba(42,60,28,0.12)] bg-white p-7 sm:p-9 dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night-card">
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
                  onClick={() => onOpenAuth('signup')}
                  className="mt-8 block w-full rounded-lg border-[1.5px] border-[rgba(42,60,28,0.25)] py-3.5 text-center text-[14px] font-medium text-onextap-dark transition-colors hover:bg-onextap-cream dark:border-[rgba(200,216,168,0.2)] dark:text-[#E8EFD8] dark:hover:bg-onextap-night-surface"
                >
                  Get started free
                </button>
              </div>
              <div className="ot-price-card ot-price-card--featured reveal-scale stagger-2 relative flex flex-col rounded-[14px] border border-onextap-primary bg-onextap-primary p-7 text-white shadow-lg sm:p-9 dark:border-onextap-primary-dark dark:bg-onextap-primary-dark">
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
                      onOpenAuth('signup');
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

        {/* About moved into its own component: the copy is unchanged, but
            it now sits on a sheet that crumples as you scroll out of it and
            hands over to the FAQ. */}
        <AboutSection />

        <section id="faq" className="scroll-mt-20 px-6 py-16 md:px-12 md:py-24">
          <div className="mx-auto max-w-[720px]">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-onextap-primary-light dark:text-onextap-olive-pale">FAQ</p>
            <h2 className="font-display mb-14 text-[32px] font-normal leading-[1.1] tracking-[-0.02em] text-onextap-dark sm:text-[36px] md:text-[44px] md:mb-16 dark:text-[#E8EFD8]">
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
                  className={`ot-faq-item reveal stagger-${i + 1} ${openFaq === i ? 'is-open' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleFaq(i)}
                    className="ot-faq-q"
                    aria-expanded={openFaq === i}
                    aria-controls={`ot-faq-a-${i}`}
                    id={`ot-faq-q-${i}`}
                  >
                    <span>{q}</span>
                    <Plus size={18} className="ot-faq-icon" aria-hidden="true" />
                  </button>
                  {/* The answer stays mounted so opening can be animated; the
                      panel goes `visibility: hidden` when closed, which is what
                      keeps a collapsed answer out of the accessibility tree
                      instead of merely clipped. */}
                  <div className="ot-faq-panel" id={`ot-faq-a-${i}`} role="region" aria-labelledby={`ot-faq-q-${i}`}>
                    <div>
                      <p>{a}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

      </main>

      {/* One closing band. It carries the call to action, Feedback and
          Contact that used to be three separate full-width sections, plus
          the link columns — same copy, and both section ids move with it. */}
      <SiteFooter
        onNavigate={scrollToSection}
        onOpenAuth={onOpenAuth}
        contactEmail={CONTACT_EMAIL}
        onOpenFeedback={() => setIsFeedbackOpen(true)}
      />

      <FeedbackModal
        isOpen={isFeedbackOpen}
        onClose={() => setIsFeedbackOpen(false)}
        showToast={showToast}
      />

    </div>
  );
};

export default PublicLandingPage;
