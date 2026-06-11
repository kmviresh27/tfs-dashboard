import { useEffect, useMemo, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import useStore from './store/useStore.js';
import { useConfig, usePIList, useDashboard } from './api/hooks.js';
import { apiFetch, getApiPrefix } from './api/apiClient.js';
import { useSlideshow } from './hooks/useSlideshow.js';
import { useAuth } from './hooks/useAuth.js';
import { SECTION_PAGES, NAV_ITEMS, getEffectiveRoleDefs, getEffectiveRoleSections } from './constants.js';
import Layout from './components/layout/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DeptSelectorPage from './pages/DeptSelectorPage.jsx';
import SectionErrorBoundary from './components/ui/SectionErrorBoundary.jsx';
import FloatingBar from './components/ui/FloatingBar.jsx';
import AccessRestricted from './components/ui/AccessRestricted.jsx';
import ExecutiveSection    from './sections/ExecutiveSection.jsx';
import ObjectivesPlanningSection from './sections/ObjectivesPlanningSection.jsx';
import FeaturesSection     from './sections/FeaturesSection.jsx';
import DefectsSection      from './sections/DefectsSection.jsx';
import TeamsSection        from './sections/TeamsSection.jsx';
import SprintSection       from './sections/SprintSection.jsx';
import VelocitySection     from './sections/VelocitySection.jsx';
import TestCoverageSection from './sections/TestCoverageSection.jsx';
import RoadmapSection      from './sections/RoadmapSection.jsx';
import RisksSection        from './sections/RisksSection.jsx';
import InsightsSection     from './sections/InsightsSection.jsx';
import SettingsSection     from './sections/SettingsSection.jsx';
import ScopeChangeSection    from './sections/ScopeChangeSection.jsx';
import CompareSection        from './sections/CompareSection.jsx';
import CrossPITrendSection   from './sections/CrossPITrendSection.jsx';
import PIDeliverySection     from './sections/PIDeliverySection.jsx';
import ReleaseHealthSection  from './sections/ReleaseHealthSection.jsx';
import ProgramBoardSection   from './sections/ProgramBoardSection.jsx';
import RetroSection          from './sections/RetroSection.jsx';
import BlockerBoardSection   from './sections/BlockerBoardSection.jsx';
import PIReadinessSection    from './sections/PIReadinessSection.jsx';
import KPISection           from './sections/KPISection.jsx';
import HealthSection         from './sections/HealthSection.jsx';
import AdminSection          from './sections/AdminSection.jsx';

// ── Section keyboard shortcut map (1-9 keys) — derived from visible sections at runtime ──

const NAVIGABLE_SECTIONS = NAV_ITEMS.map(n => n.id);

function ActiveSection({ id, onRetry }) {
  const label = NAV_ITEMS.find(n => n.id === id)?.label || id;
  const content = (() => {
    switch (id) {
      case 'executive':     return <ExecutiveSection />;
      case 'objectives-plan': return <ObjectivesPlanningSection />;
      case 'features':      return <FeaturesSection />;
      case 'defects':       return <DefectsSection />;
      case 'teams':         return <TeamsSection />;
      case 'sprint':        return <SprintSection />;
      case 'velocity':      return <VelocitySection />;
      case 'test-coverage': return <TestCoverageSection />;
      case 'roadmap':       return <RoadmapSection />;
      case 'risks':         return <RisksSection />;
      case 'compare':       return <CompareSection />;
      case 'cross-pi':        return <CrossPITrendSection />;
      case 'scope-change':    return <ScopeChangeSection />;
      case 'pi-delivery':   return <PIDeliverySection />;
      case 'release-health': return <ReleaseHealthSection />;
      case 'pi-board':      return <ProgramBoardSection />;
      case 'insights':      return <InsightsSection />;
      case 'retro':         return <RetroSection />;
      case 'blockers':      return <BlockerBoardSection />;
      case 'pi-readiness':  return <PIReadinessSection />;
      case 'kpi':           return <KPISection />;
      case 'health':        return <HealthSection />;
      case 'admin':         return <AdminSection />;
      case 'settings':      return <SettingsSection />;
      default:              return <div style={{ padding: 24 }}>Section not found.</div>;
    }
  })();
  return (
    <SectionErrorBoundary key={id} section={label} onRetry={onRetry}>
      {content}
    </SectionErrorBoundary>
  );
}

export default function App() {
  const queryClient = useQueryClient();

  // ── Auth guard ───────────────────────────────────────────────────────────
  const { isLoading: authLoading, authenticated, user, authMode } = useAuth();
  const setActiveRole = useStore(s => s.setActiveRole);
  const activeDept    = useStore(s => s.activeDept);
  const setActiveDept = useStore(s => s.setActiveDept);

  // ── Dept routing: parse /d/:deptId/ from URL on mount ────────────────────
  const deptFromUrl = useRef(null);
  useEffect(() => {
    const match = window.location.pathname.match(/^\/d\/([^/]+)\//);
    if (match) deptFromUrl.current = match[1];
  }, []);

  // ── Auto-activate dept: URL param > session activeDeptId > stored > first accessible ─
  useEffect(() => {
    if (!authenticated || !user) return;
    const depts = user.departments || [];
    if (!depts.length) return;

    // URL param takes highest priority
    const deptId = deptFromUrl.current;
    if (deptId) {
      const found = depts.find(d => d.id === deptId);
      if (found && found.id !== activeDept?.id) {
        setActiveDept(found);
        return;
      }
    }

    // If stored activeDept belongs to a different user (not in this user's dept list), reset it
    if (activeDept && !depts.find(d => d.id === activeDept.id)) {
      setActiveDept(depts[0]);
      return;
    }

    // Single-dept user: auto-activate without showing selector
    if (depts.length === 1 && !activeDept) {
      setActiveDept(depts[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, user?.departments?.length]);

  // ── Dept selection handler: called by DeptSelectorPage ───────────────────
  function handleDeptSelected(dept) {
    setActiveDept(dept);
  }

  // Sync user's assigned role into the store
  useEffect(() => {
    if (user?.role) setActiveRole(user.role);
  }, [user?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSection     = useStore(s => s.activeSection);
  const setActiveSection  = useStore(s => s.setActiveSection);
  const applyConfig       = useStore(s => s.applyConfig);
  const setAvailablePIs   = useStore(s => s.setAvailablePIs);
  const setCurrentPI      = useStore(s => s.setCurrentPI);
  const setSelectedPIs    = useStore(s => s.setSelectedPIs);
  const setPiFilterYear   = useStore(s => s.setPiFilterYear);
  const setSelectedTeam   = useStore(s => s.setSelectedTeam);
  const setSprintLabels   = useStore(s => s.setSprintLabels);
  const currentPI         = useStore(s => s.currentPI);
  const sprintLabels      = useStore(s => s.sprintLabels);
  const activeSnapshotId   = useStore(s => s.activeSnapshotId);
  const setActiveSnapshot  = useStore(s => s.setActiveSnapshot);
  const selectedPIs        = useStore(s => s.selectedPIs);
  const availablePIs       = useStore(s => s.availablePIs);
  const slideshowRunning  = useStore(s => s.slideshowRunning);
  const slideshowSections = useStore(s => s.slideshowSections);
  const slideshowPage     = useStore(s => s.slideshowPage);
  const setSlideshowRunning = useStore(s => s.setSlideshowRunning);
  const setSlideshowPage  = useStore(s => s.setSlideshowPage);
  const branding         = useStore(s => s.branding);
  const theme            = useStore(s => s.theme);

  const { data: configData, isLoading: configLoading, error: configError } = useConfig();
  const { data: piListData, isLoading: piListLoading, error: piListError } = usePIList();

  const [apiError, setApiError] = useState(null);
  const [kbHint, setKbHint]     = useState(false);
  const urlParamsApplied        = useRef(false);
  useEffect(() => {
    if (urlParamsApplied.current) return;
    const params = new URLSearchParams(window.location.search);
    const sec  = params.get('section');
    const pi   = params.get('pi');
    const team = params.get('team');
    if (sec && NAVIGABLE_SECTIONS.includes(sec)) setActiveSection(sec);
    if (pi) setSelectedPIs(pi.split(',').map(s => s.trim()).filter(Boolean));
    if (team) setSelectedTeam(team);
    urlParamsApplied.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── URL deep-link: write params when state changes ────────────────────────
  const selectedTeam = useStore(s => s.selectedTeam);
  useEffect(() => {
    if (!authenticated) return;
    const params = new URLSearchParams();
    if (activeSection) params.set('section', activeSection);
    if (selectedPIs.length) params.set('pi', selectedPIs.join(','));
    if (selectedTeam) params.set('team', selectedTeam);
    const qs = params.toString();
    const basePath = activeDept && activeDept.id !== 'default'
      ? `/d/${activeDept.id}/`
      : '/';
    const newUrl = qs ? `${basePath}?${qs}` : basePath;
    window.history.replaceState(null, '', newUrl);
  }, [activeSection, selectedPIs, selectedTeam, authenticated, activeDept?.id]);

  // Apply saved theme on mount and whenever it changes
  useEffect(() => {
    if (theme && theme !== 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [theme]);

  // Surface API errors
  useEffect(() => {
    const msg = configError?.message || piListError?.message;
    if (msg) setApiError(msg);
  }, [configError, piListError]);

  // Wire up slideshow auto-advance
  useSlideshow(setActiveSection, setSlideshowPage);

  // Apply config to store on load
  useEffect(() => {
    if (configData) applyConfig(configData);
  }, [configData, applyConfig]);

  // Populate PI list and default selection to current PI
  useEffect(() => {
    if (piListData?.list) {
      setAvailablePIs(piListData.list);
      if (piListData.currentPI) {
        setCurrentPI(piListData.currentPI);
        if (selectedPIs.length === 0) {
          setSelectedPIs([piListData.currentPI]);
        }
        // Initialize piFilterYear from the current PI's year
        const currentPIObj = piListData.list.find(p => p.isCurrent);
        if (currentPIObj?.yy) setPiFilterYear(currentPIObj.yy);
      }
      // Apply dept-specific sprint labels from pi-list response
      if (piListData.sprintLabels?.length) {
        setSprintLabels(piListData.sprintLabels);
      }
    }
  }, [piListData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle body class for slideshow mode (hides sidebar, adjusts topbar)
  useEffect(() => {
    document.body.classList.toggle('slideshow-running', slideshowRunning);
    if (slideshowRunning) setSlideshowPage(0);
  }, [slideshowRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select best-matching snapshot for current PIs
  useEffect(() => {
    const effectivePIs = selectedPIs.length
      ? selectedPIs
      : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);
    if (!effectivePIs.length) return;
    apiFetch(`${getApiPrefix()}/snapshots`).then(data => {
      const snaps = data.snapshots || [];
      if (!snaps.length) return;
      // Exact match first (snapshot covers all current PIs), then partial, then most recent
      const best = snaps.find(s => effectivePIs.every(pi => s.pis?.includes(pi)))
                || snaps.find(s => s.pis?.some(pi => effectivePIs.includes(pi)))
                || snaps[0];
      if (!best) return;
      // Only auto-set if no snapshot chosen yet, or current one doesn't cover the new PIs
      const currentCovers = activeSnapshotId && snaps.find(s => s.id === activeSnapshotId)?.pis?.some(pi => effectivePIs.includes(pi));
      if (!currentCovers) {
        setActiveSnapshot(best.id, best.label);
      }
    }).catch(() => {});
  }, [selectedPIs.join(','), availablePIs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts — slideshow control + section navigation
  const activeRole    = useStore(s => s.activeRole);
  const customRoles   = useStore(s => s.customRoles);
  const roleOverrides = useStore(s => s.roleOverrides);
  const visibleSections = getEffectiveRoleSections(customRoles, roleOverrides)[activeRole] || NAVIGABLE_SECTIONS;

  useEffect(() => {
    let kbHintTimer;
    const handleKey = (e) => {
      // Ignore when typing in an input/textarea/select
      const tag = e.target?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;

      // ── Slideshow controls ────────────────────────────────────────────────
      if (e.key === 'Escape') {
        if (slideshowRunning) { setSlideshowRunning(false); return; }
      }
      if (slideshowRunning) {
        if (e.key === 'ArrowRight' && slideshowSections.length > 0) {
          const pageCount = SECTION_PAGES[activeSection] || 1;
          if (slideshowPage < pageCount - 1) {
            setSlideshowPage(slideshowPage + 1);
          } else {
            setSlideshowPage(0);
            const idx  = slideshowSections.indexOf(activeSection);
            const next = slideshowSections[(idx + 1) % slideshowSections.length];
            setActiveSection(next);
          }
          return;
        }
        if (e.key === 'ArrowLeft' && slideshowSections.length > 0) {
          if (slideshowPage > 0) {
            setSlideshowPage(slideshowPage - 1);
          } else {
            const idx  = slideshowSections.indexOf(activeSection);
            const prev = slideshowSections[(idx - 1 + slideshowSections.length) % slideshowSections.length];
            setSlideshowPage((SECTION_PAGES[prev] || 1) - 1);
            setActiveSection(prev);
          }
          return;
        }
        return; // no other shortcuts during slideshow
      }

      if (inInput) return;

      // ── Section navigation (1-9) ──────────────────────────────────────────
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !inInput) {
        const numKey = parseInt(e.key, 10);
        if (numKey >= 1 && numKey <= 9) {
          const target = visibleSections[numKey - 1];
          if (target) { setActiveSection(target); return; }
        }
      }

      // ── Arrow keys: cycle through visible sections ────────────────────────
      if (!e.ctrlKey && !e.metaKey && e.altKey) {
        const idx = visibleSections.indexOf(activeSection);
        if (e.key === 'ArrowRight' && idx < visibleSections.length - 1) {
          setActiveSection(visibleSections[idx + 1]);
          return;
        }
        if (e.key === 'ArrowLeft' && idx > 0) {
          setActiveSection(visibleSections[idx - 1]);
          return;
        }
      }

      // ── ? key: show shortcut hint overlay ────────────────────────────────
      if (e.key === '?' && !inInput) {
        setKbHint(v => !v);
        return;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => { window.removeEventListener('keydown', handleKey); clearTimeout(kbHintTimer); };
  }, [slideshowRunning, activeSection, slideshowSections, slideshowPage, visibleSections,
      setSlideshowRunning, setActiveSection, setSlideshowPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page when section changes outside slideshow
  useEffect(() => {
    if (!slideshowRunning) setSlideshowPage(0);
  }, [activeSection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive teams list for team filter from dashboard data
  const pis = selectedPIs.length
    ? selectedPIs
    : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);
  const { data: dashData } = useDashboard(pis);  // unfiltered — used for area-path tree only

  // Build area paths for the tree-based team filter (from raw feature + defect items)
  const areaPaths = dashData ? [
    ...(dashData.features?.items || []).map(i => i.area).filter(Boolean),
    ...(dashData.defects?.items  || []).map(i => i.area).filter(Boolean),
  ] : [];

  const initialLoading = configLoading || piListLoading;

  // ── piContext must be computed before any early returns (Rules of Hooks) ──
  const piContext = useMemo(() => {
    if (!currentPI) return { currentSprint: '', currentWeek: null };
    const match = String(currentPI).match(/(\d{2})-PI(\d+)/i);
    if (!match) return { currentSprint: '', currentWeek: null };

    const year = 2000 + Number(match[1]);
    const piNum = Number(match[2]);
    const startDate = new Date(year, (piNum - 1) * 3, 1);
    const diffDays = Math.max(0, Math.floor((Date.now() - startDate.getTime()) / 86400000));
    const currentWeek = Math.min(13, Math.max(1, Math.floor(diffDays / 7) + 1));

    let currentSprint = sprintLabels[0] || '';
    if (sprintLabels.length === 4 && String(sprintLabels[3] || '').toUpperCase() === 'IP') {
      currentSprint = currentWeek <= 4 ? sprintLabels[0] : currentWeek <= 8 ? sprintLabels[1] : currentWeek <= 12 ? sprintLabels[2] : sprintLabels[3];
    } else if (sprintLabels.length > 0) {
      const chunk = Math.max(1, Math.ceil(13 / sprintLabels.length));
      currentSprint = sprintLabels[Math.min(sprintLabels.length - 1, Math.floor((currentWeek - 1) / chunk))];
    }

    return { currentSprint, currentWeek };
  }, [currentPI, sprintLabels]);

  // ── Auth gate ────────────────────────────────────────────────────────────
  const authError = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('auth')
    : null;
  if (authLoading) return (
    <div style={{ position:'fixed', inset:0, background:'#0d0d0d', zIndex:9999,
      display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ width:40, height:40, border:'3px solid #333', borderTop:'3px solid #1492ff',
        borderRadius:'50%', animation:'spin 1s linear infinite' }} />
    </div>
  );
  if (!authenticated) return <LoginPage error={authError} authMode={authMode} />;

  // ── Dept selector gate: show when user has >1 dept and hasn't chosen yet ─
  const userDepts = user?.departments || [];
  if (userDepts.length > 1 && !activeDept) {
    return <DeptSelectorPage onSelected={handleDeptSelected} />;
  }

  function handleRefresh() {
    queryClient.invalidateQueries();
  }

  // Build share URL for current state
  function getShareUrl() {
    const params = new URLSearchParams();
    if (activeSection && activeSection !== 'features') params.set('section', activeSection);
    if (selectedPIs.length) params.set('pi', selectedPIs.join(','));
    if (selectedTeam) params.set('team', selectedTeam);
    const qs = params.toString();
    return `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ''}`;
  }

  const displayPIs = selectedPIs.length
    ? selectedPIs
    : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);
  const roleDefs = getEffectiveRoleDefs(customRoles);
  const roleLabel = roleDefs[activeRole]?.label || activeRole;
  const roleLocked = Boolean(user?.role && user.role !== 'all' && !user?.isAdmin && !user?.isSuperAdmin);
  const showPiChip = selectedPIs.length > 0 && !(selectedPIs.length === 1 && selectedPIs[0] === currentPI);
  // 'settings' is always allowed; 'admin' requires super-admin regardless of role/nav state
  const restrictedSection = activeSection !== 'settings' &&
    (activeSection === 'admin' ? !user?.isSuperAdmin : !visibleSections.includes(activeSection));
  const restrictedLabel = NAV_ITEMS.find(item => item.id === activeSection)?.label || activeSection;

  const topContent = null;

  return (
    <>
      {initialLoading && (
        <div style={{ position:'fixed', inset:0, background:'rgba(20,20,20,.85)', zIndex:9999,
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16 }}>
          <div style={{ width:48, height:48, border:'4px solid #454545', borderTop:'4px solid #1492ff',
            borderRadius:'50%', animation:'spin 1s linear infinite' }} />
          <div style={{ color:'#fff', fontSize:14 }}>Loading {branding.appName || 'Dashboard'}…</div>
        </div>
      )}

      {/* Keyboard shortcut hint overlay (press ?) */}
      {kbHint && (
        <div onClick={() => setKbHint(false)} style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:8000,
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background:'var(--surface, #1a1a2e)', border:'1px solid var(--border,#333)',
            borderRadius:8, padding:'28px 36px', minWidth:380, maxWidth:520,
          }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:16 }}>⌨ Keyboard Shortcuts</div>
              <button onClick={() => setKbHint(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted,#888)', fontSize:18 }}>✕</button>
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <tbody>
                {[
                  ['1 – 9', 'Jump to section by sidebar position (1=first visible, 2=second, …)'],
                  ['Alt + ← / →', 'Previous / Next section'],
                  ['? ', 'Toggle this help'],
                  ['Esc', 'Stop slideshow'],
                  ['← / →', 'Slideshow: previous / next (during slideshow)'],
                ].map(([k, desc]) => (
                  <tr key={k}>
                    <td style={{ padding:'6px 12px 6px 0', whiteSpace:'nowrap' }}>
                      <code style={{ background:'var(--surface2,#1e1e2e)', padding:'2px 7px', borderRadius:3, fontSize:12, color:'var(--accent,#1492ff)' }}>{k}</code>
                    </td>
                    <td style={{ padding:'6px 0', color:'var(--text-muted,#aaa)' }}>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop:16, paddingTop:12, borderTop:'1px solid var(--border,#333)', fontSize:12, color:'var(--text-muted,#888)' }}>
              <b>Share this view:</b>{' '}
              <span
                style={{ color:'var(--accent,#1492ff)', cursor:'pointer', textDecoration:'underline' }}
                onClick={() => { navigator.clipboard?.writeText(getShareUrl()); }}
                title="Click to copy share URL"
              >
                Copy link ↗
              </span>
            </div>
          </div>
        </div>
      )}

      <Layout
        activeSection={activeSection}
        onNavigate={setActiveSection}
        areaPaths={areaPaths}
        onRefresh={handleRefresh}
        error={apiError}
        onClearError={() => setApiError(null)}
        topContent={topContent}
      >
        {restrictedSection ? (
          <AccessRestricted
            section={restrictedLabel}
            adminEmail={branding.adminEmail}
            onGoBack={() => setActiveSection(visibleSections[0] || 'executive')}
          />
        ) : (
          <ActiveSection id={activeSection} onRetry={handleRefresh} />
        )}
      </Layout>

      <FloatingBar
        onNavigateSettings={() => setActiveSection(user?.isSuperAdmin ? 'admin' : 'settings')}
        areaPaths={areaPaths}
      />
    </>
  );
}
