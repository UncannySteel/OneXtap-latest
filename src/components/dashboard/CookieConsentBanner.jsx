import React, { useEffect, useState } from 'react';
import { log as baseLog } from '../../logger';
import { hasSeenCookieNotice, markCookieNoticeSeen, setAnalyticsConsent } from '../../consent';

const log = baseLog.child('CookieConsent');

/**
 * Bottom-fixed disclosure bar for the public web dashboard/landing page.
 * Never rendered inside the extension popup — see OnextapDashboard.jsx.
 *
 * There's nothing to block today (no analytics run yet), so this is a
 * disclosure with an easy opt-out rather than a GDPR-style consent gate —
 * see privacy-policy.html, "Cookies & Local Storage".
 */
const CookieConsentBanner = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seen = await hasSeenCookieNotice();
      if (!cancelled && !seen) setVisible(true);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!visible) return null;

  const dismiss = async (choice) => {
    if (choice === 'opted-out') await setAnalyticsConsent(false);
    await markCookieNoticeSeen();
    log.info('cookie notice dismissed', { choice });
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="animate-fade-in fixed inset-x-0 bottom-0 z-50 flex justify-center p-4"
    >
      <div className="flex w-full max-w-3xl flex-col gap-4 rounded-2xl border border-[rgba(42,60,28,0.12)] bg-white p-5 shadow-xl sm:flex-row sm:items-center sm:justify-between dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night-card">
        <p className="text-[13.5px] leading-relaxed text-onextap-muted dark:text-[#9AB07A]">
          We keep you signed in using your browser&apos;s local storage, not cookies. No analytics run on this site today — if that changes, you can opt out here or read the details in our{' '}
          <a
            href="/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-onextap-primary/40 underline-offset-2 hover:text-onextap-dark dark:hover:text-white"
          >
            privacy policy
          </a>.
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => dismiss('opted-out')}
            className="rounded-full border border-onextap-dark/15 px-5 py-2.5 text-[13.5px] font-medium text-onextap-dark transition-colors hover:bg-black/[0.04] dark:border-white/15 dark:text-[#E8EFD8] dark:hover:bg-white/[0.06]"
          >
            Opt out of analytics
          </button>
          <button
            type="button"
            onClick={() => dismiss('accepted')}
            className="rounded-full bg-onextap-dark px-5 py-2.5 text-[13.5px] font-medium text-white transition-colors hover:bg-onextap-dark/90 dark:bg-white dark:text-onextap-night dark:hover:bg-white/90"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};

export default CookieConsentBanner;
