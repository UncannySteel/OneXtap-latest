import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { getIconUrl } from '../../extensionClient';

/**
 * Sections of the full-screen menu, numbered the way the columns read.
 * Every `id` must match a `<section id>` on the landing page — a link with no
 * target scrolls nowhere and looks broken.
 */
export const MENU_SECTIONS = [
  {
    n: '01',
    title: 'Product',
    items: [
      { id: 'features', label: 'Features' },
      { id: 'how-it-works', label: 'How it works' },
      { id: 'pricing', label: 'Pricing' },
    ],
  },
  {
    n: '02',
    title: 'Company',
    items: [
      { id: 'about', label: 'About' },
      { id: 'contact', label: 'Contact' },
    ],
  },
  {
    n: '03',
    title: 'Support',
    items: [
      { id: 'faq', label: 'FAQ' },
      { id: 'feedback', label: 'Feedback' },
    ],
  },
];

/** Flat position of each item across all sections — drives the open stagger. */
const STAGGER_INDEX = new Map(MENU_SECTIONS.flatMap((s) => s.items).map((item, i) => [item.id, i]));

/**
 * Log in / Get Extension pair. Rendered twice — once inside the rail for the
 * mobile top bar, once in the desktop top bar — so the two placements can
 * differ without the markup being written out twice.
 */
const AuthActions = ({ compact, onSignIn, onGetExtension }) => (
  <>
    <button
      type="button"
      onClick={onSignIn}
      className={`pointer-events-auto rounded-md font-medium text-onextap-secondary transition-colors hover:text-onextap-primary dark:text-[#9AB07A] dark:hover:text-onextap-olive-pale ${
        compact ? 'px-1.5 py-1 text-[13px]' : 'px-3 py-2 text-[14px]'
      }`}
    >
      Log in
    </button>
    <button
      type="button"
      onClick={onGetExtension}
      className={`pointer-events-auto whitespace-nowrap rounded-md bg-onextap-primary font-medium text-white transition-colors hover:bg-onextap-primary-dark ${
        compact ? 'px-3 py-1.5 text-[12.5px]' : 'px-5 py-2 text-[14px]'
      }`}
    >
      Get Extension
    </button>
  </>
);

/**
 * Dark mode as a switch rather than an icon button: the knob carries the mode
 * that is on, and it leans toward where it is about to travel on hover, so the
 * control reads as throwable before you touch it.
 *
 * @param {object} props
 * @param {boolean} props.darkMode
 * @param {() => void} props.onToggle
 * @param {string} [props.className]
 * @param {number} [props.tabIndex]
 */
const ThemeSwitch = ({ darkMode, onToggle, className = '', tabIndex }) => (
  <button
    type="button"
    role="switch"
    tabIndex={tabIndex}
    aria-checked={darkMode}
    aria-label="Dark mode"
    title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
    onClick={onToggle}
    className={`group relative inline-flex h-[24px] w-[44px] shrink-0 items-center rounded-full border transition-[background-color,border-color,box-shadow] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-onextap-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-onextap-cream dark:focus-visible:ring-offset-onextap-night ${
      darkMode
        ? 'border-[rgba(200,216,168,0.3)] bg-onextap-primary hover:border-onextap-olive-pale hover:shadow-[0_0_0_3px_rgba(200,216,168,0.14)]'
        : 'border-[rgba(42,60,28,0.25)] bg-white hover:border-onextap-primary hover:shadow-[0_0_0_3px_rgba(45,74,45,0.10)]'
    } ${className}`}
  >
    <span
      className={`ot-switch-knob pointer-events-none flex h-[18px] w-[18px] items-center justify-center rounded-full shadow-sm group-active:scale-90 ${
        darkMode
          ? 'translate-x-[22px] bg-onextap-olive-pale text-onextap-primary group-hover:translate-x-[19px]'
          : 'translate-x-[2px] bg-onextap-primary text-white group-hover:translate-x-[5px]'
      }`}
    >
      {darkMode ? <Moon size={11} strokeWidth={2.25} /> : <Sun size={11} strokeWidth={2.25} />}
    </span>
  </button>
);

/**
 * Landing-page navigation: a fixed rail down the left edge (a top bar below
 * `md`), the Log in / Get Extension pair pinned top-right, and a full-screen
 * menu the rail's hamburger opens.
 *
 * Holds only its own presentational state — open/closed and whether the page
 * has scrolled. Dark mode and scrolling stay with PublicLandingPage.
 *
 * @param {object} props
 * @param {boolean} props.darkMode
 * @param {() => void} props.onToggleDarkMode
 * @param {(id: string) => void} props.onNavigate Scrolls to a section id.
 * @param {() => void} props.onSignIn
 * @param {() => void} props.onGetExtension
 */
