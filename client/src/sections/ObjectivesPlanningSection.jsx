import { useState } from 'react';
import useStore from '../store/useStore.js';
import { useObjectivesPlan } from '../api/hooks.js';

const RAG_COLOR = {
  Green:   { bg: 'rgba(34,197,94,.15)',  border: 'rgba(34,197,94,.5)',  text: '#22c55e' },
  Amber:   { bg: 'rgba(245,158,11,.15)', border: 'rgba(245,158,11,.5)', text: '#f59e0b' },
  Red:     { bg: 'rgba(239,68,68,.15)',  border: 'rgba(239,68,68,.5)',  text: '#ef4444' },
  Done:    { bg: 'rgba(6,132,67,.15)',   border: 'rgba(6,132,67,.5)',   text: '#4ade80' },
  Dropped: { bg: 'rgba(120,120,120,.1)', border: 'rgba(120,120,120,.3)', text: '#888' },
};

const STATE_COLORS = {
  Done: 'var(--success, #068443)',
  Approved: 'var(--primary, #1492ff)',
  Active: 'var(--caution, #f59e0b)',
  New: 'var(--muted, #888)',
  Removed: 'var(--danger, #eb3f3f)',
};

const FEATURE_STATE_COLORS = {
  Done: 'var(--success, #068443)',
  Active: 'var(--primary, #1492ff)',
  'In Progress': 'var(--primary, #1492ff)',
  Resolved: 'var(--caution, #f59e0b)',
  New: 'var(--muted, #888)',
  Closed: 'var(--muted, #888)',
};

function StateBadge({ state }) {
  const color = STATE_COLORS[state] || 'var(--muted)';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 0,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
      background: color + '22', color, border: `1px solid ${color}55`,
    }}>{state}</span>
  );
}

