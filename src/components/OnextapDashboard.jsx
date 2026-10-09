import React from 'react';
import { DASHBOARD_URL } from '../config';
import PopupView from './popup/PopupView';

// --- APP ROOT ---
/**
 * App root of the extension popup.
 *
 * The dashboard and the landing page used to be rendered from this same
 * React tree; they are now the website (web/: the landing page at `/`, the
 * dashboard at `/dashboard/`, plain JS — see vite.dashboard.config.js). What
 * is left here is the popup, and the one thing it needs from the website:
 * opening the dashboard in a tab.
 *
 * The file keeps its name so existing imports and docs stay valid.
 */
export default function App() {
  /**
   * Opens the web dashboard in a tab. `?extensionId=` tells the dashboard
   * which extension to sync profiles to, and `?view=` which workspace to open
   * (vault → Answer Studio, jobs → Job Matches, cover → Cover Letter, profiles).
   */
  const openDashboardTab = (view = null) => {
    const url = new URL(DASHBOARD_URL);
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) url.searchParams.set('extensionId', chrome.runtime.id);
    if (view) url.searchParams.set('view', view);
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) chrome.tabs.create({ url: url.toString() });
    else window.open(url.toString(), '_blank', 'noopener,noreferrer');
  };

  return (
    <PopupView
      onLaunchDashboard={() => openDashboardTab()}
      onLaunchAnswerStudio={() => openDashboardTab('vault')}
      onLaunchJobMatches={() => openDashboardTab('jobs')}
      onLaunchCoverLetters={() => openDashboardTab('cover')}
    />
  );
}
