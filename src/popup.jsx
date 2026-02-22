import React from 'react';
import ReactDOM from 'react-dom/client';
import { SpeedInsights } from '@vercel/speed-insights/react';
import './index.css'; 
import App from './components/OnextapDashboard'; 

const isExtension = !!(window.chrome && chrome.runtime && chrome.runtime.id);
const params = new URLSearchParams(window.location.search);
const urlMode = params.get('mode');

let startView = 'dashboard';
if (urlMode === 'dashboard') {
  startView = 'dashboard';
  document.documentElement.style.width = '100%';
  document.documentElement.style.height = '100vh';
} else if (isExtension) {
  startView = 'popup';
  document.documentElement.style.width = '400px';
  document.documentElement.style.height = '600px';
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App initialView={startView} />
    {!isExtension && <SpeedInsights />}
  </React.StrictMode>
);
