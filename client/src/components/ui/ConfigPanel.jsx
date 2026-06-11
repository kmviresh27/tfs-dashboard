import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import useStore from '../../store/useStore.js';
import { useAuth } from '../../hooks/useAuth.js';

// ── Tree helpers (same algorithm as vanilla teamFilter.js) ─────────────────
function buildAreaTree(areaPaths) {
  const pathSet = new Set();
  areaPaths.forEach(a => {
    const n = (a || '').replace(/\//g, '\\').replace(/\\+$/, '').trim();
    if (n) pathSet.add(n);
  });
  if (!pathSet.size) return {};
  const paths = [...pathSet].sort();
  const segs0 = paths[0].split('\\');
  let cLen = segs0.length;
  for (const p of paths) {
    const s = p.split('\\'); let i = 0;
    while (i < cLen && i < s.length && s[i] === segs0[i]) i++;
    cLen = i;
  }
  const base = segs0.slice(0, Math.max(0, cLen - 1)).join('\\');
  const p2a = {};
  paths.forEach(abs => {
    const rel = base ? abs.slice(base.length + 1) : abs;
    if (!rel) return;
    rel.split('\\').forEach((_, i) => {
      const k = rel.split('\\').slice(0, i + 1).join('\\');
      if (!p2a[k]) p2a[k] = base ? base + '\\' + k : k;
    });
  });
  const trie = {};
  Object.keys(p2a).sort().forEach(rel => {
    const parts = rel.split('\\');
    let node = trie;
    parts.forEach((seg, i) => {
      if (!node[seg]) node[seg] = { _abs: p2a[parts.slice(0, i + 1).join('\\')], _children: {} };
      node = node[seg]._children;
    });
  });
  return trie;
}

function flattenTree(trie, depth = 0, out = []) {
  Object.keys(trie).sort().forEach(seg => {
    const node = trie[seg];
    const abs  = node._abs || '';
    const parts = abs.split('\\');
    out.push({ seg, val: 'ROOT:' + abs, pathStr: parts.length > 1 ? parts.slice(0, -1).join(' › ') : '', depth });
    flattenTree(node._children, depth + 1, out);
  });
  return out;
}

function TreeNode({ seg, node, depth, selected, onSelect, expanded, toggleExpand }) {
  const val        = 'ROOT:' + (node._abs || '');
  const hasKids    = Object.keys(node._children).length > 0;
  const isOpen     = expanded.has(node._abs || '');
  const isSelected = selected === val;

  return (
    <div>
      <div className="cp-tree-row" style={{ paddingLeft: 8 + depth * 16 }}>
        {hasKids ? (
          <span
            className={`cp-tree-chevron${isOpen ? ' open' : ''}`}
            onClick={e => { e.stopPropagation(); toggleExpand(node._abs || ''); }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : (
          <span className="cp-tree-spacer" />
        )}
        <label className="cp-tree-label-row" onClick={() => onSelect(val)}>
          <span className={`cp-tree-cb${isSelected ? ' checked' : ''}`}>
            {isSelected && (
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                <path d="M1.5 4l2 2 3-3" stroke="#fff" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span className={`cp-tree-text${hasKids ? ' branch' : ''}`}>{seg}</span>
        </label>
      </div>

      {hasKids && isOpen && (
        <div>
          {Object.keys(node._children).sort().map(s => (
            <TreeNode key={s} seg={s} node={node._children[s]} depth={depth + 1}
              selected={selected} onSelect={onSelect} expanded={expanded} toggleExpand={toggleExpand} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Roles ──────────────────────────────────────────────────────────────────

const SAVED_VIEWS_KEY = 'av-saved-views';
const MAX_SAVED_VIEWS = 8;

function loadSavedViews() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SAVED_VIEWS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(Boolean)
      .map((view, index) => ({
        id: String(view.id || `saved-view-${index}`),
        name: String(view.name || 'Saved View').trim() || 'Saved View',
        pis: Array.isArray(view.pis) ? view.pis.filter(Boolean).map(String) : [],
        team: String(view.team || ''),
        role: String(view.role || 'all'),
        snapshotId: view.snapshotId || null,
        snapshotLabel: view.snapshotLabel || null,
        savedAt: Number.isFinite(Number(view.savedAt)) ? Number(view.savedAt) : Date.now(),
      }))
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, MAX_SAVED_VIEWS);
  } catch {
    return [];
  }
}

function formatSavedViewTeam(team) {
  const raw = team && team.startsWith('ROOT:') ? team.slice(5) : team;
  return raw ? raw.split('\\').pop() : 'All Teams';
}

function formatSavedViewMeta(view) {
  const piText = view.pis?.length ? view.pis.join(', ') : 'All PIs';
  return `${piText} • ${formatSavedViewTeam(view.team)}`;
}

// ── ConfigPanel ────────────────────────────────────────────────────────────
export default function ConfigPanel({ areaPaths = [], onOpenSnapshots }) {
  const [open, setOpen] = useState(false);
  const wrapRef  = useRef(null);
  const btnRef   = useRef(null);
  const [popupPos, setPopupPos] = useState({ top: 0, right: 0 });
  const initialSavedViews = useMemo(() => loadSavedViews(), []);
  const [savedViews, setSavedViews] = useState(initialSavedViews);
  const [activeViewId, setActiveViewId] = useState(null);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');
  const [saveViewMessage, setSaveViewMessage] = useState('');

  // Store
  const selectedPIs         = useStore(s => s.selectedPIs);
  const setSelectedPIs      = useStore(s => s.setSelectedPIs);
  const availablePIs        = useStore(s => s.availablePIs);
  const piFilterYear        = useStore(s => s.piFilterYear);
  const setPiFilterYear     = useStore(s => s.setPiFilterYear);
  const selectedTeam        = useStore(s => s.selectedTeam);
  const setSelectedTeam     = useStore(s => s.setSelectedTeam);
  const activeSnapshotId    = useStore(s => s.activeSnapshotId);
  const activeSnapshotLabel = useStore(s => s.activeSnapshotLabel);
  const setActiveSnapshot   = useStore(s => s.setActiveSnapshot);

  // Local staged PI selections (applied only on Apply)
  const [localPIs, setLocalPIs] = useState(selectedPIs);
  useEffect(() => { if (open) setLocalPIs(selectedPIs); }, [open]); // sync on open
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(savedViews));
    }
  }, [savedViews]);

  // Team tree state — auto-expand first level when popup opens
  const [tfSearch,   setTfSearch]   = useState('');
  const [expanded,   setExpanded]   = useState(new Set());

  const trie     = useMemo(() => buildAreaTree(areaPaths),  [areaPaths]);
  const flatList = useMemo(() => flattenTree(trie),         [trie]);

  // Auto-expand top-level nodes on first open
  useEffect(() => {
    if (open) {
      setExpanded(new Set(Object.values(trie).map(n => n._abs || '').filter(Boolean)));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const tfResults = useMemo(() => {
    if (!tfSearch.trim()) return [];
    const q = tfSearch.trim().toLowerCase();
    return flatList.filter(it => it.seg.toLowerCase().includes(q));
  }, [tfSearch, flatList]);

  function toggleExpand(abs) {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(abs) ? n.delete(abs) : n.add(abs);
      return n;
    });
  }

  // PI year
  const years      = [...new Set(availablePIs.map(p => p.yy).filter(Boolean))].sort((a, b) => a - b);
  const activeYear = piFilterYear ?? years[years.length - 1];
  const visiblePIs = availablePIs.filter(p => p.yy === activeYear);

  const { user } = useAuth();

  // Config button badge pills
  const teamLabel = selectedTeam
    ? (selectedTeam.startsWith('ROOT:') ? selectedTeam.slice(5) : selectedTeam).split('\\').pop()
    : null;
  const snapLabel  = activeSnapshotLabel || null;
  const piLabel    = selectedPIs.length ? selectedPIs.join(', ') : 'All PIs';
  const btnBadges  = [
    { key: 'pi',   icon: 'PI',   text: piLabel },
    teamLabel ? { key: 'team',  icon: 'Team', text: teamLabel }  : null,
    snapLabel ? { key: 'snap',  icon: 'Plan', text: snapLabel }  : null,
  ].filter(Boolean);

  // Close on outside click — must check both the button wrap and the portal popup
  useEffect(() => {
    function onDown(e) {
      const popup = document.getElementById('config-popup-portal');
      const insideWrap  = wrapRef.current && wrapRef.current.contains(e.target);
      const insidePopup = popup && popup.contains(e.target);
      if (!insideWrap && !insidePopup) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function openPopup() {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPopupPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
    setOpen(o => !o);
  }

  function handleApply() {
    setSelectedPIs(localPIs);
    // Sync piFilterYear from the applied PI selection so charts (e.g. Escape Ratio) update correctly
    const matchedPI = availablePIs.find(pi => localPIs.includes(pi.label));
    if (matchedPI?.yy) setPiFilterYear(matchedPI.yy);
    setOpen(false);
  }
  function handleCancel() {
    setLocalPIs(selectedPIs);
    setOpen(false);
  }

  /** Select a team and immediately close the popup so the user sees updated charts. */
  function handleTeamSelect(val) {
    setSelectedTeam(val);
    setTfSearch('');
    setOpen(false);
  }

  function applySavedView(view) {
    const nextPIs = Array.isArray(view.pis) ? view.pis : [];
    const nextTeam = view.team || '';
    const nextSnapshotId = view.snapshotId || null;
    const nextSnapshotLabel = view.snapshotLabel || null;
    const matchedPI = availablePIs.find(pi => nextPIs.includes(pi.label));

    if (matchedPI?.yy) setPiFilterYear(matchedPI.yy);
    setLocalPIs(nextPIs);
    setSelectedPIs(nextPIs);
    setSelectedTeam(nextTeam);
    setActiveSnapshot(nextSnapshotId, nextSnapshotLabel);
    setTfSearch('');
    setShowSaveForm(false);
    setSaveViewName('');
    setSaveViewMessage('');
    setActiveViewId(view.id);
    setOpen(false);
  }

  function handleOpenSaveForm() {
    if (savedViews.length >= MAX_SAVED_VIEWS) {
      setSaveViewMessage('Max 8 views reached');
      return;
    }
    setSaveViewMessage('');
    setShowSaveForm(true);
  }

  function handleSaveCurrentView() {
    const name = saveViewName.trim();
    if (!name) {
      setSaveViewMessage('Enter a name to save this view');
      return;
    }
    if (savedViews.length >= MAX_SAVED_VIEWS) {
      setSaveViewMessage('Max 8 views reached');
      return;
    }

    setSavedViews(prev => [{
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `saved-view-${Date.now()}`,
      name,
      pis: [...localPIs],
      team: selectedTeam,
      snapshotId: activeSnapshotId,
      snapshotLabel: activeSnapshotLabel,
      savedAt: Date.now(),
    }, ...prev].slice(0, MAX_SAVED_VIEWS));
    setSaveViewName('');
    setSaveViewMessage('');
    setShowSaveForm(false);
  }

  function handleDeleteSavedView(id) {
    setSavedViews(prev => prev.filter(view => view.id !== id));
    setSaveViewMessage('');
  }

  // Highlight search term helper
  function hilite(text) {
    if (!tfSearch.trim()) return text;
    const esc = tfSearch.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${esc})`, 'gi'), '<mark class="tf-result-match">$1</mark>');
  }

  const popup = open && createPortal(
    <div
      id="config-popup-portal"
      className="config-popup"
      role="dialog"
      aria-label="Configure filters"
      style={{ position: 'fixed', top: popupPos.top, right: popupPos.right, left: 'auto' }}
    >
      <button className="config-close-btn" onClick={() => setOpen(false)} title="Close">✕</button>

      <div className="config-popup-body">

        <div className="config-divider" />

        <div className="config-section">
          <div className="config-section-hd">Saved Views</div>
          <div className="config-section-sub">Save and reuse common PI, team, role, and snapshot combinations</div>

          <div className="saved-views-toolbar">
            <button className="btn btn-ghost btn-sm" onClick={handleOpenSaveForm}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:4}}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Save Current View
            </button>
            {savedViews.length >= MAX_SAVED_VIEWS && <span className="saved-view-limit">Max 8 views reached</span>}
          </div>

          {showSaveForm && (
            <div className="saved-view-form">
              <span className="saved-view-form-label">name:</span>
              <input
                className="saved-view-input"
                type="text"
                value={saveViewName}
                onChange={e => setSaveViewName(e.target.value)}
                placeholder="Enter view name"
                maxLength={40}
              />
              <button className="btn btn-primary btn-sm" onClick={handleSaveCurrentView}>Save</button>
            </div>
          )}

          {saveViewMessage && <div className="saved-view-message">{saveViewMessage}</div>}

          <div className="saved-views-list-label">Saved:</div>
          {savedViews.length ? (
            <div className="saved-views-list">
              {savedViews.map(view => (
                <div key={view.id} className="saved-view-row">
                  <button
                    className={`saved-view-chip${activeViewId === view.id ? ' active' : ''}`}
                    onClick={() => applySavedView(view)}
                    title={`Apply ${view.name}`}
                  >
                    <span className="saved-view-chip-name">{view.name}</span>
                    <span className="saved-view-chip-meta">{formatSavedViewMeta(view)}</span>
                  </button>
                  <button
                    className="saved-view-delete"
                    onClick={e => {
                      e.stopPropagation();
                      handleDeleteSavedView(view.id);
                    }}
                    title={`Delete ${view.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="saved-view-empty">No saved views yet</div>
          )}
        </div>

        <div className="config-divider" />

        {/* ── 1. Programme Increments ─────────────────────────────── */}
        <div className="config-section">
          <div className="config-section-hd">Programme Increments</div>
          <div className="config-section-sub">Select one or more PIs to analyse</div>
          {years.length > 1 && (
            <div className="pi-year-row">
              {years.map(y => (
                <button key={y}
                  className={`pi-year-btn${y === activeYear ? ' active' : ''}`}
                  onClick={() => setPiFilterYear(y)}>
                  {y}
                </button>
              ))}
            </div>
          )}
          <div className="pi-filter-grid">
            {visiblePIs.map(p => (
              <button key={p.label}
                className={`pi-check-btn${localPIs.includes(p.label) ? ' selected' : ''}${p.isCurrent ? ' current' : ''}`}
                onClick={() => setLocalPIs(prev =>
                  prev.includes(p.label) ? prev.filter(x => x !== p.label) : [...prev, p.label]
                )}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="config-pi-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setLocalPIs([])}>Clear selection</button>
          </div>
        </div>

        <div className="config-divider" />

        {/* ── 2. Team Filter ──────────────────────────────────────── */}
        <div className="config-section">
          <div className="config-section-hd">Team Filter</div>
          <div className="config-section-sub">Scope all charts to a specific team or sub-team</div>
          <div className="tf-search-wrap">
            <input
              className="tf-search-input"
              type="text"
              placeholder="🔍 Search teams…"
              autoComplete="off"
              value={tfSearch}
              onChange={e => setTfSearch(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && tfSearch && setTfSearch('')}
            />
          </div>
          <div className="config-tf-tree">
            {tfSearch.trim() ? (
              tfResults.length > 0 ? tfResults.map(it => (
                <div key={it.val}
                  className={`tf-result-row${selectedTeam === it.val ? ' selected' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleTeamSelect(it.val)}>
                  <span className="tf-result-name"
                    dangerouslySetInnerHTML={{ __html: hilite(it.seg) }} />
                  {it.pathStr && <span className="tf-result-path">{it.pathStr}</span>}
                </div>
              )) : (
                <div className="tf-no-results">No teams match "{tfSearch}"</div>
              )
            ) : (
              <>
                <div className="cp-tree-row cp-tree-all" onClick={() => handleTeamSelect('')}>
                  <span className="cp-tree-spacer" />
                  <label className="cp-tree-label-row">
                    <span className={`cp-tree-cb${!selectedTeam ? ' checked' : ''}`}>
                      {!selectedTeam && (
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
                          <path d="M1.5 4l2 2 3-3" stroke="#fff" strokeWidth="1.5"
                            strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="cp-tree-text" style={{ fontWeight: 700 }}>All Teams</span>
                  </label>
                </div>
                {Object.keys(trie).sort().map(seg => (
                  <TreeNode key={seg} seg={seg} node={trie[seg]} depth={0}
                    selected={selectedTeam} onSelect={handleTeamSelect}
                    expanded={expanded} toggleExpand={toggleExpand} />
                ))}
              </>
            )}
          </div>
        </div>

        {/* ── 3. PI Plan Data ─────────────────────────────────────── */}
        <div className="config-section">
          <div className="config-section-hd">PI Plan Data</div>
          <div className="config-section-sub">Baseline snapshot for Predictability &amp; Defect Delta</div>
          <div className="config-snap-row">
            {activeSnapshotId ? (
              <div className="active-snap-chip config-snap-chip">
                <span className="active-snap-icon">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                </span>
                <span className="active-snap-text">{activeSnapshotLabel}</span>
                <button className="active-snap-clear"
                  onClick={() => setActiveSnapshot(null, null)} title="Clear PI Plan Data">✕</button>
              </div>
            ) : (
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>No snapshot selected</span>
            )}
            <button className="btn btn-ghost btn-sm"
              onClick={() => { setOpen(false); onOpenSnapshots?.(); }}>
              Browse Snapshots →
            </button>
          </div>
        </div>

      </div>{/* /.config-popup-body */}

      <div className="config-popup-footer">
        <button className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={handleApply}>Apply</button>
      </div>

    </div>,
    document.body
  );

  return (
    <div className="tb-config-wrap" ref={wrapRef}>
      {/* Trigger button */}
      <button
        ref={btnRef}
        className={`tb-config-btn${open ? ' open' : ''}`}
        onClick={openPopup}
        title="Configure filters & view mode"
      >
        <span className="tb-config-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </span>
        <span className="tb-config-badges">
          {btnBadges.map(b => (
            <span key={b.key} className="tb-config-badge">
              <span className="tb-badge-icon">{b.icon}</span>
              <span className="tb-badge-text">{b.text}</span>
            </span>
          ))}
        </span>
        <span className="tf-caret">▾</span>
      </button>
      {popup}
    </div>
  );
}
