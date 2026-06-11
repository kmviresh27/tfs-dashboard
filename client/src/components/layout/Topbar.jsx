import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import useStore from '../../store/useStore.js';
import { useAuth } from '../../hooks/useAuth.js';
import { useSnapshots } from '../../api/hooks.js';
import { switchDeptApi } from '../../api/apiClient.js';
import ConfigPanel from '../ui/ConfigPanel.jsx';
import SnapshotModal from '../ui/SnapshotModal.jsx';
import SlideshowConfigModal from '../ui/SlideshowConfigModal.jsx';
import GlobalSearch from '../ui/GlobalSearch.jsx';
import NotificationCenter from '../ui/NotificationCenter.jsx';
import HelpPanel from '../ui/HelpPanel.jsx';

export default function Topbar({ onToggleSidebar, onRefresh, areaPaths, onNavigateSettings, onNavigateHome }) {
  const queryClient     = useQueryClient();
  const selectedPIs     = useStore(s => s.selectedPIs);
  const availablePIs    = useStore(s => s.availablePIs);
  const lastRefreshAt   = useStore(s => s.lastRefreshAt);
  const lastRefreshOk   = useStore(s => s.lastRefreshOk);
  const refreshInterval = useStore(s => s.refreshInterval);
  const branding        = useStore(s => s.branding);
  const activeDept      = useStore(s => s.activeDept);
  const setActiveDept   = useStore(s => s.setActiveDept);

  const slideshowRunning  = useStore(s => s.slideshowRunning);

  const { user } = useAuth();
  const userDepts = user?.departments || [];
  const hasMultipleDepts = userDepts.length > 1;

  const [countdown, setCountdown]           = useState(0);
  const [showSnapshot, setShowSnapshot]     = useState(false);
  const [showSlideshow, setShowSlideshow]   = useState(false);
  const [showMore, setShowMore]             = useState(false);
  const [showHelp, setShowHelp]             = useState(false);
  const [showDeptMenu, setShowDeptMenu]     = useState(false);
  const [switchingDept, setSwitchingDept]   = useState(null);
  const cdRef        = useRef(0);
  const moreWrapRef  = useRef(null);
  const deptWrapRef  = useRef(null);
  const { data: snapshotsData } = useSnapshots();

  // Close dept dropdown on outside click
  useEffect(() => {
    if (!showDeptMenu) return undefined;
    const handler = (e) => { if (!deptWrapRef.current?.contains(e.target)) setShowDeptMenu(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDeptMenu]);

  async function handleSwitchDept(dept) {
    if (dept.id === activeDept?.id) { setShowDeptMenu(false); return; }
    setSwitchingDept(dept.id);
    try {
      if (dept.id !== 'default') await switchDeptApi(dept.id);
      setActiveDept(dept);
      queryClient.invalidateQueries(); // clear all cached data for the new dept
      const search = window.location.search;
      const newPath = dept.id === 'default' ? `/${search}` : `/d/${dept.id}/${search}`;
      window.history.pushState(null, '', newPath);
    } catch (_) { /* silent */ }
    setSwitchingDept(null);
    setShowDeptMenu(false);
  }

  // ── beforeprint / afterprint: strip inline overflow/height so all pages render ──
  useEffect(() => {
    const SAVE_KEY = '__printSave';
    const before = () => {
      document.querySelectorAll('*').forEach(el => {
        const s = el.style;
        const saved = {};
        if (s.overflow)   { saved.overflow   = s.overflow;   s.overflow   = 'visible'; }
        if (s.overflowY)  { saved.overflowY  = s.overflowY;  s.overflowY  = 'visible'; }
        if (s.overflowX)  { saved.overflowX  = s.overflowX;  s.overflowX  = 'visible'; }
        if (s.height === '0px' || s.height === '0') { saved.height = s.height; s.height = 'auto'; }
        if (s.maxHeight && s.maxHeight !== 'none')  { saved.maxHeight = s.maxHeight; s.maxHeight = 'none'; }
        if (Object.keys(saved).length) el[SAVE_KEY] = saved;
      });
    };
    const after = () => {
      document.querySelectorAll('*').forEach(el => {
        if (!el[SAVE_KEY]) return;
        const saved = el[SAVE_KEY];
        if (saved.overflow   !== undefined) el.style.overflow   = saved.overflow;
        if (saved.overflowY  !== undefined) el.style.overflowY  = saved.overflowY;
        if (saved.overflowX  !== undefined) el.style.overflowX  = saved.overflowX;
        if (saved.height     !== undefined) el.style.height     = saved.height;
        if (saved.maxHeight  !== undefined) el.style.maxHeight  = saved.maxHeight;
        delete el[SAVE_KEY];
      });
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint',  after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint',  after);
    };
  }, []);

  // Auto-refresh countdown
  useEffect(() => {
    if (!refreshInterval || refreshInterval <= 0) { setCountdown(0); return; }
    const total = refreshInterval * 60;
    cdRef.current = total;
    setCountdown(total);
    const t = setInterval(() => {
      cdRef.current -= 1;
      setCountdown(cdRef.current);
      if (cdRef.current <= 0) {
        queryClient.invalidateQueries();
        cdRef.current = total;
        setCountdown(total);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [refreshInterval, queryClient]);

  useEffect(() => {
    if (!showMore) return undefined;
    const handlePointerDown = (event) => {
      if (!moreWrapRef.current?.contains(event.target)) setShowMore(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showMore]);

  const displayPIs = selectedPIs.length
    ? selectedPIs
    : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);

  const cdMins    = Math.floor(countdown / 60);
  const cdSecs    = countdown % 60;
  const snapshotCount = snapshotsData?.snapshots?.length || 0;
  const snapshotTitle = snapshotCount > 0
    ? `PI Snapshots (${snapshotCount} available) — capture baseline or browse history`
    : 'PI Snapshots — capture baseline or browse history';

  return (
    <header className="topbar">
      <button className="sidebar-toggle" onClick={onToggleSidebar} title="Toggle sidebar" aria-label="Toggle sidebar">☰</button>

      <div className="topbar-brand" onClick={onNavigateHome} title="Go to home" style={{ cursor: 'pointer' }}>
        <span className="topbar-company">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.companyName} title={branding.companyName}
              style={{ height: 28, width: 'auto', display: 'block' }} />
          ) : branding.logoType === 'svg' && branding.logoSvg ? (
            <span title={branding.companyName}
              style={{ height: 28, display: 'flex', alignItems: 'center' }}
              dangerouslySetInnerHTML={{ __html: branding.logoSvg }} />
          ) : null}
        </span>
        {(branding.logoUrl || branding.logoSvg) && <span className="topbar-brand-sep">|</span>}
        <span className="topbar-product">{branding.appName || 'AV Dashboard'}</span>
      </div>

      {/* Department switcher — only shown when user has access to multiple depts */}
      {hasMultipleDepts && (
        <div ref={deptWrapRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowDeptMenu(v => !v)}
            title="Switch department"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--surface2, #1e1e2e)',
              border: '1px solid var(--border, #2a2a3a)',
              borderRadius: 6, padding: '4px 10px',
              color: 'var(--text, #e0e0e0)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M8 12h8M12 8v8"/>
            </svg>
            {activeDept?.name || activeDept?.id || 'Default'}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
              style={{ transform: showDeptMenu ? 'rotate(180deg)' : '', transition: 'transform .2s', opacity: .6 }}>
              <path d="M7 10l5 5 5-5z"/>
            </svg>
          </button>
          {showDeptMenu && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0,
              background: 'var(--surface, #161620)',
              border: '1px solid var(--border, #2a2a3a)',
              borderRadius: 8, minWidth: 200, zIndex: 1000,
              boxShadow: '0 8px 24px rgba(0,0,0,.5)',
              overflow: 'hidden',
            }}>
              {userDepts.map(dept => {
                const isActive = dept.id === activeDept?.id;
                const isLoading = switchingDept === dept.id;
                return (
                  <button
                    key={dept.id}
                    onClick={() => handleSwitchDept(dept)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', padding: '9px 14px', border: 'none', textAlign: 'left',
                      background: isActive ? 'var(--accent-dim, rgba(20,146,255,.12))' : 'transparent',
                      color: isActive ? 'var(--accent, #1492ff)' : 'var(--text, #e0e0e0)',
                      fontSize: 13, cursor: isLoading ? 'wait' : 'pointer',
                      borderBottom: '1px solid var(--border, #2a2a3a)',
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    <span>{dept.name || dept.id}</span>
                    {isActive && <span style={{ fontSize: 10, opacity: .8 }}>✓ Active</span>}
                    {isLoading && <span style={{ fontSize: 11, opacity: .7 }}>switching…</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* PI pills — display only, same as old app */}
      <div className="topbar-pi">
        <span className="topbar-label">Viewing:</span>
        <div className="pi-pills">
          {displayPIs.map(pi => <span key={pi} className="pi-pill">{pi}</span>)}
          {!displayPIs.length && <span className="pi-pill" style={{ opacity: 0.5 }}>All PIs</span>}
        </div>
      </div>

      {/* Centered search bar */}
      <div className="topbar-center">
        <GlobalSearch variant="bar" />
      </div>

      <div className="topbar-actions">
        {/* Single configure popup with all 4 filter sections */}
        <ConfigPanel areaPaths={areaPaths} onOpenSnapshots={() => setShowSnapshot(true)} />

        <div className="tb-divider" />

        {/* Slideshow start button (always visible; HUD handles stop during playback) */}
        <button
          className={`topbar-icon-btn tb-slideshow-btn${slideshowRunning ? ' active' : ''}`}
          onClick={() => !slideshowRunning && setShowSlideshow(true)}
          title={slideshowRunning ? 'Slideshow running — move mouse to show controls' : 'Slideshow — auto-cycle all sections'}
          aria-label={slideshowRunning ? 'Slideshow running' : 'Open slideshow settings'}
        >
          &#x25B6;
        </button>

        {/* Snapshot capture */}
        <button
          className="topbar-icon-btn"
          onClick={() => setShowSnapshot(true)}
          title={snapshotTitle}
          aria-label={snapshotTitle}
          style={{ width: 'auto', padding: '0 8px', gap: 4, position: 'relative' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          <span className="topbar-btn-label">Snap</span>
          {snapshotCount > 0 && <span className="topbar-count-badge">{snapshotCount}</span>}
        </button>

        {/* Refresh */}
        <div className="tb-refresh-wrap" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="topbar-icon-btn tb-refresh-btn" onClick={onRefresh} title="Refresh data from TFS" aria-label="Refresh data from TFS">
            <span className="tb-refresh-icon">&#x21BB;</span>
          </button>
          {refreshInterval > 0 && countdown > 0 && (
            <span className="tb-refresh-eta" title="Next auto-refresh">
              {cdMins}m {String(cdSecs).padStart(2, '0')}s
            </span>
          )}
          {lastRefreshAt && (
            <span className="refresh-dot"
              title={lastRefreshAt.toLocaleTimeString('en-GB')}
              style={{ background: lastRefreshOk ? 'var(--success)' : 'var(--danger)' }} />
          )}
        </div>

        <NotificationCenter />

        {/* Help button */}
        <button
          className="topbar-icon-btn"
          onClick={() => setShowHelp(true)}
          title="Help & Documentation"
          aria-label="Help & Documentation"
          style={{ fontWeight: 700, fontSize: 13 }}
        >
          ?
        </button>

        <div className="tb-divider" />

        <div className="topbar-more-wrap" ref={moreWrapRef}>
          <button
            className="topbar-icon-btn"
            onClick={() => setShowMore(v => !v)}
            title="More actions"
            aria-label="More actions"
            aria-expanded={showMore}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
            </svg>
          </button>
          {showMore && (
            <div className="topbar-more-menu">
              <a
                href="/docs/user-manual.html"
                className="topbar-more-item"
                target="_blank"
                rel="noreferrer"
                title="Instructions For Use"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                IFU / User Manual
              </a>
              <a
                href="/docs/checklists.html"
                className="topbar-more-item"
                target="_blank"
                rel="noreferrer"
                title="Deployment Checklists"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <polyline points="9 11 12 14 22 4"/>
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
                Deployment Checklists
              </a>
              <a
                href="/docs/"
                className="topbar-more-item"
                target="_blank"
                rel="noreferrer"
                title="Documentation Hub"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                Documentation Hub
              </a>
            </div>
          )}
        </div>
      </div>

      <SnapshotModal open={showSnapshot} onClose={() => setShowSnapshot(false)} />
      <SlideshowConfigModal open={showSlideshow} onClose={() => setShowSlideshow(false)} />
      <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} />
    </header>
  );
}
