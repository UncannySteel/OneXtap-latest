import React, { useEffect } from 'react';
import { storage } from '../storage';

/**
 * ExtensionBridge Component
 * Used when dashboard is loaded in bridge mode for popup communication
 * Handles requests from popup iframe for profile/vault data and AI generation
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
