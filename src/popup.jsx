import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './components/OnextapDashboard';
import ErrorBoundary from './components/ErrorBoundary';
import { DASHBOARD_URL } from './config';
import { installGlobalErrorHandlers } from './logger';

// Catches unhandled rejections and errors thrown outside React's render tree.
installGlobalErrorHandlers();

// This is the extension popup's entry. The dashboard is the website now
// (web/dashboard/), so this page opened anywhere but inside the extension —
// or with the old ?mode=dashboard — goes there instead of rendering a popup
// with no extension APIs behind it.
const isExtension = !!(window.chrome && chrome.runtime && chrome.runtime.id);
const params = new URLSearchParams(window.location.search);

if (!isExtension || params.get('mode') === 'dashboard') {
  window.location.replace(DASHBOARD_URL);
} else {
  document.documentElement.style.width = '400px';
  document.documentElement.style.height = '600px';

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
