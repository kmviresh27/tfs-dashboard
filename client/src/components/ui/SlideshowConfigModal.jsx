import { useEffect, useState } from 'react';
import useStore from '../../store/useStore.js';
import { NAV_ITEMS, POLICY_SCHEMA, getEffectiveRoleSections } from '../../constants.js';
import { useAuth } from '../../hooks/useAuth.js';

// Section → charts lookup from POLICY_SCHEMA
const SECTION_CHARTS_MAP = Object.fromEntries(
  POLICY_SCHEMA.map(s => [s.id, s.charts || []])
);

function sectionChartKeys(sectionId) {
  return (SECTION_CHARTS_MAP[sectionId] || []).map(c => `${sectionId}.${c.id}`);
}

function initChartSel(sectionIds) {
  const sel = new Set();
  sectionIds.forEach(id => sectionChartKeys(id).forEach(k => sel.add(k)));
  return sel;
}

const labelStyle = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '.5px', color: 'var(--muted)',
};
const ghostBtnStyle = {
  fontSize: 11, padding: '2px 8px', background: 'transparent',
  border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer',
};
const miniBtn = {
  fontSize: 10, padding: '1px 6px', background: 'transparent',
  border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer',
};

function CheckboxSquare({ checked, indeterminate, size = 14, onClick }) {
  return (
    <span
      onClick={onClick}
      style={{
        width: size, height: size, flexShrink: 0,
        border: `1.5px solid ${checked || indeterminate ? 'var(--primary)' : 'var(--muted)'}`,
        borderRadius: 3,
        background: checked && !indeterminate ? 'var(--primary)' : 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', transition: 'all 0.12s',
      }}
    >
      {checked && !indeterminate && (
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1.5 4l2 2 3-3" stroke="#fff" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {indeterminate && (
        <svg width="8" height="2" viewBox="0 0 8 2" fill="none">
          <rect width="8" height="2" rx="1" fill="var(--primary)" />
        </svg>
      )}
    </span>
  );
}