function FeatureRow({ feature, tfsBaseUrl }) {
  const stateColor = FEATURE_STATE_COLORS[feature.state] || 'var(--muted)';
  const { reqTeams = [], comTeams = [], hasDeviation = false } = feature;

  return (
    <div style={{
      padding: '7px 10px', borderBottom: '1px solid var(--border)',
      background: hasDeviation ? 'rgba(239,68,68,0.05)' : 'var(--bg-card)',
    }}>
      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {tfsBaseUrl ? (
          <a href={`${tfsBaseUrl}/_workitems/edit/${feature.id}`} target="_blank" rel="noreferrer"
            style={{ fontFamily: 'Consolas,monospace', fontSize: 11, color: 'var(--primary-light)', textDecoration: 'none', flexShrink: 0 }}>
            #{feature.id}
          </a>
        ) : (
          <span style={{ fontFamily: 'Consolas,monospace', fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>#{feature.id}</span>
        )}
        <span style={{ flex: 1, fontSize: 12, color: 'var(--text)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={feature.title}>
          {feature.title}
        </span>
        {feature.team && (
          <span style={{ fontSize: 10, color: 'var(--muted)', background: 'var(--bg-sidebar)', padding: '1px 6px', borderRadius: 0, flexShrink: 0 }}>
            {feature.team}
          </span>
        )}
        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 0, background: stateColor + '22', color: stateColor, fontWeight: 700, flexShrink: 0 }}>
          {feature.state}
        </span>
        {feature.effort != null && (
          <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{feature.effort} pts</span>
        )}
        {hasDeviation && (
          <span title={`Tag deviation: REQ=[${reqTeams.join(', ')}] COM=[${comTeams.join(', ')}]`}
            style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, flexShrink: 0 }}>⚠️</span>
        )}
      </div>

      {/* REQ / COM team tags */}
      {(reqTeams.length > 0 || comTeams.length > 0) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5, paddingLeft: 2 }}>
          {reqTeams.map(t => {
            const missing = !comTeams.includes(t);
            return (
              <span key={`req-${t}`} title={missing ? `COM_${t} tag missing!` : `Requested by ${t}`}
                style={{
                  fontSize: 10, padding: '1px 7px', borderRadius: 0, fontWeight: 600,
                  background: missing ? 'rgba(239,68,68,0.15)' : 'rgba(20,146,255,0.12)',
                  color: missing ? '#ef4444' : 'var(--primary-light)',
                  border: `1px solid ${missing ? '#ef444455' : 'rgba(20,146,255,0.3)'}`,
                }}>
                REQ {t}{missing ? ' ⚠' : ''}
              </span>
            );
          })}
          {comTeams.map(t => {
            const missing = !reqTeams.includes(t);
            return (
              <span key={`com-${t}`} title={missing ? `REQ_${t} tag missing!` : `Committed by ${t}`}
                style={{
                  fontSize: 10, padding: '1px 7px', borderRadius: 0, fontWeight: 600,
                  background: missing ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.12)',
                  color: missing ? '#ef4444' : '#22c55e',
                  border: `1px solid ${missing ? '#ef444455' : 'rgba(34,197,94,0.3)'}`,
                }}>
                COM {t}{missing ? ' ⚠' : ''}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ pct, ragStatus }) {
  const c = RAG_COLOR[ragStatus] || RAG_COLOR.Amber;
  return (
    <div style={{ margin: '6px 12px 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>Progress</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: c.text }}>{pct}%</span>
      </div>
      <div style={{ height: 5, background: 'var(--border)', borderRadius: 0, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${Math.min(pct, 100)}%`,
          background: c.text, borderRadius: 0, transition: 'width .4s ease',
        }} />
      </div>
    </div>
  );
}

function RagBadge({ status }) {
  const c = RAG_COLOR[status] || RAG_COLOR.Amber;
  const icon = status === 'Done' ? '✓' : status === 'Red' ? '●' : status === 'Green' ? '●' : status === 'Dropped' ? '⊘' : '●';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 0, flexShrink: 0,
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
    }}>{icon} {status}</span>
  );
}

function ObjectiveCard({ obj, tfsBaseUrl, forceExpanded }) {
  const [expanded, setExpanded] = useState(true);
  const isStretch = obj.type === 'stretch';

  // forceExpanded=true → expand all, forceExpanded=false → collapse all, undefined → local state
  const isOpen = forceExpanded !== undefined ? forceExpanded : expanded;

  const accentColor = isStretch ? '#f97316' : '#22c55e';
  const bgColor = isStretch ? 'rgba(249,115,22,0.08)' : 'rgba(34,197,94,0.08)';
  const borderColor = isStretch ? 'rgba(249,115,22,0.35)' : 'rgba(34,197,94,0.35)';
  const typeLabel = isStretch ? 'Stretch' : 'Committed';

  return (
    <div style={{
      border: `1px solid ${borderColor}`,
      borderLeft: `4px solid ${accentColor}`,
      borderRadius: 0,
      background: bgColor,
      marginBottom: 10,
      overflow: 'hidden',
    }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}
      >
        <span style={{ color: 'var(--muted)', fontSize: 13, flexShrink: 0 }}>{isOpen ? '▾' : '▸'}</span>

        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 0, flexShrink: 0,
          background: accentColor + '33', color: accentColor,
        }}>{typeLabel}</span>

        {tfsBaseUrl ? (
          <a href={`${tfsBaseUrl}/_workitems/edit/${obj.id}`} target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ fontFamily: 'Consolas,monospace', fontSize: 11, color: 'var(--primary-light)', textDecoration: 'none', flexShrink: 0 }}>
            #{obj.id}
          </a>
        ) : (
          <span style={{ fontFamily: 'Consolas,monospace', fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>#{obj.id}</span>
        )}

        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={obj.title}>
          {obj.title}
        </span>

        <RagBadge status={obj.ragStatus || 'Amber'} />

        {obj.businessValue != null && (
          <span style={{ fontSize: 11, color: 'var(--primary-light)', fontWeight: 700, flexShrink: 0 }}>BV {obj.businessValue}</span>
        )}

        {obj.features.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{obj.featuresDone}/{obj.featuresTotal} feat</span>
        )}
      </div>

      {/* Progress bar */}
      {obj.featuresTotal > 0 && (() => {
        const total   = obj.featuresTotal;
        const donePct = (obj.featuresDone / total) * 100;
        const wipPct  = (obj.featuresInProgress / total) * 100;
        const remPct  = Math.max(0, 100 - donePct - wipPct);
        const rag     = RAG_COLOR[obj.ragStatus] || RAG_COLOR.Amber;
        return (
          <div style={{ margin: '4px 12px 0' }}>
            <div style={{ display: 'flex', height: 8, background: 'var(--bg-card2)', overflow: 'hidden', border: '1px solid var(--border)' }}>
              {donePct > 0 && <div style={{ width: `${donePct}%`, background: '#22c55e', flexShrink: 0 }} title={`Done: ${obj.featuresDone}`} />}
              {wipPct  > 0 && <div style={{ width: `${wipPct}%`,  background: '#60a5fa', flexShrink: 0 }} title={`In Progress: ${obj.featuresInProgress}`} />}
              {remPct  > 0 && <div style={{ width: `${remPct}%`,  background: 'rgba(120,120,120,.3)', flexShrink: 0 }} title={`Not Started: ${obj.featuresNotStarted}`} />}
            </div>
          </div>
        );
      })()}

      {/* Feature metrics row */}
      {obj.featuresTotal > 0 && (
        <div style={{ display: 'flex', gap: 10, padding: '2px 12px 8px', fontSize: 10, color: 'var(--muted)' }}>
          <span style={{ color: '#4ade80' }}>✓ {obj.featuresDone} Done</span>
          <span style={{ color: '#60a5fa' }}>◑ {obj.featuresInProgress} In Progress</span>
          <span style={{ color: 'var(--muted)' }}>○ {obj.featuresNotStarted} Not Started</span>
          {obj.totalEffort > 0 && (
            <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
              {obj.doneEffort}/{obj.totalEffort} pts
              {obj.progressMode === 'effort' ? '' : ' (count-based)'}
            </span>
          )}
        </div>
      )}

      {obj.linkedTeams.length > 0 && (
        <div style={{ padding: '2px 12px 6px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--muted)', alignSelf: 'center' }}>Teams:</span>
          {obj.linkedTeams.map(team => (
            <span key={team} style={{
              fontSize: 10, padding: '2px 7px', borderRadius: 0,
              background: 'var(--bg-sidebar)', border: '1px solid var(--border)',
              color: 'var(--text)',
            }}>{team}</span>
          ))}
        </div>
      )}

      {isOpen && obj.features.length > 0 && (
        <div style={{ borderTop: `1px solid ${borderColor}` }}>
          {obj.features.map(feature => (
            <FeatureRow key={feature.id} feature={feature} tfsBaseUrl={tfsBaseUrl} />
          ))}
        </div>
      )}

      {isOpen && obj.features.length === 0 && (
        <div style={{ padding: '8px 12px', color: 'var(--muted)', fontSize: 12, borderTop: `1px solid ${borderColor}` }}>
          No features linked to this objective.
        </div>
      )}
    </div>
  );
}

export default function ObjectivesPlanningSection() {
  const selectedPIs         = useStore(s => s.selectedPIs);
  const availablePIs        = useStore(s => s.availablePIs);
  const tfsBaseUrl          = useStore(s => s.tfsBaseUrl);
  const selectedTeam        = useStore(s => s.selectedTeam);
  const activeSnapshotId    = useStore(s => s.activeSnapshotId);
  const activeSnapshotLabel = useStore(s => s.activeSnapshotLabel);

  const [filterType,  setFilterType]  = useState('all');
  const [searchText,  setSearchText]  = useState('');
  const [allExpanded, setAllExpanded] = useState(undefined);
  const [sortBy,      setSortBy]      = useState('tfs');
  const [activeTab,   setActiveTab]   = useState('overview');

  const pis = selectedPIs.length
    ? selectedPIs
    : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);

  const { data, isLoading, error } = useObjectivesPlan(pis, selectedTeam || undefined, activeSnapshotId || undefined);

  const byTeam          = data?.byTeam          || {};
  const summary         = data?.summary         || {};
  const postponedImpact = data?.postponedImpact || { total: 0, droppedCount: 0, impactedCount: 0, bvAtRisk: 0, byTeam: {}, objectives: [], hasSnapshot: false, snapshotLabel: null };
  const teams   = Object.keys(byTeam).sort();
  const allObjs = data?.objectives || [];

  const RAG_ORDER = { Red: 0, Amber: 1, Green: 2, Done: 3, Dropped: 4 };

  function sortObjectives(objectives) {
    const arr = [...objectives];
    if (sortBy === 'tfs')           return arr.sort((a, b) => (a.stackRank ?? 999999) - (b.stackRank ?? 999999));
    if (sortBy === 'rag')           return arr.sort((a, b) => (RAG_ORDER[a.ragStatus] ?? 9) - (RAG_ORDER[b.ragStatus] ?? 9));
    if (sortBy === 'bv')            return arr.sort((a, b) => (b.businessValue ?? 0) - (a.businessValue ?? 0));
    if (sortBy === 'progress-asc')  return arr.sort((a, b) => (a.progressPct ?? 0) - (b.progressPct ?? 0));
    if (sortBy === 'progress-desc') return arr.sort((a, b) => (b.progressPct ?? 0) - (a.progressPct ?? 0));
    if (sortBy === 'title')         return arr.sort((a, b) => a.title.localeCompare(b.title));
    return arr;
  }

  function getFiltered(objectives) {
    return objectives.filter(obj => {
      if (filterType !== 'all' && obj.type !== filterType) return false;
      if (searchText) {
        // Strip leading # so users can search by "#12345" or "12345"
        const q = searchText.replace(/^#/, '').toLowerCase();
        return String(obj.id) === q ||
               obj.title.toLowerCase().includes(q) ||
               obj.features.some(f =>
                 f.title?.toLowerCase().includes(q) || String(f.id) === q
               );
      }
      return true;
    });
  }

  // ── Derived metrics ──────────────────────────────────────────────────────────
  const totalCommitted = allObjs.filter(o => o.type === 'committed').length;
  const totalStretch   = allObjs.filter(o => o.type === 'stretch').length;
  const ragCounts      = summary.ragCounts || {};
  const overallPct     = summary.overallProgress ?? 0;

  const total        = postponedImpact.total        || 0;
  const droppedCount = postponedImpact.droppedCount || 0;
  const impacted     = postponedImpact.impactedCount || 0;
  const bvAtRisk     = postponedImpact.bvAtRisk     || 0;
  const hasSnapshot  = postponedImpact.hasSnapshot  || false;
  const snapLabel    = postponedImpact.snapshotLabel || null;
  const riskCount    = droppedCount + impacted;

  const piLabel   = pis.length === 1 ? pis[0] : pis.length > 1 ? `${pis[0]} – ${pis[pis.length - 1]}` : '—';
  const teamLabel = selectedTeam ? selectedTeam.split('\\').pop() : 'All teams';
  const progColor = overallPct >= 70 ? '#22c55e' : overallPct >= 40 ? '#f59e0b' : '#ef4444';

  // ImpactCard — inline to close over tfsBaseUrl
  function ImpactCard({ obj }) {
    const isDropped       = obj.reason === 'dropped';
    const accentColor     = isDropped ? '#ef4444' : '#f59e0b';
    const removedFeatures = (obj.linkedFeatures || []).filter(f => f.isRemoved);
    const activeFeatures  = (obj.linkedFeatures || []).filter(f => !f.isRemoved);
    return (
      <div style={{
        border: `1px solid ${isDropped ? 'rgba(239,68,68,.25)' : 'rgba(245,158,11,.25)'}`,
        background: isDropped ? 'rgba(239,68,68,.04)' : 'rgba(245,158,11,.04)',
        padding: '10px 14px', marginBottom: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', whiteSpace: 'nowrap',
            background: accentColor + '22', color: accentColor, border: `1px solid ${accentColor}55`,
          }}>{isDropped ? `🚫 ${obj.state}` : '✂ Features Cut'}</span>
          {tfsBaseUrl ? (
            <a href={`${tfsBaseUrl}/_workitems/edit/${obj.id}`} target="_blank" rel="noopener noreferrer"
              style={{ fontFamily: 'Consolas,monospace', fontSize: 11, color: 'var(--primary-light)', textDecoration: 'none', flexShrink: 0 }}>
              #{obj.id}
            </a>
          ) : (
            <span style={{ fontFamily: 'Consolas,monospace', fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>#{obj.id}</span>
          )}
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flex: 1 }}>{obj.title}</span>
          {obj.businessValue > 0 && (
            <span style={{ fontSize: 12, color: accentColor, fontWeight: 700, flexShrink: 0 }}>BV: {obj.businessValue}</span>
          )}
        </div>
        {removedFeatures.length > 0 && (
          <div style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>
              ✂ {removedFeatures.length} removed feature{removedFeatures.length !== 1 ? 's' : ''}:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
              {removedFeatures.map(f => (
                <span key={f.id} style={{ fontSize: 10, padding: '2px 7px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#ef4444' }}>
                  #{f.id} {f.title}
                </span>
              ))}
            </div>
          </div>
        )}
        {activeFeatures.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
            {activeFeatures.map(f => (
              <span key={f.id} style={{ fontSize: 10, padding: '2px 7px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
                #{f.id} {f.title} ({f.state})
              </span>
            ))}
          </div>
        )}
        {obj.iter && (
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 5 }}>
            📅 {obj.iter.split('\\').pop()} · 👥 {obj.team || 'Unassigned'}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="section-inner objectives-plan-section" style={{ padding: 0 }}>

      {/* ── Sticky header ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
        padding: '12px 16px 0',
      }}>
        {/* Title row + health pills */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>🎯 PI Objectives</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{piLabel} · {teamLabel}</div>
          </div>
          {data && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: progColor }}>{overallPct}%</span>
              {(ragCounts.Red ?? 0) > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', color: '#ef4444', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)' }}>
                  🔴 {ragCounts.Red} Off Track
                </span>
              )}
              {(ragCounts.Amber ?? 0) > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', color: '#f59e0b', background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.3)' }}>
                  🟡 {ragCounts.Amber} At Risk
                </span>
              )}
              {riskCount > 0 && (
                <span onClick={() => setActiveTab('risks')}
                  style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', cursor: 'pointer', color: '#ef4444', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)' }}>
                  ⚠ {riskCount} Scope Change{riskCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex' }}>
          {[
            { id: 'overview',   label: '📊 Overview' },
            { id: 'objectives', label: `🎯 Objectives (${allObjs.length})` },
            { id: 'risks',      label: `⚠ Risks${riskCount > 0 ? ` (${riskCount})` : ''}`, alert: riskCount > 0 },
          ].map(tab => (
            <div key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 600, userSelect: 'none',
              color: activeTab === tab.id
                ? (tab.alert ? '#ef4444' : 'var(--primary-light)')
                : (tab.alert ? '#ef4444' : 'var(--muted)'),
              borderBottom: activeTab === tab.id
                ? `2px solid ${tab.alert ? '#ef4444' : 'var(--primary-light)'}`
                : '2px solid transparent',
              transition: 'color .15s',
            }}>{tab.label}</div>
          ))}
        </div>
      </div>

      {/* Loading / Error */}
      {isLoading && (
        <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>Loading objectives…</div>
      )}
      {error && (
        <div style={{ color: 'var(--danger)', padding: 20, textAlign: 'center' }}>
          No objectives found for the selected PIs.
        </div>
      )}

      {/* ══════════════════════════ OVERVIEW TAB ══════════════════════════ */}
      {!isLoading && activeTab === 'overview' && (
        <div style={{ padding: 16 }}>

          {/* Health banner */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            {/* Progress card */}
            <div style={{ flex: '1 1 220px', border: '1px solid var(--border)', background: 'var(--bg-sidebar)', padding: '16px 20px' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>Programme Progress</div>
              <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1, marginBottom: 8, color: progColor }}>{overallPct}%</div>
              <div style={{ height: 8, background: 'var(--bg)', border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ height: '100%', width: `${overallPct}%`, background: progColor }} />
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, flexWrap: 'wrap' }}>
                {(ragCounts.Done  ?? 0) > 0 && <span style={{ color: '#4ade80' }}>✓ {ragCounts.Done} Done</span>}
                {(ragCounts.Green ?? 0) > 0 && <span style={{ color: '#22c55e' }}>🟢 {ragCounts.Green} On Track</span>}
                {(ragCounts.Amber ?? 0) > 0 && <span style={{ color: '#f59e0b' }}>🟡 {ragCounts.Amber} At Risk</span>}
                {(ragCounts.Red   ?? 0) > 0 && <span style={{ color: '#ef4444' }}>🔴 {ragCounts.Red} Off Track</span>}
              </div>
            </div>

            {/* KPI cards */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flex: '1 1 auto' }}>
              {[
                { val: totalCommitted,                  color: '#22c55e',              name: 'Committed',    sub: 'objectives',        tip: 'Must-deliver objectives agreed at PI planning' },
                { val: totalStretch,                    color: '#f97316',              name: 'Stretch',      sub: 'objectives',        tip: 'Best-effort if capacity allows' },
                { val: summary.totalBvPlanned  ?? '—',  color: 'var(--primary-light)', name: 'BV Planned',   sub: 'business value',    tip: 'Total business value points planned for this PI' },
                { val: summary.totalBvWeighted ?? '—',  color: '#60a5fa',              name: 'BV Weighted',  sub: 'progress-adjusted', tip: 'Business value weighted by delivery progress' },
              ].map(k => (
                <div key={k.name} style={{ flex: '1 1 90px', border: '1px solid var(--border)', background: 'var(--bg-sidebar)', padding: '12px 16px' }}>
                  <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: k.color }}>{k.val}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginTop: 4 }}>{k.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{k.sub}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 4 }}>{k.tip}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Team matrix */}
          <div style={{ border: '1px solid var(--border)' }}>
            <div style={{ padding: '9px 14px', background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Team Progress</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>— click a row to drill into that team's objectives</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border)' }}>
                  {['Team', 'Committed', 'Stretch', 'Progress', 'Done', 'BV', 'Status'].map(h => (
                    <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teams.map((team, i) => {
                  const objs   = byTeam[team] || [];
                  const active = objs.filter(o => o.ragStatus !== 'Dropped');
                  const comm   = objs.filter(o => o.type === 'committed').length;
                  const str    = objs.filter(o => o.type === 'stretch').length;
                  const done   = objs.filter(o => o.ragStatus === 'Done').length;
                  const pct    = active.length > 0
                    ? Math.round(active.reduce((s, o) => s + (o.progressPct || 0), 0) / active.length) : 0;
                  const bv     = objs.reduce((s, o) => s + (o.businessValue || 0), 0);
                  const ragC   = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
                  const ragT   = pct >= 70 ? '🟢 On Track' : pct >= 40 ? '🟡 At Risk' : '🔴 Off Track';
                  return (
                    <tr key={team} onClick={() => setActiveTab('objectives')}
                      style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg-card)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'var(--bg)' : 'var(--bg-card)'}
                    >
                      <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700 }}>👥 {team}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: '#22c55e' }}>{comm}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: str ? '#f97316' : 'var(--muted)' }}>{str || '—'}</td>
                      <td style={{ padding: '9px 12px', minWidth: 130 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: 'var(--bg-sidebar)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: ragC }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: ragC, minWidth: 30 }}>{pct}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: '#22c55e', fontWeight: 700 }}>{done}/{active.length}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--primary-light)' }}>{bv || '—'}</td>
                      <td style={{ padding: '9px 12px', fontSize: 11, fontWeight: 600, color: ragC }}>{ragT}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════ OBJECTIVES TAB ══════════════════════════ */}
      {!isLoading && activeTab === 'objectives' && (
        <div style={{ padding: 16 }}>
          {/* Controls */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <input value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder="Search by #ID, title or feature…"
              style={{ flex: '1 1 200px', minWidth: 180, maxWidth: 320, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', fontSize: 13 }}
            />
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', fontSize: 13, cursor: 'pointer' }}>
              <option value="all">All Types</option>
              <option value="committed">✓ Committed</option>
              <option value="stretch">⤴ Stretch</option>
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 10px', fontSize: 13, cursor: 'pointer' }}>
              <option value="tfs">TFS Priority Order</option>
              <option value="rag">Risk First (🔴→🟢)</option>
              <option value="bv">Business Value ↓</option>
              <option value="progress-asc">Progress ↑ (lagging first)</option>
              <option value="progress-desc">Progress ↓ (nearly done)</option>
              <option value="title">Title A–Z</option>
            </select>
            <button onClick={() => setAllExpanded(v => v === false ? true : false)}
              style={{ marginLeft: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}>
              {allExpanded === false ? '▸▸ Expand All' : '▾▾ Collapse All'}
            </button>
          </div>

          {teams.map(team => {
            const filtered      = sortObjectives(getFiltered(byTeam[team] || []));
            if (!filtered.length) return null;
            const teamCommitted = filtered.filter(o => o.type === 'committed').length;
            const teamStretch   = filtered.filter(o => o.type === 'stretch').length;
            const teamDone      = filtered.filter(o => o.ragStatus === 'Done').length;
            const teamActive    = filtered.filter(o => o.ragStatus !== 'Dropped').length;
            const avgProgress   = teamActive > 0
              ? Math.round(filtered.filter(o => o.ragStatus !== 'Dropped').reduce((s, o) => s + (o.progressPct || 0), 0) / teamActive)
              : 0;
            const teamRed       = filtered.some(o => o.ragStatus === 'Red');
            const progC         = avgProgress >= 70 ? '#22c55e' : avgProgress >= 40 ? '#f59e0b' : '#ef4444';
            return (
              <div key={team} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>👥 {team}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)', background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '1px 7px' }}>{filtered.length} objectives</span>
                  {teamCommitted > 0 && <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 600 }}>✓ {teamCommitted} committed</span>}
                  {teamStretch   > 0 && <span style={{ fontSize: 10, color: '#f97316' }}>⤴ {teamStretch} stretch</span>}
                  {teamRed && <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700 }}>🔴 Needs Attention</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: progC }}>
                    {avgProgress}% · {teamDone}/{teamActive} done
                  </span>
                </div>
                <div style={{ border: '1px solid var(--border)', borderTop: 0, padding: 8, background: 'var(--bg)' }}>
                  {filtered.map(obj => (
                    <ObjectiveCard key={obj.id} obj={obj} tfsBaseUrl={tfsBaseUrl} forceExpanded={allExpanded} />
                  ))}
                </div>
              </div>
            );
          })}
          {teams.length === 0 && (
            <div style={{ color: 'var(--muted)', padding: 40, textAlign: 'center' }}>No objectives found.</div>
          )}
        </div>
      )}

      {/* ══════════════════════════ RISKS TAB ══════════════════════════ */}
      {!isLoading && activeTab === 'risks' && (() => {
        const dropped     = (postponedImpact.objectives || []).filter(o => o.reason === 'dropped');
        const withRemoved = (postponedImpact.objectives || []).filter(o => o.reason === 'features-removed');

        if (!hasSnapshot) {
          return (
            <div style={{ padding: 40, textAlign: 'center', border: '1px solid var(--border)', background: 'var(--bg-card)', margin: 16 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📷</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No PI Planning Snapshot Selected</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 420, margin: '0 auto', lineHeight: 1.7 }}>
                To see scope changes, select a <strong style={{ color: 'var(--text)' }}>PI Planning snapshot</strong> using the{' '}
                <strong style={{ color: 'var(--text)' }}>⚙ Config</strong> panel, then choose a snapshot from the{' '}
                <em>Active Snapshot</em> dropdown. This view will compare current TFS data against that baseline.
              </div>
            </div>
          );
        }

        return (
          <div style={{ padding: 16 }}>
            {/* Snapshot info bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'var(--bg-sidebar)', border: '1px solid var(--border)', marginBottom: 16, flexWrap: 'wrap', fontSize: 12 }}>
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>📷 Comparing against baseline:</span>
              <span style={{ color: 'var(--primary-light)', fontWeight: 700 }}>{snapLabel}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>Changes since PI Planning snapshot</span>
            </div>

            {total === 0 ? (
              <div style={{ padding: '32px 24px', textAlign: 'center', background: 'rgba(34,197,94,.05)', border: '1px solid rgba(34,197,94,.2)' }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#22c55e' }}>No Scope Changes</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>All objectives and features match the PI Planning baseline.</div>
              </div>
            ) : (
              <>
                {/* Summary cards */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
                  <div style={{ padding: '12px 18px', border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.07)' }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#ef4444', lineHeight: 1 }}>{droppedCount}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>🚫 Objectives Removed</div>
                  </div>
                  <div style={{ padding: '12px 18px', border: '1px solid rgba(245,158,11,.3)', background: 'rgba(245,158,11,.07)' }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#f59e0b', lineHeight: 1 }}>{impacted}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>✂ Scope Cuts</div>
                  </div>
                  {bvAtRisk > 0 && (
                    <div style={{ padding: '12px 18px', border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.04)' }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: '#ef4444', lineHeight: 1 }}>{bvAtRisk}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Business Value at Risk</div>
                    </div>
                  )}
                  {Object.entries(postponedImpact.byTeam || {}).map(([team, td]) => (
                    <div key={team} style={{ padding: '12px 18px', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>👥 {team}</div>
                      <div style={{ fontSize: 11, color: td.bvAtRisk > 0 ? '#ef4444' : 'var(--muted)', marginTop: 4 }}>
                        {td.count} impacted{td.bvAtRisk > 0 ? ` · BV: ${td.bvAtRisk}` : ''}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Removed objectives */}
                {dropped.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', letterSpacing: 0.5, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                      🚫 OBJECTIVES REMOVED FROM PLAN
                      <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— in the snapshot but no longer in scope</span>
                    </div>
                    {dropped.map(obj => <ImpactCard key={obj.id} obj={obj} />)}
                  </div>
                )}

                {/* Scope cuts */}
                {withRemoved.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', letterSpacing: 0.5, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                      ✂ SCOPE CUTS — FEATURES REMOVED FROM OBJECTIVES
                      <span style={{ fontWeight: 400, color: 'var(--muted)' }}>— objectives remain active but planned features were cut</span>
                    </div>
                    {withRemoved.map(obj => <ImpactCard key={obj.id} obj={obj} />)}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

    </div>
  );
}