const LandingNav = ({ darkMode, onToggleDarkMode, onNavigate, onSignIn, onGetExtension }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  // The closing animation must not run on mount, or the icon unfolds from an
  // X nobody opened.
  const [everOpened, setEverOpened] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const toggleMenu = () => {
    setEverOpened(true);
    setMenuOpen((open) => !open);
  };

  const go = (id) => {
    setMenuOpen(false);
    onNavigate(id);
  };

  const burgerState = menuOpen ? 'is-open' : everOpened ? 'is-closed' : '';

  return (
    <>
      <header
        className="fixed inset-x-0 top-0 z-[45] flex h-[68px] items-center gap-2 border-b border-[rgba(42,60,28,0.12)] bg-onextap-cream/90 px-5 backdrop-blur-xl transition-colors duration-300 dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night/90 md:inset-x-auto md:left-0 md:h-full md:w-16 md:flex-col md:gap-0 md:border-b-0 md:border-r md:px-0 md:py-6 lg:w-[72px]"
      >
        <button
          type="button"
          onClick={() => { setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          className="flex shrink-0 items-center gap-2.5 text-left"
          aria-label="Onextap — back to top"
        >
          <img
            src={getIconUrl()}
            alt=""
            className="h-8 w-8 shrink-0 rounded-lg shadow-sm ring-1 ring-black/[0.06] dark:ring-white/10"
          />
          {/* Below sm the wordmark crowds Log in / Get Extension off the bar,
              and above md the rail is too narrow for it. */}
          <span className="hidden text-[16px] font-semibold tracking-tight text-onextap-dark dark:text-[#E8EFD8] sm:inline md:hidden">
            Onextap
          </span>
        </button>

        <div className="ml-auto flex items-center gap-1.5 md:hidden">
          <AuthActions compact onSignIn={onSignIn} onGetExtension={onGetExtension} />
        </div>

        <button
          type="button"
          onClick={toggleMenu}
          aria-expanded={menuOpen}
          aria-controls="site-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-onextap-secondary transition-colors hover:text-onextap-primary dark:text-[#9AB07A] dark:hover:text-onextap-olive-pale md:w-full md:flex-1 md:rounded-none md:p-0"
        >
          <svg
            className={`ot-burger ${burgerState}`}
            width="30"
            height="30"
            viewBox="0 0 30 30"
            fill="none"
            aria-hidden="true"
          >
            <path className="ot-burger-mid" d="M15 3v24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <path className="ot-burger-right" d="M23 3v24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <path className="ot-burger-left" d="M7 3v24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>

        <ThemeSwitch darkMode={darkMode} onToggle={onToggleDarkMode} className="hidden md:inline-flex" />
      </header>

      <div
        className={`pointer-events-none fixed right-0 top-0 z-[45] hidden transition-colors duration-300 md:left-16 md:block lg:left-[72px] ${
          scrolled
            ? 'border-b border-[rgba(42,60,28,0.12)] bg-onextap-cream/85 backdrop-blur-xl dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night/85'
            : 'border-b border-transparent'
        }`}
      >
        <div className="flex h-[68px] items-center justify-end gap-2 px-10">
          <AuthActions onSignIn={onSignIn} onGetExtension={onGetExtension} />
        </div>
      </div>

      <nav
        id="site-menu"
        aria-label="Site"
        className={`fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-onextap-cream pt-[68px] transition-[opacity,visibility] duration-300 dark:bg-onextap-night md:pl-16 md:pt-0 lg:pl-[72px] ${
          menuOpen ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
      >
        {/* `visibility: hidden` takes the closed menu out of the tab order, but it
            is transitioned — so it reads `visible` for 300ms on the way out. The
            explicit tabIndex covers that window. */}
        <div className="mx-auto flex min-h-full max-w-[1100px] flex-col px-6 py-10 md:px-10 md:py-12">
          <div className="my-auto grid gap-11 sm:grid-cols-2 lg:grid-cols-3 lg:gap-12">
            {MENU_SECTIONS.map((section) => (
              <section key={section.n}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-onextap-muted dark:text-[#9AB07A]">
                  <span className="mr-2 tabular-nums">{section.n}</span>
                  {section.title}
                </p>
                <ul className="mt-5 space-y-3 md:mt-7 md:space-y-5">
                  {section.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => go(item.id)}
                        tabIndex={menuOpen ? 0 : -1}
                        style={{ transitionDelay: menuOpen ? `${100 + STAGGER_INDEX.get(item.id) * 45}ms` : '0ms' }}
                        className={`ot-menu-item font-display text-[34px] font-normal leading-[1.1] tracking-[-0.02em] underline decoration-[2px] underline-offset-[7px] transition-all duration-500 md:text-[46px] lg:text-[52px] text-onextap-dark decoration-onextap-dark/20 hover:text-onextap-primary hover:decoration-onextap-primary dark:text-[#E8EFD8] dark:decoration-[rgba(200,216,168,0.28)] dark:hover:text-onextap-olive-pale dark:hover:decoration-onextap-olive-pale ${
                          menuOpen ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
                        }`}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-[rgba(42,60,28,0.12)] pt-6 dark:border-[rgba(200,216,168,0.15)]">
            <div className="flex items-center gap-4">
              <a
                href="/privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] font-light text-onextap-secondary underline underline-offset-4 transition-colors hover:text-onextap-primary dark:text-[#9AB07A] dark:hover:text-onextap-olive-pale"
                tabIndex={menuOpen ? 0 : -1}
              >
                Privacy Policy
              </a>
              <span className="inline-flex items-center gap-2.5 md:hidden">
                <span className="text-[13px] font-light text-onextap-secondary dark:text-[#9AB07A]">Dark mode</span>
                <ThemeSwitch darkMode={darkMode} onToggle={onToggleDarkMode} tabIndex={menuOpen ? 0 : -1} />
              </span>
            </div>
            <p className="text-[13px] font-light text-onextap-muted dark:text-[#9AB07A]/70">
              &copy; {new Date().getFullYear()} Onextap
            </p>
          </div>
        </div>
      </nav>
    </>
  );
};

export default LandingNav;
