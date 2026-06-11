import { useState, useEffect, useRef, useMemo } from 'react';
import useStore from '../../store/useStore.js';
import { apiFetch } from '../../api/apiClient.js';
import ReportModal from './ReportModal.jsx';

/**
 * FloatingActionButton — Material Design Speed Dial FAB.
 * Main circular button expands upward to reveal 4 action items.
 */
export default function FloatingBar({ onNavigateSettings, areaPaths = [] }) {
  const activeSection = useStore(s => s.activeSection);
  const [open,          setOpen]          = useState(false);
  const [showReports,   setShowReports]   = useState(false);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestStatus,  setDigestStatus]  = useState(null); // null | 'ok' | 'err'
  const [digestErr,     setDigestErr]     = useState('');
  const containerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Auto-clear digest status after 4 s
  useEffect(() => {
    if (!digestStatus) return;
    const t = setTimeout(() => setDigestStatus(null), 4000);
    return () => clearTimeout(t);
  }, [digestStatus]);

  async function sendDigest() {
    setOpen(false);
    setDigestLoading(true);
    setDigestStatus(null);
    try {
      await apiFetch('/api/notifications/digest/trigger', { method: 'POST', body: JSON.stringify({}) });
      setDigestStatus('ok');
    } catch (err) {
      setDigestErr(err.message || 'Failed');
      setDigestStatus('err');
    } finally {
      setDigestLoading(false);
    }
  }

  function handleReport() { setOpen(false); setShowReports(true); }
  function handleSettings() { setOpen(false); onNavigateSettings?.(); }
  function handlePrint() { setOpen(false); setTimeout(() => window.print(), 150); }

  // Speed dial actions (bottom → top order)
  const actions = useMemo(() => {
    const allActions = [
      { key: 'print', icon: <PrintIcon />, label: 'Print / PDF', onClick: handlePrint },
      { key: 'report', icon: <ReportIcon />, label: 'Export Report', onClick: handleReport },
      { key: 'settings', icon: <SettingsIcon />, label: 'Settings', onClick: handleSettings },
      {
        key: 'digest',
        icon: digestLoading ? <Spinner /> : digestStatus === 'ok' ? <SuccessIcon /> : digestStatus === 'err' ? <AlertIcon /> : <DigestIcon />,
        label: digestLoading ? 'Sending…' : digestStatus === 'ok' ? 'Sent!' : digestStatus === 'err' ? digestErr : 'Send Digest',
        onClick: sendDigest,
        accent: digestStatus === 'ok' ? 'var(--success,#068443)' : digestStatus === 'err' ? 'var(--danger,#eb3f3f)' : null,
      },
    ];

    const hiddenBySection = {
      settings: new Set(['settings', 'report', 'digest']),
      roadmap: new Set(['digest']),
      compare: new Set(['digest']),
      'cross-pi': new Set(['digest']),
    };

    const hidden = hiddenBySection[activeSection] || new Set();
    return allActions.filter(action => !hidden.has(action.key));
  }, [activeSection, digestErr, digestLoading, digestStatus]);

  return (
    <>
      <div className="fab-container" ref={containerRef}>
        {/* Speed dial items */}
        {actions.map((action, i) => (
          <div
            key={action.key}
            className={`fab-item${open ? ' fab-item--visible' : ''}`}
            style={{ transitionDelay: open ? `${i * 35}ms` : `${(actions.length - 1 - i) * 25}ms` }}
          >
            <span className="fab-item-label">{action.label}</span>
            <button
              className="fab-mini"
              onClick={action.onClick}
              title={action.label}
              aria-label={action.label}
              style={action.accent ? { background: action.accent, borderColor: action.accent } : undefined}
            >
              {action.icon}
            </button>
          </div>
        ))}

        {/* Main FAB */}
        <button
          className={`fab-main${open ? ' fab-main--open' : ''}`}
          onClick={() => setOpen(v => !v)}
          title="Actions"
          aria-label="Actions"
          aria-expanded={open}
        >
          <ActionsIcon open={open} />
        </button>
      </div>

      <ReportModal open={showReports} onClose={() => setShowReports(false)} areaPaths={areaPaths} />
    </>
  );
}

/* ── Icons ──────────────────────────────────────────────────────────────── */
function ActionsIcon({ open }) {
  if (open) {
    // × close icon
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
           style={{ transition: 'transform 0.25s cubic-bezier(.4,0,.2,1)', transform: 'rotate(0deg)' }}>
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    );
  }
  // Lightning bolt / actions icon
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  );
}
function PrintIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 6 2 18 2 18 9"/>
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
    <rect x="6" y="14" width="12" height="8"/>
  </svg>;
}
function ReportIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
  </svg>;
}
function SettingsIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>;
}
function DigestIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>;
}
function SuccessIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>;
}
function AlertIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
  </svg>;
}
function Spinner() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
    style={{ animation: 'spin 0.8s linear infinite' }}>
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
  </svg>;
}

