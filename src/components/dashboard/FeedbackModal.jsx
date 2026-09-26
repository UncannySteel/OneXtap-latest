import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { API_URL } from '../../config';
import { log as baseLog } from '../../logger';

const log = baseLog.child('Feedback');

const MESSAGE_MAX = 1000;

const CATEGORIES = [
  { id: 'idea', label: 'An idea' },
  { id: 'bug', label: 'Something broke' },
  { id: 'job-board', label: 'A job board' },
  { id: 'other', label: 'Something else' },
];

/**
 * Feedback dialog opened from the footer's "Send feedback" card.
 *
 * Posts to `${API_URL}/api/feedback`, which emails the submission server-side
 * (see server/index.js) — nothing is persisted in any table. The visitor's
 * own email is never required for the send to succeed; when given, it only
 * rides along as a reply-to.
 *
 * @param {object} props
 * @param {boolean} props.isOpen Returns null when false.
 * @param {() => void} props.onClose
 * @param {(message: string, type?: 'success'|'error') => void} props.showToast
 */
const FeedbackModal = ({ isOpen, onClose, showToast }) => {
  const cardRef = useRef(null);
  const textareaRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [category, setCategory] = useState('idea');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = () => {
    setCategory('idea');
    setMessage('');
    setEmail('');
    setError('');
    setIsSubmitting(false);
  };

  const handleClose = () => {
    resetForm();
    onCloseRef.current();
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    const focusTimer = setTimeout(() => cardRef.current?.querySelector('textarea')?.focus(), 0);

    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  // No "is this still mounted" guard around the state updates below: React 18
  // silently no-ops a setState after unmount rather than warning, so the
  // guard would be pure defense-for-nothing — and a ref-based version of it
  // is actively wrong, because StrictMode's dev-only mount→cleanup→remount
  // rehearsal runs the cleanup once "for practice" right after mount, which
  // would permanently mark the component as unmounted while it is still on
  // screen. (Found that the hard way: it silently ate every submit.)
  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      setError('Add a message before sending.');
      textareaRef.current?.focus();
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, message: trimmed, email: email.trim() }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body.ok) {
        log.error('feedback submit rejected by server', {
          status: res.status,
          requestId: res.headers.get('X-Request-Id'),
        });
        setIsSubmitting(false);
        showToast?.('Oops, an error occurred.', 'error');
        return;
      }

      showToast?.('Feedback received!', 'success');
      handleClose();
    } catch (err) {
      log.error('feedback submit request failed', { errName: err?.name });
      setIsSubmitting(false);
      showToast?.('Oops, an error occurred.', 'error');
    }
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-in-scale relative max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-[rgba(42,60,28,0.12)] bg-white p-8 shadow-xl dark:border-[rgba(200,216,168,0.15)] dark:bg-onextap-night-card"
      >
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-lg p-2 text-onextap-muted transition-colors hover:bg-black/[0.04] hover:text-onextap-dark dark:text-[#9AB07A] dark:hover:bg-white/[0.06] dark:hover:text-[#E8EFD8]"
        >
          <X size={18} />
        </button>

        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-onextap-primary-light dark:text-onextap-olive-pale">
          Feedback
        </p>
        <h2
          id="feedback-modal-title"
          className="mb-3 font-sans text-[34px] font-bold uppercase leading-[0.95] tracking-tight text-onextap-dark sm:text-[42px] dark:text-[#E8EFD8]"
        >
          Tell us straight.
        </h2>
        <p className="mb-7 text-[14px] font-light text-onextap-muted dark:text-[#9AB07A]">
          Short or long, rough or polished. We read all of it.
        </p>

        <div className="space-y-6">
          <div>
            <p className="mb-2.5 text-[13px] text-onextap-muted dark:text-[#9AB07A]">what&apos;s it about?</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const isSelected = category === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setCategory(c.id)}
                    className={`rounded-full border px-4 py-2 text-[13.5px] font-medium transition-colors ${
                      isSelected
                        ? 'border-transparent bg-onextap-dark text-white dark:bg-white dark:text-onextap-night'
                        : 'border-onextap-dark/15 bg-white text-onextap-dark hover:border-onextap-dark/30 dark:border-white/15 dark:bg-white/[0.04] dark:text-[#E8EFD8] dark:hover:border-white/30'
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <label htmlFor="feedback-message" className="text-[13px] text-onextap-muted dark:text-[#9AB07A]">
                message
              </label>
              <span className="text-[11px] text-onextap-muted/80 dark:text-[#9AB07A]/80">
                {message.length} / {MESSAGE_MAX}
              </span>
            </div>
            <textarea
              id="feedback-message"
              ref={textareaRef}
              value={message}
              maxLength={MESSAGE_MAX}
              onChange={(e) => { setMessage(e.target.value); if (error) setError(''); }}
              placeholder="What happened, or what should happen?"
              rows={5}
              className="w-full resize-y rounded-xl border border-onextap-dark/10 bg-white px-4 py-3.5 text-[14px] text-onextap-dark placeholder-onextap-muted/70 transition-all focus:border-onextap-primary/50 focus:outline-none focus:ring-2 focus:ring-onextap-primary/10 dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:placeholder-white/35"
            />
            {error && <p className="mt-1.5 text-[13px] text-red-600 dark:text-red-400">{error}</p>}
          </div>

          <div>
            <label htmlFor="feedback-email" className="mb-2.5 block text-[13px] text-onextap-muted dark:text-[#9AB07A]">
              email — optional, if you&apos;d like a reply
            </label>
            <input
              id="feedback-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-onextap-dark/10 bg-white px-4 py-3.5 text-[14px] text-onextap-dark placeholder-onextap-muted/70 transition-all focus:border-onextap-primary/50 focus:outline-none focus:ring-2 focus:ring-onextap-primary/10 dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:placeholder-white/35"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full border border-onextap-dark/15 px-6 py-3 text-[14px] font-medium text-onextap-dark transition-colors hover:bg-black/[0.04] dark:border-white/15 dark:text-[#E8EFD8] dark:hover:bg-white/[0.06]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-full bg-onextap-dark px-6 py-3 text-[14px] font-medium text-white transition-colors hover:bg-onextap-dark/90 disabled:opacity-60 dark:bg-white dark:text-onextap-night dark:hover:bg-white/90"
            >
              {isSubmitting ? 'Sending…' : 'Send feedback'}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeedbackModal;
