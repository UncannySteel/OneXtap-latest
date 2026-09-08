import React, { useEffect } from 'react';
import { storage } from '../storage';

/**
 * ExtensionBridge — postMessage RPC endpoint for an embedded dashboard.
 *
 * Mounted (instead of the dashboard UI) when the app is loaded with
 * `?mode=extension-bridge`; see the check in OnextapDashboard.jsx. Renders
 * nothing. It listens for requests from `window.parent` and replies with a
 * matching `*_RESPONSE` message carrying the same `requestId`:
 *
 *   PING                     → { success }
 *   GET_PROFILE              → { data: active profile in legacy shape }
 *   GET_VAULT                → { data: saved answers array }
 *   GENERATE_IMPROVED_ANSWER → { text } — relayed to the service worker
 *
 * Unrecognised types and thrown errors both reply with type 'ERROR'.
 * Announces itself to the parent with BRIDGE_READY on mount.
 *
 * NOTE: nothing in this repo currently loads the dashboard with that query
 * param or embeds it in an iframe — the extension popup renders the dashboard
 * directly and talks to the service worker over chrome.runtime. This is kept
 * as an entry point for an external embedder; if none appears, it and the
 * `?mode=extension-bridge` branch can both go.
 */
export default function ExtensionBridge() {
  useEffect(() => {
    const handleMessage = async (event) => {
      // Security: Accept same origin or extension origin (when dashboard is in iframe from popup)
      const isSameOrigin = event.origin === window.location.origin;
      const isExtensionOrigin = event.origin?.startsWith('chrome-extension://');
      if (!isSameOrigin && !isExtensionOrigin) return;

      const { type, requestId, payload } = event.data;
      if (!requestId) return;

      try {
        switch (type) {
          case 'PING':
            window.parent.postMessage({ type: 'PING_RESPONSE', requestId, success: true }, '*');
            break;

          case 'GET_PROFILE': {
            const { getActiveLegacyProfile } = await import('../profileStore');
            const profile = await getActiveLegacyProfile();
            window.parent.postMessage({ 
              type: 'GET_PROFILE_RESPONSE', 
              requestId, 
              success: true, 
              data: profile 
            }, '*');
            break;
          }

          case 'GET_VAULT': {
            const { getActiveLegacyProfile } = await import('../profileStore');
            const profileData = await getActiveLegacyProfile();
            const vault = profileData?.vault || [];
            window.parent.postMessage({ 
              type: 'GET_VAULT_RESPONSE', 
              requestId, 
              success: true, 
              data: vault 
            }, '*');
            break;
          }

          case 'GENERATE_IMPROVED_ANSWER':
            // Forward to background script for AI generation
            if (chrome.runtime && chrome.runtime.sendMessage) {
              chrome.runtime.sendMessage({
                action: 'GENERATE_IMPROVED_ANSWER',
                data: payload
              }, (response) => {
                if (chrome.runtime.lastError) {
                  window.parent.postMessage({ 
                    type: 'GENERATE_IMPROVED_ANSWER_RESPONSE', 
                    requestId, 
                    success: false, 
                    error: chrome.runtime.lastError.message 
                  }, '*');
                } else if (response && response.success) {
                  window.parent.postMessage({ 
                    type: 'GENERATE_IMPROVED_ANSWER_RESPONSE', 
                    requestId, 
                    success: true, 
                    text: response.text 
                  }, '*');
                } else {
                  window.parent.postMessage({ 
                    type: 'GENERATE_IMPROVED_ANSWER_RESPONSE', 
                    requestId, 
                    success: false, 
                    error: response?.error || 'Generation failed' 
                  }, '*');
                }
              });
            } else {
              window.parent.postMessage({ 
                type: 'GENERATE_IMPROVED_ANSWER_RESPONSE', 
                requestId, 
                success: false, 
                error: 'Chrome runtime not available' 
              }, '*');
            }
            break;

          default:
            window.parent.postMessage({ 
              type: 'ERROR', 
              requestId, 
              success: false, 
              error: 'Unknown request type' 
            }, '*');
        }
      } catch (error) {
        window.parent.postMessage({ 
          type: 'ERROR', 
          requestId, 
          success: false, 
          error: error.message 
        }, '*');
      }
    };

    window.addEventListener('message', handleMessage);
    
    // Notify parent that bridge is ready
    window.parent.postMessage({ type: 'BRIDGE_READY' }, '*');

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  return null; // This component doesn't render anything
}
