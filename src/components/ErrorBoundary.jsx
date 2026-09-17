import React from 'react';
import { log, getRecentIssues } from '../logger';

const boundaryLog = log.child('react');

/**
 * Catches render-time errors so a thrown component does not leave a blank
 * 400×600 popup with the failure visible only in a console the user will
 * never open.
 *
 * React only routes render/lifecycle errors here. Rejected promises and
 * errors in event handlers go to the window handlers installed by
 * installGlobalErrorHandlers() in logger.js.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    boundaryLog.error('render error', error, {
      componentStack: info?.componentStack?.split('\n').slice(0, 8).join('\n'),
    });
  }

  handleCopy = () => {
    const report = {
      when: new Date().toISOString(),
      error: { name: this.state.error?.name, message: this.state.error?.message },
      recent: getRecentIssues(),
    };
    navigator.clipboard
      ?.writeText(JSON.stringify(report, null, 2))
      .catch((err) => boundaryLog.warn('could not copy diagnostics', err));
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{ padding: 24, fontFamily: 'DM Sans, system-ui, sans-serif', color: '#1f2937' }}>
        <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>Something broke.</h2>
        <p style={{ fontSize: 14, lineHeight: 1.5, margin: '0 0 16px', color: '#4b5563' }}>
          Your saved profiles are stored locally and were not affected. Reopening
          usually clears it.
        </p>
        <p style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', color: '#6b7280', margin: '0 0 16px', wordBreak: 'break-word' }}>
          {this.state.error?.message || String(this.state.error)}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: '8px 14px', marginRight: 8, borderRadius: 8, border: 'none', background: '#111827', color: '#fff', fontSize: 13, cursor: 'pointer' }}
        >
          Reload
        </button>
        <button
          onClick={this.handleCopy}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer' }}
        >
          Copy diagnostics
        </button>
      </div>
    );
  }
}
