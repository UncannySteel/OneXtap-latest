import React, { useState } from 'react';
import { getApplicationTypeConfig } from '../../applicationTypes';
import ProfileSwitcher from '../shared/ProfileSwitcher';
import CoverLetterPanel from '../shared/CoverLetterPanel';

/**
 * Dashboard tab wrapper around CoverLetterPanel: adds the heading and a
 * ProfileSwitcher, and remounts the panel (via `key`) whenever the active
 * profile changes so it reloads that profile's templates.
 *
 * @param {object} props
 * @param {(message: string, type?: 'success'|'error'|'loading') => void} props.showToast
 * @param {object|null} props.user
 * @param {string} [props.applicationType='job'] Drives the labels via
 *   getApplicationTypeConfig.
 */
const CoverLetterPage = ({ showToast, user, applicationType = 'job' }) => {
  const appConfig = getApplicationTypeConfig(applicationType);
  const [panelKey, setPanelKey] = useState(0);
  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <ProfileSwitcher onProfileChange={() => setPanelKey((k) => k + 1)} />
      </div>
      <div className="bg-white/80 backdrop-blur-sm rounded-3xl border border-onextap-primary/15 p-8 shadow-lg">
        <h2 className="font-bold text-2xl text-onextap-dark tracking-tight mb-1">{appConfig.coverLetterLabel}</h2>
        <p className="text-onextap-dark/60 text-sm mb-6">Store multiple {appConfig.documentLabel.toLowerCase()}, personalize for each application, and fill from the extension.</p>
        <CoverLetterPanel key={panelKey} showToast={showToast} user={user} applicationType={applicationType} documentLabel={appConfig.coverLetterLabel} />
      </div>
    </div>
  );
};

export default CoverLetterPage;
