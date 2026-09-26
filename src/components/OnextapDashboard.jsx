import React, { useState, useEffect } from 'react';
import { DASHBOARD_URL } from '../config';
import { getIconUrl } from '../extensionClient';
import PopupView from './popup/PopupView';
import DashboardView from './dashboard/DashboardView';
import CookieConsentBanner from './dashboard/CookieConsentBanner';

// --- APP ROOT ---
/**
 * App root. Picks the surface to render and shows the splash screen.
 *
 * Two outcomes: `initialView === 'popup'` renders PopupView, anything else
 * renders DashboardView. popup.jsx decides which by sniffing the extension
 * runtime and the `mode` query param.
 *
 * @param {object} props
 * @param {'dashboard'|'popup'} [props.initialView='dashboard']
 */
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
        ? <PopupView
            onLaunchDashboard={openDashboardTab}
            onLaunchAnswerStudio={() => openDashboardTab('vault')}
            onLaunchJobMatches={() => openDashboardTab('jobs')}
          />
        : <DashboardView onClose={() => window.close()} />
      }
      {viewMode !== 'popup' && <CookieConsentBanner />}
    </>
  );
}