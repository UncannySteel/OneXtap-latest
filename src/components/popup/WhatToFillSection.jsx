import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { AUTOFILL_SECTION_META } from '../../autofillSections';

// --- WHAT TO FILL ---
/**
 * Collapsible checklist of which form sections autofill should touch on the
 * current page. A row is only offered when DETECT_SECTIONS found matching
 * markup; the cover-letter row additionally needs a saved template.
 *
 * @param {object} props
 * @param {Record<string, boolean>} props.detectedSections From DETECT_SECTIONS.
 * @param {Record<string, boolean>} props.sectionToggles Current user choices.
 * @param {(next: Record<string, boolean>) => void} props.setSectionToggles
 * @param {boolean} props.hasCoverLetterTemplates
 */
const WhatToFillSection = ({ detectedSections, sectionToggles, setSectionToggles, hasCoverLetterTemplates }) => {
  const [expanded, setExpanded] = useState(false);

  const visibleSections = AUTOFILL_SECTION_META.filter((s) => {
    if (s.key === 'coverLetter') {
      return detectedSections.coverLetter && hasCoverLetterTemplates;
    }
    return detectedSections[s.key];
  });

  const enabledCount = visibleSections.filter((s) => sectionToggles[s.key]).length;
  const totalCount = visibleSections.length;

  const setAll = (value) => {
    const next = { ...sectionToggles };
    visibleSections.forEach((s) => { next[s.key] = value; });
    setSectionToggles(next);
  };

  if (totalCount === 0) return null;

  return (
    <div className="rounded-xl border border-onextap-primary/15 bg-white/80 dark:bg-onextap-night-card dark:border-onextap-primary-light/20">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-onextap-dark dark:text-[#E8EFD8]"
      >
        <span>What to fill</span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {expanded && (
        <div className="border-t border-onextap-primary/10 px-3 py-2.5 space-y-2">
          <div className="flex gap-3 text-xs">
            <button type="button" onClick={() => setAll(true)} className="text-onextap-primary font-medium hover:underline">Select all</button>
            <button type="button" onClick={() => setAll(false)} className="text-onextap-dark/50 font-medium hover:underline dark:text-[#9AB07A]">Deselect all</button>
          </div>
          {visibleSections.map((s) => (
            <label key={s.key} className={`flex items-center gap-2.5 cursor-pointer text-sm ${sectionToggles[s.key] ? 'text-onextap-dark dark:text-[#E8EFD8]' : 'text-onextap-dark/40 line-through dark:text-[#9AB07A]/60'}`}>
              <input
                type="checkbox"
                checked={!!sectionToggles[s.key]}
                onChange={(e) => setSectionToggles((prev) => ({ ...prev, [s.key]: e.target.checked }))}
                className="rounded border-onextap-primary/30 text-onextap-primary focus:ring-onextap-primary/30"
              />
              <span>{s.icon}</span>
              <span>{s.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

export default WhatToFillSection;
