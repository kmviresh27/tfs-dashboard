import { useState, useEffect, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import useStore from '../../store/useStore.js';
import { usePolicies } from '../../hooks/usePolicies.js';
import { useAuth } from '../../hooks/useAuth.js';
import { NAV_ITEMS, POLICY_SCHEMA, getEffectiveRoleSections } from '../../constants.js';

// ── Static base index – built once at module load, filtered at runtime ────────
const BASE_INDEX = (() => {
  const items = [];
  for (const page of POLICY_SCHEMA) {
    const navItem = NAV_ITEMS.find(n => n.id === page.id);
    if (!navItem) continue; // skip entries not in the nav (e.g. 'compare')
    items.push({ kind: 'section', sectionId: page.id, label: page.label, icon: navItem.icon, group: navItem.group });
    for (const tab of (page.tabs || []))
      items.push({ kind: 'tab', sectionId: page.id, sectionLabel: page.label, sectionIcon: navItem.icon, tabId: tab.id, label: tab.label });
    for (const chart of (page.charts || []))
      items.push({ kind: 'chart', sectionId: page.id, sectionLabel: page.label, sectionIcon: navItem.icon, chartId: chart.id, label: chart.label });
  }
  return items;
})();

const KIND_CFG = {
  section: { color: '#a855f7', badge: 'PAGE' },
  tab:     { color: '#06b6d4', badge: 'TAB' },
  chart:   { color: '#f59e0b', badge: 'CHART' },
  feature: { color: '#1492ff', badge: 'Feature' },
  defect:  { color: '#eb3f3f', badge: 'Defect' },
};

// ── Row components defined at module scope (avoids React remount-on-every-render) ──
function NavRow({ r, idx, hovered, onHover, onNavigate }) {
  const cfg = KIND_CFG[r.kind];
  return (
    <div
      onClick={() => onNavigate(r)}
      onMouseEnter={() => onHover(idx)}
      style={{
        padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8,
        cursor: 'pointer', borderBottom: '1px solid var(--border)',
        background: idx === hovered ? 'var(--surface, #111)' : 'transparent',
        transition: 'background 0.12s',
      }}
    >
      <span style={{
        fontSize: 9, padding: '2px 5px', fontWeight: 700, borderRadius: 2, flexShrink: 0,
        letterSpacing: '0.05em', background: cfg.color + '22', color: cfg.color,
        border: `1px solid ${cfg.color}44`,
      }}>{cfg.badge}</span>

      {r.kind === 'section' ? (
        <span style={{ fontSize: 13, color: 'var(--text, #eee)', flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{r.icon}</span><span style={{ fontWeight: 500 }}>{r.label}</span>
        </span>
      ) : (
        <span style={{ fontSize: 13, color: 'var(--text, #eee)', flex: 1, display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{r.sectionIcon} {r.sectionLabel} ›</span>
          <span>{r.label}</span>
        </span>
      )}

      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
        {r.kind === 'section' ? r.group : r.kind}
      </span>
    </div>
  );
}

function TFSRow({ r, idx, hovered, onHover, onNavigate, tfsBaseUrl }) {
  const cfg = KIND_CFG[r.kind];
  return (
    <div
      onClick={() => onNavigate(r)}
      onMouseEnter={() => onHover(idx)}
      style={{
        padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 10,
        cursor: 'pointer', borderBottom: '1px solid var(--border)',
        background: idx === hovered ? 'var(--surface, #111)' : 'transparent',
        transition: 'background 0.12s',
      }}
    >
      <span style={{
        fontSize: 10, padding: '2px 6px', fontWeight: 700, borderRadius: 2, flexShrink: 0,
        background: cfg.color + '33', color: cfg.color,
      }}>{cfg.badge}</span>
      {tfsBaseUrl ? (
        <a
          href={`${tfsBaseUrl}/_workitems/edit/${r.id}`}
          target="_blank" rel="noreferrer"
          onClick={e => e.stopPropagation()}
          style={{ fontSize: 11, color: 'var(--primary-light, #1492ff)', fontFamily: 'Consolas,monospace', flexShrink: 0, textDecoration: 'none' }}
          title="Open in TFS"
        >#{r.id}</a>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'Consolas,monospace', flexShrink: 0 }}>#{r.id}</span>
      )}
      <span style={{ fontSize: 13, color: 'var(--text, #eee)', flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{r.title}</span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{r.state}</span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>→ {r.sectionId}</span>
    </div>
  );
}

export default function GlobalSearch({ variant = 'icon' }) {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [hovered, setHovered] = useState(-1);
  const inputRef = useRef(null);
  const qc       = useQueryClient();

  const setActiveSection = useStore(s => s.setActiveSection);
  const selectedPIs      = useStore(s => s.selectedPIs);
  const availablePIs     = useStore(s => s.availablePIs);
  const tfsBaseUrl       = useStore(s => s.tfsBaseUrl);
  const activeRole       = useStore(s => s.activeRole);
  const customRoles      = useStore(s => s.customRoles);
  const roleOverrides    = useStore(s => s.roleOverrides);
  const policies         = useStore(s => s.policies);

  const { role } = useAuth();
  const { pageVisible, tabVisible, chartVisible } = usePolicies();

  // Section IDs the current role can access — fall back to ALL sections for roles
  // not in ROLE_SECTIONS (e.g. 'admin'), mirroring App.jsx's NAVIGABLE_SECTIONS fallback
  const visibleSectionIds = useMemo(() => {
    const sections = getEffectiveRoleSections(customRoles, roleOverrides)[activeRole];
    return new Set(sections?.length ? sections : NAV_ITEMS.map(n => n.id));
  }, [activeRole, customRoles, roleOverrides]);

  // Focus / reset on open/close
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40);
    else { setQuery(''); setResults([]); setHovered(-1); }
  }, [open]);

  // Ctrl+K shortcut
  useEffect(() => {
    function handler(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setOpen(o => !o); }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Search effect
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) { setResults([]); setHovered(-1); return; }

    // Split multi-word queries into tokens so "life cycle" matches "lifecycle"
    const tokens = q.split(/\s+/).filter(Boolean);
    const matchesAll = (str) => str && tokens.every(t => str.toLowerCase().includes(t));
    const matchesPhrase = (str) => str && str.toLowerCase().includes(q);

    const found = [];

    // 1. Navigation items (sections / tabs / charts) — role + policy gated
    for (const item of BASE_INDEX) {
      if (!visibleSectionIds.has(item.sectionId))                              continue;
      if (!pageVisible(item.sectionId))                                        continue;
      if (item.kind === 'tab'   && !tabVisible(item.sectionId, item.tabId))   continue;
      if (item.kind === 'chart' && !chartVisible(item.sectionId, item.chartId)) continue;

      const labelL  = item.label.toLowerCase();
      const parentL = (item.sectionLabel || '').toLowerCase();

      // score 2: exact phrase in label, score 1: all tokens in label, score 0: tokens only in parent breadcrumb
      let score = -1;
      if (matchesPhrase(labelL))       score = 2;
      else if (matchesAll(labelL))     score = 1;
      else if (matchesAll(parentL))    score = 0;

      if (score >= 0) found.push({ ...item, _score: score });
    }
    // Higher scores first
    found.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));

    // 2. TFS items — only for queries ≥ 2 chars and where the cache is warm
    if (q.length >= 2) {
      const pis = selectedPIs.length
        ? selectedPIs
        : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);
      const dashCache = qc.getQueryData(['dashboard', pis]);
      if (dashCache) {
        const isNumeric = /^\d+$/.test(q);
        const searchTFS = (items, kind, sectionId) => {
          for (const item of (items || [])) {
            if (found.length >= 20) break;
            const idStr = String(item.id);
            const matchId    = isNumeric ? idStr === q : idStr.includes(q);
            const matchTitle = matchesAll(item.title?.toLowerCase());
            if (matchId || matchTitle)
              found.push({ kind, id: item.id, title: item.title, state: item.state, sectionId });
          }
        };
        if (visibleSectionIds.has('features')) searchTFS(dashCache.features?.items, 'feature', 'features');
        if (visibleSectionIds.has('defects'))  searchTFS(dashCache.defects?.items,  'defect',  'defects');
      }
    }

    setResults(found);
    setHovered(found.length > 0 ? 0 : -1);
  // policies + role as proxy deps for tabVisible/chartVisible closures
  }, [query, qc, selectedPIs, availablePIs, visibleSectionIds, policies, role]); // eslint-disable-line

  function navigate(item) {
    setActiveSection(item.sectionId);
    setOpen(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape')    { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHovered(h => Math.min(h + 1, results.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHovered(h => Math.max(h - 1, 0)); return; }
    if (e.key === 'Enter' && hovered >= 0 && results[hovered]) navigate(results[hovered]);
  }

  const navResults = results.filter(r => r.kind === 'section' || r.kind === 'tab' || r.kind === 'chart');
  const tfsResults = results.filter(r => r.kind === 'feature' || r.kind === 'defect');
  const svgSearch = <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>;

  return (
    <>
      {variant === 'bar' ? (
        <button className={`topbar-search-bar${open ? ' topbar-search-bar--active' : ''}`} onClick={() => setOpen(o => !o)} title="Global Search (Ctrl+K)">
          <span style={{ width: 14, height: 14, flexShrink: 0, opacity: 0.6 }}>{svgSearch}</span>
          <span className="topbar-search-bar-text">Search…</span>
          <kbd className="topbar-search-kbd">Ctrl K</kbd>
        </button>
      ) : (
        <button className="topbar-icon-btn" onClick={() => setOpen(o => !o)} title="Global Search (Ctrl+K)" style={open ? { color: 'var(--primary, #1492ff)' } : {}}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width={16} height={16}><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>
        </button>
      )}

      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000 }} onMouseDown={() => setOpen(false)}>
          <div
            style={{
              position: 'absolute', top: 52, left: '50%', transform: 'translateX(-50%)',
              width: 'min(620px, 94vw)',
              background: 'var(--surface2, #1e1e2e)',
              border: '1px solid var(--border, #454545)',
              borderRadius: 6, boxShadow: '0 16px 48px rgba(0,0,0,0.75)',
              overflow: 'hidden',
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            {/* Input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width={15} height={15} style={{ color: 'var(--text-muted, #888)', flexShrink: 0 }}><path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" /></svg>
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search sections, charts, tabs, features, defects…"
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text, #eee)', fontSize: 15, padding: 0 }}
              />
              {query && (
                <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>✕</button>
              )}
              <kbd style={{ fontSize: 10, background: 'var(--surface, #111)', border: '1px solid var(--border)', borderRadius: 3, padding: '2px 5px', color: 'var(--text-muted)', flexShrink: 0 }}>Esc</kbd>
            </div>

            {/* Results */}
            {results.length > 0 ? (
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                {navResults.length > 0 && (
                  <>
                    <div style={{ padding: '4px 14px 3px', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      Navigation
                    </div>
                    {navResults.map((r, i) => (
                      <NavRow
                        key={`nav-${r.kind}-${r.sectionId}-${r.tabId || r.chartId || ''}`}
                        r={r} idx={i} hovered={hovered}
                        onHover={setHovered} onNavigate={navigate}
                      />
                    ))}
                  </>
                )}
                {tfsResults.length > 0 && (
                  <>
                    <div style={{ padding: '4px 14px 3px', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', borderTop: navResults.length > 0 ? '1px solid var(--border)' : 'none', marginTop: navResults.length > 0 ? 4 : 0 }}>
                      TFS Items
                    </div>
                    {tfsResults.map((r, i) => (
                      <TFSRow
                        key={`tfs-${r.kind}-${r.id}`}
                        r={r} idx={navResults.length + i} hovered={hovered}
                        onHover={setHovered} onNavigate={navigate} tfsBaseUrl={tfsBaseUrl}
                      />
                    ))}
                  </>
                )}
              </div>
            ) : query.length >= 1 ? (
              <div style={{ padding: '28px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No results for "<strong>{query}</strong>"
                <div style={{ fontSize: 11, marginTop: 6 }}>Try a section name, chart, tab, or TFS item ID / title</div>
              </div>
            ) : (
              <div style={{ padding: '16px 14px', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.7 }}>
                <div style={{ marginBottom: 6, fontWeight: 600, color: 'var(--text)' }}>Quick search</div>
                Type to navigate to any <span style={{ color: KIND_CFG.section.color }}>page</span>, <span style={{ color: KIND_CFG.tab.color }}>tab</span>, <span style={{ color: KIND_CFG.chart.color }}>chart</span>, <span style={{ color: KIND_CFG.feature.color }}>feature</span>, or <span style={{ color: KIND_CFG.defect.color }}>defect</span>.<br />
                Results respect your current role &amp; policy visibility.
              </div>
            )}

            {/* Footer */}
            <div style={{ padding: '5px 14px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 14 }}>
              <span>↑↓ Navigate</span>
              <span>↵ Go to section</span>
              <span>Esc Close</span>
              <span style={{ marginLeft: 'auto' }}>Ctrl+K to toggle</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
