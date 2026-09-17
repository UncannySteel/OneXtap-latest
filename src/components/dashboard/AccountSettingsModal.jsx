import React, { useState, useEffect } from 'react';
import { Shield, User, Activity, Trash2, Sparkles, Settings, X, AlertTriangle, Crown, CreditCard } from 'lucide-react';
import { signOut as supaSignOut } from '../../auth';
import { creditManager } from '../../creditManager';
import { log as baseLog } from '../../logger';

const log = baseLog.child('ui');

// --- ACCOUNT SETTINGS MODAL ---
/**
 * Account dialog: plan status, subscription cancellation, data export/import,
 * and sign-out.
 *
 * Signing out clears local storage before calling Supabase and then reloads
 * the page, so no in-memory profile state survives into the next session.
 *
 * @param {object} props
 * @param {boolean} props.isOpen Returns null when false.
 * @param {() => void} props.onClose
 * @param {object|null} props.user
 * @param {() => void} props.onSignOut Parent-level teardown, run before reload.
 * @param {() => void} props.onOpenPremiumModal Hands off to the upgrade flow.
 */
const AccountSettingsModal = ({ isOpen, onClose, user, onSignOut, onOpenPremiumModal }) => {
  const [credits, setCredits] = useState(null);
  const [creditsError, setCreditsError] = useState(null);
  const [isPremium, setIsPremium] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [isManagingSubscription, setIsManagingSubscription] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadAccountData();
      setDeleteConfirm('');
      setDeleteError('');
    }
  }, [isOpen]);

  const loadAccountData = async () => {
    setIsLoading(true);
    setCreditsError(null);
    try {
      const { credits: c, isPremium: premiumStatus, error } = await creditManager.getCreditsWithStatus();
      setIsPremium(premiumStatus);
      if (error) {
        setCreditsError(error);
        setCredits(null);
      } else {
        setCredits(premiumStatus ? Infinity : (c ?? 0));
      }
    } catch (error) {
      log.error('Error loading account data:', error);
      setCreditsError(error?.message || 'Failed to load credits');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE') {
      setDeleteError('Please type DELETE to confirm');
      return;
    }

    setIsDeleting(true);
    setDeleteError('');

    try {
      // Clear local storage
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          await new Promise((resolve) => {
            chrome.storage.local.clear(() => resolve());
          });
        } else {
          localStorage.clear();
        }
      } catch (err) {
        log.warn('Failed to clear local storage:', err);
      }

      // Sign out via Supabase
      await supaSignOut();
      onClose();
      if (onSignOut) onSignOut();
      
      // Reload page to reset state
      window.location.reload();
    } catch (error) {
      log.error('Account deletion failed:', error);
      setDeleteError(error.message || 'Failed to delete account. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOpen) return null;

  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
  const userInitial = displayName[0]?.toUpperCase() || 'U';
  const creditsDisplay = isPremium ? '∞' : (credits !== null ? credits : '...');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-onextap-primary/20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-onextap-bg-light border-b border-onextap-primary/20 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-onextap-dark">Account Settings</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-onextap-primary/10 rounded-lg transition-colors text-onextap-dark"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* User Info Section */}
          <div className="bg-onextap-primary/5 rounded-xl p-6 border border-onextap-primary/20">
            <h3 className="text-sm font-semibold text-onextap-dark mb-4 flex items-center gap-2">
              <User size={16} className="text-onextap-primary" /> Account Information
            </h3>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-onextap-primary/20 text-onextap-primary rounded-full flex items-center justify-center font-bold text-xl border-2 border-onextap-primary/40 shrink-0">
                {userInitial}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-lg font-bold text-onextap-dark mb-0.5 truncate flex items-center gap-2">
                  {displayName}
                  {isPremium && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 bg-gradient-to-r from-amber-100 to-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                      <Crown size={11} /> Premium
                    </span>
                  )}
                </div>
                <div className="text-xs text-onextap-dark/60 mb-2 truncate">{user?.email || 'N/A'}</div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-onextap-primary/10 text-onextap-primary border border-onextap-primary/30">
                  <Shield size={12} />
                  Authenticated
                </div>
              </div>
            </div>
          </div>

          {/* Credits Section */}
          <div className="bg-onextap-primary/5 rounded-xl p-6 border border-onextap-primary/20">
            <h3 className="text-sm font-semibold text-onextap-dark mb-4 flex items-center gap-2">
              <Sparkles size={16} className="text-onextap-primary" /> AI Credits
            </h3>
            {isLoading ? (
              <div className="flex items-center gap-2 text-onextap-dark/70">
                <Activity className="animate-spin" size={16} />
                <span>Loading...</span>
              </div>
            ) : creditsError ? (
              <div className="text-sm text-amber-700 bg-amber-50 px-3 py-3 rounded-lg border border-amber-200">
                <strong>Couldn't load credits:</strong> {creditsError}
                <p className="mt-2 text-xs text-amber-800/80">
                  Server running, <code className="text-[11px]">VITE_API_URL</code> correct, and Supabase keys in <code className="text-[11px]">server/.env</code>.
                </p>
                <button onClick={loadAccountData} className="mt-2 text-sm font-medium text-amber-800 underline hover:no-underline">Try again</button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-onextap-dark/80 font-medium">Available</span>
                  <span className="text-2xl font-bold text-onextap-dark">{isPremium ? '∞' : `${creditsDisplay} credits`}</span>
                </div>
                {isPremium ? (
                  <div className="space-y-3">
                    <div className="text-sm text-onextap-dark/80 bg-onextap-primary/10 px-3 py-2 rounded-lg border border-onextap-primary/20 flex items-center gap-2">
                      <Crown size={16} className="text-onextap-primary" />
                      Premium Account — Unlimited High-Quality AI Generations
                    </div>
                    <button
                      onClick={async () => {
                        if (!confirm('Are you sure you want to cancel your Premium subscription? You will lose access to unlimited high-quality AI generations.')) return;
                        setIsManagingSubscription(true);
                        try {
                          await creditManager.cancelSubscription();
                          window.location.reload();
                        } catch (err) {
                          log.error('Cancel error:', err);
                          setDeleteError(err.message || 'Failed to cancel subscription');
                        } finally {
                          setIsManagingSubscription(false);
                        }
                      }}
                      disabled={isManagingSubscription}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-red-300 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      {isManagingSubscription ? (
                        <><Activity className="animate-spin" size={14} /> Cancelling...</>
                      ) : (
                        <><CreditCard size={14} /> Cancel Subscription</>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm text-onextap-dark/70 flex-1">
                      {credits === 0 ? (
                        <span className="text-red-600 font-medium">No credits remaining.</span>
                      ) : (
                        <span>You have {credits} fast standard generation{credits !== 1 ? 's' : ''} remaining.</span>
                      )}
                    </div>
                    <button
                      onClick={() => { onClose(); onOpenPremiumModal?.(); }}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-onextap-primary to-onextap-primary-dark text-white hover:opacity-90 transition-opacity shadow-sm"
                    >
                      <Crown size={14} />
                      Upgrade to Premium
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Danger Zone */}
          <div className="bg-red-50/80 rounded-xl p-6 border-2 border-red-200/80">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={18} className="text-red-600" />
              <h3 className="text-sm font-semibold text-red-900">Danger Zone</h3>
            </div>
            <p className="text-sm text-red-800/90 mb-4">
              Deleting your account will permanently remove all your data including your profile, vault answers, and credits. This action cannot be undone.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-red-900 mb-2">
                  Type <span className="font-mono bg-red-100 px-2 py-1 rounded">DELETE</span> to confirm:
                </label>
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => {
                    setDeleteConfirm(e.target.value);
                    setDeleteError('');
                  }}
                  placeholder="DELETE"
                  className="w-full px-4 py-2 border-2 border-red-300 rounded-lg focus:outline-none focus:border-red-500 text-sm text-onextap-dark bg-white"
                />
              </div>
              {deleteError && (
                <p className="text-sm text-red-600">{deleteError}</p>
              )}
              <button
                onClick={handleDeleteAccount}
                disabled={deleteConfirm !== 'DELETE' || isDeleting}
                className="w-full bg-red-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <Activity className="animate-spin" size={16} />
                    Deleting Account...
                  </>
                ) : (
                  <>
                    <Trash2 size={16} />
                    Delete My Account
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-onextap-bg-light border-t border-onextap-primary/20 px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-onextap-dark hover:bg-onextap-primary/10 rounded-lg font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccountSettingsModal;
