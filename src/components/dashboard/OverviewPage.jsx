import React from 'react';
import { FileText, User, PenTool, Sparkles, Cloud, Crown } from 'lucide-react';

/**
 * Dashboard landing tab: greeting, plan state, and shortcuts into the other
 * tabs. Read-only — it fetches nothing itself.
 *
 * @param {object} props
 * @param {object|null} props.user Supabase user, for the greeting.
 * @param {(nav: 'overview'|'profiles'|'vault'|'cover') => void} props.onNavigate
 * @param {boolean} props.isPremium Resolved by the parent; drives the plan badge.
 */
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
          onClick={() => onNavigate?.('cover')}
          className="group rounded-[14px] border border-[rgba(42,60,28,0.12)] bg-white p-6 text-left shadow-sm transition-all duration-300 hover:bg-onextap-cream hover:shadow-md dark:border-onextap-primary-light/25 dark:bg-onextap-night-card dark:hover:border-onextap-primary-light/40 dark:hover:bg-[#2a3824] dark:hover:shadow-[0_8px_28px_rgba(0,0,0,0.35)]"
        >
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-[10px] bg-onextap-olive-muted transition-colors group-hover:bg-onextap-olive-pale/40 dark:bg-onextap-primary/25 dark:group-hover:bg-onextap-primary/35">
            <FileText size={22} className="text-onextap-primary dark:text-onextap-olive-pale" />
          </div>
          <h3 className="mb-1 font-semibold text-onextap-dark dark:text-[#E8EFD8]">Cover Letters</h3>
          <p className="text-sm text-onextap-secondary dark:text-[#9AB07A]">
            Store templates, personalize for each role, and fill from the extension.
          </p>
        </button>
      </div>
    </div>
  );
};

export default OverviewPage;
