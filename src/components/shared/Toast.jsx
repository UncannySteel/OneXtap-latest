import React, { useEffect } from 'react';
import { CheckCircle, Activity, AlertTriangle } from 'lucide-react';

// --- TOAST COMPONENT ---
/**
 * Bottom-centre status toast. Renders nothing without both `isVisible` and a
 * `message`.
 *
 * @param {object}   props
 * @param {string}   props.message
 * @param {'success'|'error'|'loading'} [props.type='success'] Picks the icon
 *   and colours. 'success' and 'error' self-dismiss after 3s via `onDismiss`;
 *   'loading' persists until the caller hides it.
 * @param {boolean}  props.isVisible
 * @param {() => void} props.onDismiss
 */
const Toast = ({ message, type = 'success', isVisible, onDismiss }) => {
  useEffect(() => {
    if (!isVisible || !message || type === 'loading') return;
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [isVisible, message, type, onDismiss]);

  if (!isVisible || !message) return null;
  return (
    <div 
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl shadow-lg border flex items-center gap-2 toast-enter ${
        type === 'loading' 
          ? 'bg-onextap-dark text-white border-onextap-primary/30' 
          : type === 'error'
          ? 'bg-red-50 text-red-800 border-red-200'
          : 'bg-white text-onextap-dark border-onextap-primary/30'
      }`}
      role="status"
    >
      {type === 'loading' && <Activity className="animate-spin shrink-0" size={18} />}
      {type === 'success' && <CheckCircle className="text-onextap-primary shrink-0" size={18} />}
      {type === 'error' && <AlertTriangle className="text-red-600 shrink-0" size={18} />}
      <span className="text-sm font-medium">{message}</span>
    </div>
  );
};

export default Toast;