export default function SlideshowConfigModal({ open, onClose }) {
  const setSlideshowConfig  = useStore(s => s.setSlideshowConfig);
  const setSlideshowRunning = useStore(s => s.setSlideshowRunning);
  const slideshowInterval   = useStore(s => s.slideshowInterval);
  const customRoles         = useStore(s => s.customRoles);
  const roleOverrides       = useStore(s => s.roleOverrides);

  const roleSections = getEffectiveRoleSections(customRoles, roleOverrides);
  const { user } = useAuth();

  const [interval, setInterval_]      = useState(slideshowInterval);
  const [selSections, setSelSections] = useState(() => new Set(roleSections.all || []));
  const [chartSel, setChartSel]       = useState(() => initChartSel(roleSections.all || []));
  const [expandedSecs, setExpanded]   = useState(new Set());

  // Sync interval and pre-select sections for user's role when modal opens
  useEffect(() => {
    if (open) {
      setInterval_(slideshowInterval);
      const userRole = user?.role || 'all';
      const secs = roleSections[userRole] || roleSections.all || [];
      setSelSections(new Set(secs));
      setChartSel(initChartSel(secs));
    }
  }, [open, slideshowInterval]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSection(id) {
    setSelSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setChartSel(p => {
          const n = new Set(p);
          sectionChartKeys(id).forEach(k => n.delete(k));
          return n;
        });
      } else {
        next.add(id);
        setChartSel(p => {
          const n = new Set(p);
          sectionChartKeys(id).forEach(k => n.add(k));
          return n;
        });
        // Auto-expand when adding a section that has charts
        if ((SECTION_CHARTS_MAP[id] || []).length > 0) {
          setExpanded(p => new Set([...p, id]));
        }
      }
      return next;
    });
  }

  function toggleChart(sectionId, chartId) {
    const key = `${sectionId}.${chartId}`;
    setChartSel(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  function toggleExpand(id) {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function handleStart() {
    if (selSections.size === 0) return;
    const intervalVal = Math.max(3, Number(interval) || 10);
    const sections = [...selSections];
    const charts   = chartSel.size > 0 ? [...chartSel] : null;
    setSlideshowConfig({ interval: intervalVal, sections, charts });
    setSlideshowRunning(true);
    onClose();
    // Request fullscreen inside the user gesture so the browser allows it
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) {
      el.requestFullscreen().catch(() => { /* denied — continue in windowed mode */ });
    } else if (el.webkitRequestFullscreen && !document.fullscreenElement) {
      el.webkitRequestFullscreen();
    }
  }

  if (!open) return null;

  const totalCharts = [...selSections].reduce(
    (n, id) => n + (SECTION_CHARTS_MAP[id] || []).length, 0
  );
  const selectedChartCount = [...chartSel].filter(k => {
    const [sec] = k.split('.');
    return selSections.has(sec);
  }).length;

  return (
    <div
      className="table-modal-overlay"
      style={{ zIndex: 9000 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="table-modal-panel" style={{ maxWidth: 560, width: '100%' }}>
        <div className="table-modal-header">
          <span className="table-modal-title">🎬 Slideshow Configuration</span>
          <button className="table-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="table-modal-body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', maxHeight: 'calc(80vh - 120px)' }}>

          {/* Row 1: Interval */}
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>Interval (seconds)</label>
              <input
                type="number" min="3" value={interval}
                onChange={e => setInterval_(e.target.value)}
                style={{
                  width: 80, padding: '6px 10px',
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  color: 'var(--text)', fontSize: 14, outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Section + Chart tree */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={labelStyle}>
                Sections &amp; Charts &nbsp;
                <span style={{ color: 'var(--muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                  {selSections.size} sections · {selectedChartCount}/{totalCharts} charts
                </span>
              </label>
              <div style={{ display: 'flex', gap: 4 }}>
                <button style={ghostBtnStyle} onClick={() => {
                  const all = new Set(NAV_ITEMS.map(n => n.id));
                  setSelSections(all);
                  setChartSel(initChartSel([...all]));
                }}>All</button>
                <button style={ghostBtnStyle} onClick={() => {
                  setSelSections(new Set());
                  setChartSel(new Set());
                }}>None</button>
              </div>
            </div>

            <div style={{ border: '1px solid var(--border)', background: 'var(--bg)' }}>
              {NAV_ITEMS.map(navItem => {
                const charts       = SECTION_CHARTS_MAP[navItem.id] || [];
                const isSelected   = selSections.has(navItem.id);
                const isExpanded   = expandedSecs.has(navItem.id);
                const selCount     = charts.filter(c => chartSel.has(`${navItem.id}.${c.id}`)).length;
                const isIndet      = isSelected && charts.length > 0 && selCount < charts.length;
                const hasCharts    = charts.length > 0;

                return (
                  <div key={navItem.id}>
                    {/* Section row */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 10px',
                      background: isSelected ? 'rgba(20,146,255,0.05)' : 'transparent',
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                    }}>
                      <CheckboxSquare
                        checked={isSelected}
                        indeterminate={isIndet}
                        onClick={() => toggleSection(navItem.id)}
                      />

                      <span
                        onClick={() => toggleSection(navItem.id)}
                        style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6,
                          fontSize: 13, fontWeight: 600,
                          color: isSelected ? 'var(--text)' : 'var(--muted)' }}
                      >
                        <span>{navItem.icon}</span>
                        <span>{navItem.label}</span>
                        {isSelected && hasCharts && (
                          <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>
                            {selCount}/{charts.length}
                          </span>
                        )}
                      </span>

                      {hasCharts && (
                        <button
                          onClick={e => { e.stopPropagation(); toggleExpand(navItem.id); }}
                          style={{ ...miniBtn, fontSize: 10, display: 'flex', alignItems: 'center', gap: 3 }}
                        >
                          {isExpanded
                            ? <><span>▲</span> hide</>
                            : <><span>▼</span> charts</>}
                        </button>
                      )}
                    </div>

                    {/* Charts list (expanded) */}
                    {isExpanded && hasCharts && (
                      <div style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, padding: '4px 10px 2px' }}>
                          <button style={miniBtn} onClick={() =>
                            setChartSel(p => { const n = new Set(p); sectionChartKeys(navItem.id).forEach(k => n.add(k)); return n; })
                          }>all</button>
                          <button style={miniBtn} onClick={() =>
                            setChartSel(p => { const n = new Set(p); sectionChartKeys(navItem.id).forEach(k => n.delete(k)); return n; })
                          }>none</button>
                        </div>
                        {charts.map(chart => {
                          const key     = `${navItem.id}.${chart.id}`;
                          const checked = chartSel.has(key);
                          return (
                            <div
                              key={chart.id}
                              onClick={() => toggleChart(navItem.id, chart.id)}
                              style={{ display: 'flex', alignItems: 'center', gap: 8,
                                padding: '5px 10px 5px 32px', cursor: 'pointer' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card2)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                              <CheckboxSquare checked={checked} size={12}
                                onClick={() => toggleChart(navItem.id, chart.id)} />
                              <span style={{ fontSize: 12, color: checked ? 'var(--text)' : 'var(--muted)' }}>
                                {chart.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '12px 20px', borderTop: '1px solid var(--border)',
          background: 'var(--bg-sidebar)',
        }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleStart}
            disabled={selSections.size === 0}
          >
            ▶ Start Slideshow
          </button>
        </div>
      </div>
    </div>
  );
}
