import React, { useState } from 'react';
import { CheckCircle, Lock, Activity, X, AlertTriangle, Crown, CreditCard } from 'lucide-react';
import { creditManager } from '../../creditManager';
import { log as baseLog } from '../../logger';

const log = baseLog.child('ui');

// --- PREMIUM MODAL (Dodo Payments Checkout) ---
/**
 * Premium upsell dialog. Starts a Dodo Payments checkout and navigates the
 * whole window to the hosted checkout page, so this component unmounts on
 * success — only failures render back into it as inline errors.
 *
 * @param {object} props
 * @param {boolean} props.isOpen Returns null when false.
 * @param {() => void} props.onClose
 * @param {object|null} props.user Supabase user; checkout is refused without one.
 */
const PremiumModal = ({ isOpen, onClose, user }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleUpgrade = async () => {
    if (!user?.id) {
      setError('Please sign in first to upgrade.');
      return;
    }

    if (!creditManager?.createCheckoutSession) {
      setError('Payment service unavailable. Please refresh and try again.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const { url } = await creditManager.createCheckoutSession();
      window.location.href = url;
    } catch (err) {
      log.error('Checkout error:', err);
      setError(err.message || 'Failed to start checkout. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-onextap-primary/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-gradient-to-br from-onextap-primary to-onextap-primary-dark p-6 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
          <div className="flex justify-between items-start relative z-10">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Crown size={22} />
                <h2 className="text-xl font-bold">Upgrade to Premium</h2>
              </div>
              <p className="text-white/90 text-sm">Unlimited AI-powered answer generation</p>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="p-6 space-y-5">
          {/* Price */}
          <div className="text-center py-2">
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-4xl font-bold text-onextap-dark">$5.00</span>
              <span className="text-onextap-dark/60 text-sm">/month</span>
            </div>
            <p className="text-xs text-onextap-dark/50 mt-1">Billed monthly. Cancel anytime.</p>
          </div>

          {/* Features */}
          <div className="space-y-3 bg-onextap-primary/5 rounded-xl p-4 border border-onextap-primary/15">
            {[
              'Unlimited AI answer generations',
              'Priority AI processing speed',
              'Advanced job-page context analysis',
              'Cancel anytime — no lock-in',
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-3 text-sm text-onextap-dark/80">
                <CheckCircle size={16} className="text-onextap-primary shrink-0" />
                <span>{feature}</span>
              </div>
            ))}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg flex items-center gap-2">
              <AlertTriangle size={14} /> {error}
            </p>
          )}

          <button 
            onClick={handleUpgrade}
            disabled={isLoading}
            className="w-full bg-gradient-to-r from-onextap-primary to-onextap-primary-dark text-white py-3.5 rounded-xl font-bold text-base hover:opacity-90 transition-opacity shadow-lg shadow-onextap-primary/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <><Activity className="animate-spin" size={18} /> Redirecting to checkout...</>
            ) : (
              <><CreditCard size={18} /> Subscribe Now</>
            )}
          </button>

          <p className="text-xs text-onextap-dark/50 text-center flex items-center justify-center gap-1.5">
            <Lock size={10} /> Secure payment powered by Dodo Payments
          </p>
        </div>
      </div>
    </div>
  );
};

export default PremiumModal;
