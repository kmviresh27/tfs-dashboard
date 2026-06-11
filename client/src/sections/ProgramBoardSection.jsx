import { useState, useMemo } from 'react';
import useStore from '../store/useStore.js';
import { useFilteredDashboard, useDependencies } from '../api/hooks.js';
import { extractTeamFromPath } from '../utils.js';
import { getPIs } from '../tfsLinks.js';
import { PageLoader } from '../components/ui/PageLoader.jsx';
import { COLORS } from '../constants.js';
import { TFSItemLink } from '../components/ui/TFSLink';

// ── State colour map ──────────────────────────────────────────────────────────
const STATE_COLORS = {
  Forecasted: '#1492ff',
  New:        '#858FFF',
  Activated:  '#9B5CFF',
  Approved:   '#ff7f0f',
  Done:       '#068443',
  Removed:    '#757575',
};

function stateColor(state) {
  return STATE_COLORS[state] || '#454545';
}

// ── Extract sprint label from iteration path ──────────────────────────────────
// iter = "Healthcare IT\ISP\26-PI2\26-PI2 S1"  → "S1"
function extractSprint(iterPath, sprintLabels) {
  if (!iterPath) return null;
  const parts = iterPath.replace(/\//g, '\\').split('\\');
  const last  = parts[parts.length - 1] || '';
  // Match against known sprint labels (case-insensitive suffix)
  for (const lbl of sprintLabels) {
    if (last.toUpperCase().endsWith(lbl.toUpperCase())) return lbl.toUpperCase();
  }
  // Fallback: check if last segment IS a sprint label
  const up = last.toUpperCase();
  for (const lbl of sprintLabels) {
    if (up === lbl.toUpperCase()) return lbl.toUpperCase();
  }
  return null;
}

// ── Tiny feature card ─────────────────────────────────────────────────────────
function FeatureCard({ feature, tfsBaseUrl, deps }) {
  const [expanded, setExpanded] = useState(false);
  const sc = stateColor(feature.state);
  const depsOn   = (deps.find(d => d.id === feature.id)?.deps || []).length;
  const depsFrom = deps.filter(d => d.deps?.some(dep => dep.id === feature.id)).length;

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        background: 'var(--surface2, #1e1e2e)',
        border: `1px solid ${sc}55`,
        borderLeft: `3px solid ${sc}`,
        borderRadius: 2,
        padding: '5px 7px',
        marginBottom: 4,
        cursor: 'pointer',
        fontSize: 11,
        transition: 'border-color 0.15s',
      }}
      title={`${feature.title} — ${feature.state}`}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
          <span style={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <TFSItemLink id={feature.id} tfsBaseUrl={tfsBaseUrl} />
          </span>
          <span style={{
            background: sc + '22', color: sc, fontSize: 9, padding: '1px 4px',
            borderRadius: 2, fontWeight: 700, flexShrink: 0,
          }}>{feature.state}</span>
        </div>
        {(depsOn > 0 || depsFrom > 0) && (
          <span style={{ fontSize: 9, color: '#F5CC00', flexShrink: 0 }} title={`${depsOn} dep(s) outgoing, ${depsFrom} dep(s) incoming`}>
            🔗 {depsOn + depsFrom}
          </span>
        )}
      </div>
      <div style={{ marginTop: 3, color: 'var(--text, #eee)', lineHeight: 1.3, wordBreak: 'break-word' }}>
        {expanded ? feature.title : feature.title?.length > 55 ? feature.title.slice(0, 55) + '…' : feature.title}
      </div>
      {expanded && (
        <div style={{ marginTop: 4, color: 'var(--text-muted, #888)', fontSize: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {feature.assignedTo && <span>👤 {feature.assignedTo}</span>}
          {feature.size        && <span>📏 {feature.size} pts</span>}
          {depsOn  > 0 && <span style={{ color: '#F5CC00' }}>↗ {depsOn} dep-on</span>}
          {depsFrom > 0 && <span style={{ color: '#ff7f0f' }}>↙ {depsFrom} needed-by</span>}
        </div>
      )}
    </div>
  );
}

// ── Main section ──────────────────────────────────────────────────────────────
export default function ProgramBoardSection() {
  const store        = useStore(s => s);
  const selectedTeam = store.selectedTeam;
  const sprintLabels = store.sprintLabels?.map(l => l.toUpperCase()) || ['S1', 'S2', 'S3', 'IP'];

  const pis = getPIs(store);

  const { data, isLoading, error } = useFilteredDashboard(pis, selectedTeam);
  const { data: depsData }         = useDependencies(pis, selectedTeam);

  const [hideDone, setHideDone]       = useState(false);
  const [hideRemoved, setHideRemoved] = useState(true);
  const [compact, setCompact]         = useState(false);

  const allFeatures = data?.features?.items || [];
  const allDeps     = depsData?.features || [];

  // Filter features
  const features = useMemo(() => {
    let f = allFeatures;
    if (hideDone)    f = f.filter(x => x.state !== 'Done');
    if (hideRemoved) f = f.filter(x => x.state !== 'Removed');
    return f;
  }, [allFeatures, hideDone, hideRemoved]);

  // Extract teams
  const teams = useMemo(() =>
    [...new Set(features.map(f => extractTeamFromPath(f.area)))].filter(t => t && t !== 'Unknown').sort(),
    [features]
  );

  // Build board: board[team][sprint] = features[]
  const board = useMemo(() => {
    const b = {};
    for (const f of features) {
      const team   = extractTeamFromPath(f.area);
      const sprint = extractSprint(f.iter, sprintLabels) || 'Unassigned';
      if (!b[team]) b[team] = {};
      if (!b[team][sprint]) b[team][sprint] = [];
      b[team][sprint].push(f);
    }
    return b;
  }, [features, sprintLabels]);

  // Sprint columns: known order + any from data + Unassigned last
  const sprintCols = useMemo(() => {
    const inData = new Set(features.map(f => extractSprint(f.iter, sprintLabels) || 'Unassigned'));
    const ordered = sprintLabels.filter(l => inData.has(l.toUpperCase())).map(l => l.toUpperCase());
    if (inData.has('Unassigned')) ordered.push('Unassigned');
    return ordered.length ? ordered : ['Unassigned'];
  }, [features, sprintLabels]);

  // Stats
  const total    = features.length;
  const done     = features.filter(f => f.state === 'Done').length;
  const doneRate = total > 0 ? Math.round(done / total * 100) : 0;

  const stateCount = useMemo(() => {
    const c = {};
    for (const f of features) c[f.state] = (c[f.state] || 0) + 1;
    return c;
  }, [features]);

  if (isLoading) return <PageLoader label="Loading PI Board…" />;

  const CELL_MIN = compact ? 80 : 160;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="section-header">
        <h1 className="section-title">📌 PI Board</h1>
        {pis.map(pi => <span key={pi} className="pi-tag">{pi}</span>)}
      </div>

      {error && <div style={{ color: 'var(--danger)', padding: '8px 0', fontSize: 13 }}>❌ {error.message}</div>}

      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="kpi-card" style={{ minWidth: 100, padding: '8px 14px' }}>
          <div className="kpi-label">Total</div>
          <div className="kpi-val" style={{ fontSize: 22 }}>{total}</div>
        </div>
        <div className="kpi-card green" style={{ minWidth: 100, padding: '8px 14px' }}>
          <div className="kpi-label">Done</div>
          <div className="kpi-val" style={{ fontSize: 22, color: 'var(--success)' }}>{done}</div>
        </div>
        <div className="kpi-card" style={{ minWidth: 100, padding: '8px 14px' }}>
          <div className="kpi-label">Done Rate</div>
          <div className="kpi-val" style={{ fontSize: 22, color: doneRate >= 80 ? 'var(--success)' : doneRate >= 50 ? 'var(--caution,#F5CC00)' : 'var(--danger)' }}>{doneRate}%</div>
        </div>
        {Object.entries(stateCount).map(([state, count]) => (
          <div key={state} className="kpi-card" style={{ minWidth: 80, padding: '8px 14px', borderTop: `3px solid ${stateColor(state)}` }}>
            <div className="kpi-label" style={{ color: stateColor(state) }}>{state}</div>
            <div className="kpi-val" style={{ fontSize: 18 }}>{count}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, fontSize: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} />
          Hide Done
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={hideRemoved} onChange={e => setHideRemoved(e.target.checked)} />
          Hide Removed
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={compact} onChange={e => setCompact(e.target.checked)} />
          Compact
        </label>
        <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
          {teams.length} teams · {sprintCols.length} sprints · {features.length} features
        </span>
        {allDeps.length > 0 && (
          <span style={{ color: '#F5CC00' }}>🔗 {allDeps.length} features with deps</span>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        {Object.entries(STATE_COLORS).map(([state, color]) => (
          <span key={state} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ width: 10, height: 10, background: color, borderRadius: 2, display: 'inline-block' }} />
            {state}
          </span>
        ))}
      </div>

      {/* Board grid */}
      {teams.length === 0 ? (
        <div style={{ color: 'var(--muted)', padding: 24, textAlign: 'center', fontSize: 14 }}>
          No features found for the selected PI / team.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', flex: 1 }}>
          <table style={{
            borderCollapse: 'collapse', width: '100%',
            tableLayout: 'fixed', minWidth: teams.length * 120 + sprintCols.length * CELL_MIN + 80,
          }}>
            <colgroup>
              <col style={{ width: 110 }} />
              {sprintCols.map(s => <col key={s} style={{ width: CELL_MIN }} />)}
            </colgroup>
            <thead>
              <tr>
                <th style={{
                  background: 'var(--surface2)', color: 'var(--text-muted)', fontSize: 11,
                  textAlign: 'left', padding: '7px 10px', border: '1px solid var(--border)',
                  fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>Team</th>
                {sprintCols.map(sprint => (
                  <th key={sprint} style={{
                    background: sprint === 'IP' ? '#2b2200' : sprint === 'Unassigned' ? 'var(--surface2)' : 'var(--surface2)',
                    color: sprint === 'IP' ? '#F5CC00' : sprint === 'Unassigned' ? 'var(--text-muted)' : 'var(--text)',
                    fontSize: 12, textAlign: 'center', padding: '7px 10px',
                    border: '1px solid var(--border)', fontWeight: 700,
                  }}>
                    {sprint}
                    <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginTop: 2 }}>
                      {features.filter(f => (extractSprint(f.iter, sprintLabels) || 'Unassigned').toUpperCase() === sprint.toUpperCase()).length} features
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map(team => {
                const teamFeatures = features.filter(f => extractTeamFromPath(f.area) === team);
                return (
                  <tr key={team}>
                    <td style={{
                      background: 'var(--surface2)', border: '1px solid var(--border)',
                      padding: '8px 10px', verticalAlign: 'top',
                    }}>
                      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>{team}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {teamFeatures.filter(f => f.state === 'Done').length}/{teamFeatures.length} done
                      </div>
                      {/* Team progress mini-bar */}
                      <div style={{ height: 3, background: 'var(--border)', marginTop: 4, borderRadius: 2 }}>
                        <div style={{
                          height: '100%', borderRadius: 2,
                          width: `${teamFeatures.length > 0 ? Math.round(teamFeatures.filter(f => f.state === 'Done').length / teamFeatures.length * 100) : 0}%`,
                          background: 'var(--success, #068443)',
                          transition: 'width 0.4s',
                        }} />
                      </div>
                    </td>
                    {sprintCols.map(sprint => {
                      const cellFeatures = (board[team]?.[sprint === 'Unassigned' ? 'Unassigned' : sprint] || []);
                      return (
                        <td key={sprint} style={{
                          border: '1px solid var(--border)',
                          padding: compact ? 4 : 6,
                          verticalAlign: 'top',
                          background: cellFeatures.length === 0 ? 'var(--surface, #1a1a2e)' : 'var(--surface, #1a1a2e)',
                          minHeight: 40,
                        }}>
                          {cellFeatures.map(f => (
                            <FeatureCard
                              key={f.id}
                              feature={f}
                              tfsBaseUrl={store.tfsBaseUrl}
                              deps={allDeps}
                            />
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
        💡 Click a feature card to expand details · 🔗 shows dependency count
      </div>

      {/* Dependency Network Graph */}
      {allDeps.length > 0 && (
        <DependencyGraph allDeps={allDeps} features={allFeatures} tfsBaseUrl={store.tfsBaseUrl} />
      )}
    </div>
  );
}

// ── Dependency Tree (vertical, expandable) ───────────────────────────────────
function DependencyGraph({ allDeps, features, tfsBaseUrl }) {
  // Build a complete feature lookup (deps data wins over board data)
  const featureMap = useMemo(() => {
    const m = new Map();
    features.forEach(f => m.set(String(f.id), f));
    allDeps.forEach(item => {
      m.set(String(item.id), { ...(m.get(String(item.id)) || {}), ...item });
      (item.deps || []).forEach(dep => {
        if (!m.has(String(dep.id))) m.set(String(dep.id), dep);
      });
    });
    return m;
  }, [allDeps, features]);

  // Features that have at least one dependency
  const rootItems = useMemo(() =>
    allDeps
      .filter(item => item.deps && item.deps.length > 0)
      .sort((a, b) => (a.team || '').localeCompare(b.team || '') || (a.title || '').localeCompare(b.title || '')),
    [allDeps]
  );

  // Group roots by team
  const byTeam = useMemo(() => {
    const g = new Map();
    rootItems.forEach(item => {
      const t = item.team || 'Unknown';
      if (!g.has(t)) g.set(t, []);
      g.get(t).push(item);
    });
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rootItems]);

  const allTeams  = useMemo(() => byTeam.map(([t]) => t), [byTeam]);
  const allFeatIds = useMemo(() => rootItems.map(i => String(i.id)), [rootItems]);

  const [expandedTeams, setExpandedTeams]       = useState(() => new Set(allTeams));
  const [expandedFeatures, setExpandedFeatures] = useState(() => new Set(allFeatIds));

  const toggleTeam = t => setExpandedTeams(prev => {
    const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n;
  });
  const toggleFeat = id => setExpandedFeatures(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const allExpanded = expandedFeatures.size >= allFeatIds.length;
  const toggleAll = () => setExpandedFeatures(allExpanded ? new Set() : new Set(allFeatIds));

  const getTfsUrl = id =>
    tfsBaseUrl && !String(id).startsWith('vtag-')
      ? `${tfsBaseUrl}/_workitems/edit/${id}` : null;

  const linkCount = useMemo(() => allDeps.reduce((s, i) => s + (i.deps || []).filter(d => d.depType !== 'tag').length, 0), [allDeps]);
  const tagCount  = useMemo(() => allDeps.reduce((s, i) => s + (i.deps || []).filter(d => d.depType === 'tag').length, 0), [allDeps]);

  // ── Pill helper ──
  const Pill = ({ label, color, bg, border }) => (
    <span style={{
      fontSize: 9, padding: '1px 6px', borderRadius: 10, whiteSpace: 'nowrap',
      background: bg, color, border: `1px solid ${border}`,
    }}>{label}</span>
  );

  // ── Feature row (parent node) ──
  const FeatureRow = ({ item }) => {
    const fid = String(item.id);
    const isOpen = expandedFeatures.has(fid);
    const sc = stateColor(item.state);
    const url = getTfsUrl(fid);
    const linkDeps = (item.deps || []).filter(d => d.depType !== 'tag');
    const tagDeps  = (item.deps || []).filter(d => d.depType === 'tag');
    const reqTeams = item.reqTeams || [];
    const comTeams = item.comTeams || [];

    return (
      <div style={{ marginBottom: 2 }}>
        {/* ── Header row ── */}
        <div
          onClick={() => toggleFeat(fid)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', cursor: 'pointer', borderRadius: 4,
            background: isOpen ? 'rgba(20,146,255,0.07)' : 'var(--surface2, #1e1e2e)',
            border: `1px solid ${isOpen ? '#1492ff44' : 'var(--border)'}`,
            userSelect: 'none',
          }}
        >
          <span style={{ fontSize: 9, color: '#1492ff', width: 12 }}>{isOpen ? '▼' : '▶'}</span>
          <span style={{ fontFamily: 'Consolas,monospace', fontSize: 10, fontWeight: 700, color: sc }}>
            #{fid}
          </span>
          <span style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>
            {(item.title || '').length > 55 ? item.title.slice(0, 55) + '…' : item.title}
          </span>
          {/* state */}
          <Pill label={item.state} color={sc} bg={sc + '22'} border={sc + '55'} />
          {/* dep counts */}
          {linkDeps.length > 0 && (
            <Pill label={`🔗 ${linkDeps.length}`} color="#F5CC00" bg="rgba(245,204,0,0.1)" border="#F5CC0044" />
          )}
          {tagDeps.length > 0 && (
            <Pill label={`🏷 ${tagDeps.length}`} color="#60a5fa" bg="rgba(20,146,255,0.12)" border="#1492ff44" />
          )}
          {/* REQ/COM badges */}
          {reqTeams.map(t => (
            <Pill key={`r-${t}`}
              label={`R: ${t}`}
              color={comTeams.includes(t) ? '#60a5fa' : '#ef4444'}
              bg={comTeams.includes(t) ? 'rgba(20,146,255,0.12)' : 'rgba(235,63,63,0.12)'}
              border={comTeams.includes(t) ? '#1492ff33' : '#ef444433'}
            />
          ))}
          {comTeams.filter(t => !reqTeams.includes(t)).map(t => (
            <Pill key={`c-${t}`} label={`C: ${t}`} color="#22c55e" bg="rgba(34,197,94,0.12)" border="#22c55e33" />
          ))}
          {/* TFS link */}
          {url && (
            <a href={url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              style={{ color: '#1492ff', fontSize: 12, lineHeight: 1, textDecoration: 'none' }}>↗</a>
          )}
        </div>

        {/* ── Children ── */}
        {isOpen && (
          <div style={{
            marginLeft: 24, paddingLeft: 12,
            borderLeft: '2px solid #1492ff33',
            marginTop: 2, paddingBottom: 4,
          }}>
            {(item.deps || []).map((dep, di) => {
              const dId = String(dep.id);
              const isVirtual = dId.startsWith('vtag-');
              const dNode = featureMap.get(dId) || dep;
              const dSc = stateColor(dNode.state || dep.state);
              const dUrl = getTfsUrl(dId);
              const isTag = dep.depType === 'tag';
              const cross = dep.crossTeam;

              return (
                <div key={`${fid}-${di}`} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 10px', marginTop: 2, borderRadius: 3,
                  background: cross ? 'rgba(235,63,63,0.04)' : 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border)',
                }}>
                  {/* connector symbol */}
                  <span style={{ color: '#1492ff55', fontSize: 12, flexShrink: 0 }}>└</span>

                  {/* dep type badge */}
                  {isTag
                    ? <Pill label="TAG" color="#60a5fa" bg="rgba(20,146,255,0.12)" border="#1492ff44" />
                    : <Pill label="LINK" color="#F5CC00" bg="rgba(245,204,0,0.08)" border="#F5CC0033" />
                  }
                  {cross && !isVirtual && (
                    <Pill label="⚡ cross-team" color="#ef4444" bg="rgba(235,63,63,0.1)" border="#ef444433" />
                  )}

                  {isVirtual ? (
                    <span style={{ color: '#ef4444', fontStyle: 'italic', fontSize: 11, flex: 1 }}>
                      ⚠ No COM match for REQ_{dep.unmatchedTeam || ''}
                    </span>
                  ) : (
                    <>
                      <span style={{ fontFamily: 'Consolas,monospace', fontSize: 10, fontWeight: 700, color: dSc, flexShrink: 0 }}>
                        #{dId}
                      </span>
                      <span style={{ flex: 1, fontSize: 11, color: 'var(--text)' }}>
                        {(dNode.title || dep.title || '').length > 50
                          ? (dNode.title || dep.title || '').slice(0, 50) + '…'
                          : (dNode.title || dep.title || '')}
                      </span>
                    </>
                  )}

                  {/* team + state */}
                  {(dNode.team || dep.team) && !isVirtual && (
                    <span style={{ fontSize: 9, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {dNode.team || dep.team}
                    </span>
                  )}
                  {!isVirtual && (
                    <Pill
                      label={dNode.state || dep.state || '?'}
                      color={dSc} bg={dSc + '22'} border={dSc + '44'}
                    />
                  )}

                  {/* TFS link */}
                  {dUrl && (
                    <a href={dUrl} target="_blank" rel="noreferrer"
                      style={{ color: '#1492ff', fontSize: 12, textDecoration: 'none', flexShrink: 0 }}>↗</a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginTop: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 16 }}>

      {/* ── Header bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>🌳 Dependency Tree</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {rootItems.length} features · {linkCount} link deps · {tagCount} tag deps
        </span>
        <button
          onClick={toggleAll}
          style={{
            marginLeft: 'auto', fontSize: 11, padding: '3px 12px',
            background: 'var(--surface2)', border: '1px solid var(--border)',
            color: 'var(--text)', cursor: 'pointer', borderRadius: 4,
          }}
        >
          {allExpanded ? '⊟ Collapse All' : '⊞ Expand All'}
        </button>
      </div>

      {/* ── Tree body ── */}
      <div style={{ fontSize: 12, overflowY: 'auto', maxHeight: 'calc(100vh - 380px)', minHeight: 120 }}>
        {byTeam.map(([team, items]) => {
          const teamOpen = expandedTeams.has(team);
          const crossCount = items.reduce((s, i) => s + (i.deps || []).filter(d => d.crossTeam).length, 0);
          return (
            <div key={team} style={{ marginBottom: 10 }}>
              {/* Team group header */}
              <div
                onClick={() => toggleTeam(team)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 12px', cursor: 'pointer',
                  background: 'var(--surface2, #1e1e2e)',
                  borderLeft: `3px solid #1492ff`,
                  borderRadius: '0 4px 4px 0',
                  userSelect: 'none',
                }}
              >
                <span style={{ fontSize: 10, color: '#1492ff' }}>{teamOpen ? '▼' : '▶'}</span>
                <span style={{ fontWeight: 700, color: '#1492ff', fontSize: 12 }}>{team}</span>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                  {items.length} feature{items.length !== 1 ? 's' : ''}
                </span>
                {crossCount > 0 && (
                  <span style={{ fontSize: 10, color: '#ef4444' }}>⚡ {crossCount} cross-team</span>
                )}
              </div>

              {/* Features inside team */}
              {teamOpen && (
                <div style={{ marginLeft: 16, marginTop: 4 }}>
                  {items.map(item => <FeatureRow key={item.id} item={item} />)}
                </div>
              )}
            </div>
          );
        })}

        {rootItems.length === 0 && (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 32, fontSize: 12 }}>
            No dependencies found for the selected PI
          </div>
        )}
      </div>

      {/* ── Legend ── */}
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <span style={{ color: '#F5CC00' }}>🔗 LINK = TFS link dependency</span>
        <span style={{ color: '#60a5fa' }}>🏷 TAG = REQ/COM tag dependency</span>
        <span style={{ color: '#ef4444' }}>⚡ cross-team dependency</span>
        <span style={{ color: '#60a5fa' }}>R: = requesting from team</span>
        <span style={{ color: '#22c55e' }}>C: = committed to team</span>
        <span style={{ color: '#ef4444' }}>⚠ = unmatched REQ tag</span>
      </div>
    </div>
  );
}
