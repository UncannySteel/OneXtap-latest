import React, { useState, useEffect } from 'react';
import { Layout, User, PenTool, Moon } from 'lucide-react';

// --- GUIDED TOUR ---
export const TOUR_STEPS = [
  {
    target: 'sidebar-nav',
    title: 'Your navigation hub',
    desc: 'Use the sidebar to switch between Overview, My Profiles, and Answer Studio. Everything you need is one click away.',
    position: 'right',
    icon: Layout,
  },
  {
    target: 'nav-profiles',
    title: 'My Profiles',
    desc: 'Add your personal details, education, work experience, and skills. You can also upload a resume — we\'ll parse it automatically.',
    position: 'right',
    icon: User,
  },
  {
    target: 'nav-vault',
    title: 'Answer Studio',
    desc: 'Save answers to common application questions. Use AI mode to generate smart, job-specific answers from a job description — or switch to manual mode to write your own.',
    position: 'right',
    icon: PenTool,
  },
  {
    target: 'dark-toggle',
    title: 'Dark mode',
    desc: 'Prefer working at night? Toggle between light and dark themes here.',
    position: 'right',
    icon: Moon,
  },
];

/**
 * One step of the first-run guided tour: a dimmed backdrop plus a tooltip
 * anchored to the step's target element, clamped to stay on screen.
 *
 * @param {object} props
 * @param {{ target: string, title: string, desc: string, position: string, icon: Function }} props.step
 * @param {number} props.totalSteps
 * @param {number} props.currentStep Zero-based index, for the progress dots.
 * @param {() => void} props.onNext Advances, or finishes on the last step.
 * @param {() => void} props.onSkip Ends the tour immediately.
 * @param {() => void} props.onDismiss Backdrop click.
 */
const TourOverlay = ({ step, totalSteps, currentStep, onNext, onSkip, onDismiss }) => {
  const [pos, setPos] = useState(null);
  const [targetRect, setTargetRect] = useState(null);

  useEffect(() => {
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) return;

    const updatePosition = () => {
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);

      const tooltipWidth = 320;
      const tooltipHeight = 200;
      const gap = 16;
      let top, left;

      if (step.position === 'right') {
        left = rect.right + gap;
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
      } else if (step.position === 'bottom') {
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        top = rect.bottom + gap;
      } else if (step.position === 'left') {
        left = rect.left - tooltipWidth - gap;
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
      } else {
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        top = rect.top - tooltipHeight - gap;
      }

      // Keep tooltip on screen
      top = Math.max(16, Math.min(top, window.innerHeight - tooltipHeight - 16));
      left = Math.max(16, Math.min(left, window.innerWidth - tooltipWidth - 16));

      setPos({ top, left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [step.target, step.position]);

  if (!pos || !targetRect) return null;

  const padding = 6;
  const spotlightStyle = {
    position: 'fixed',
    top: targetRect.top - padding,
    left: targetRect.left - padding,
    width: targetRect.width + padding * 2,
    height: targetRect.height + padding * 2,
    borderRadius: '16px',
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
    zIndex: 49,
    pointerEvents: 'none',
    transition: 'all 0.3s ease',
  };

  const arrowStyle = {};
  if (step.position === 'right') {
    arrowStyle.left = '-6px';
    arrowStyle.top = '50%';
    arrowStyle.transform = 'translateY(-50%) rotate(45deg)';
  } else if (step.position === 'bottom') {
    arrowStyle.top = '-6px';
    arrowStyle.left = '50%';
    arrowStyle.transform = 'translateX(-50%) rotate(45deg)';
  } else if (step.position === 'left') {
    arrowStyle.right = '-6px';
    arrowStyle.top = '50%';
    arrowStyle.transform = 'translateY(-50%) rotate(45deg)';
  } else {
    arrowStyle.bottom = '-6px';
    arrowStyle.left = '50%';
    arrowStyle.transform = 'translateX(-50%) rotate(45deg)';
  }

  const StepIcon = step.icon;

  return (
    <>
      {/* Backdrop — visual only; don't block sidebar / page interaction */}
      <div className="fixed inset-0 z-[48] pointer-events-none" />
      
      {/* Spotlight cutout */}
      <div style={spotlightStyle} />

      {/* Tooltip */}
      <div
        className="fixed z-50 w-80 animate-fade-in pointer-events-auto"
        style={{ top: pos.top, left: pos.left }}
      >
        <div className="relative bg-white dark:bg-[#262520] rounded-2xl border border-onextap-primary/25 dark:border-white/[0.1] shadow-2xl shadow-onextap-dark/20 dark:shadow-black/40 p-5 overflow-hidden">
          {/* Decorative gradient */}
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-onextap-primary/10 to-transparent rounded-full blur-2xl pointer-events-none" />

          {/* Arrow */}
          <div
            className="absolute w-3 h-3 bg-white dark:bg-[#262520] border border-onextap-primary/25 dark:border-white/[0.1]"
            style={arrowStyle}
          />

          <div className="relative z-10">
            {/* Step counter & skip */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-onextap-primary/15 flex items-center justify-center">
                  <StepIcon size={14} className="text-onextap-primary" />
                </div>
                <span className="text-[11px] font-semibold text-onextap-dark/40 dark:text-white/40 uppercase tracking-wider">
                  Step {currentStep + 1} of {totalSteps}
                </span>
              </div>
              <button onClick={onSkip} className="text-[12px] text-onextap-dark/40 dark:text-white/40 hover:text-onextap-dark dark:hover:text-white font-medium transition-colors">
                Skip tour
              </button>
            </div>

            {/* Content */}
            <h3 className="font-bold text-[15px] text-onextap-dark dark:text-white mb-1.5">{step.title}</h3>
            <p className="text-[13px] text-onextap-dark/60 dark:text-white/50 leading-relaxed mb-4">{step.desc}</p>

            {/* Progress & nav */}
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5">
                {Array.from({ length: totalSteps }).map((_, i) => (
                  <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === currentStep ? 'w-5 bg-onextap-primary' : i < currentStep ? 'w-1.5 bg-onextap-primary/50' : 'w-1.5 bg-onextap-dark/15 dark:bg-white/15'
                  }`} />
                ))}
              </div>
              <button
                onClick={onNext}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-onextap-primary text-white hover:bg-onextap-primary-dark transition-colors shadow-sm"
              >
                {currentStep < totalSteps - 1 ? 'Next' : 'Get Started'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default TourOverlay;
