import { useState, useMemo } from 'react';
import useStore from '../store/useStore.js';
import { useBlockers } from '../api/hooks.js';
import { PageLoader } from '../components/ui/PageLoader.jsx';
import { DataAge } from '../hooks/useDataAge.jsx';
import { TFSItemLink } from '../components/ui/TFSLink';

const TYPE_COLORS = { Feature: '#1492ff', Story: '#a855f7', Bug: '#ef4444' };

function AgeBadge({ days }) {
  const color = days >= 7 ? '#ef4444' : days >= 3 ? '#f59e0b' : '#068443';
  const label = days === null ? '?' : days === 0 ? 'Today' : `${days}d`;
  return (
    <span style={{
      fontSize: 9, padding: '1px 7px', borderRadius: 10, fontWeight: 700,
      background: `${color}22`, color, border: `1px solid ${color}44`,
    }}>{label}</span>
  );
}

function BlockerCard({ item, tfsBaseUrl }) {
  const sc = TYPE_COLORS[item.type] || '#94a3b8';
  return (
    <div style={{
      background: 'var(--surface)', border: `1px solid var(--border)`,
      borderLeft: `3px solid ${item.daysSinceChanged >= 7 ? '#ef4444' : item.daysSinceChanged >= 3 ? '#f59e0b' : '#1492ff'}`,
      padding: '10px 12px', marginBottom: 8, borderRadius: '0 4px 4px 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <TFSItemLink id={item.id} tfsBaseUrl={tfsBaseUrl} />
        <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{item.title}</span>
        <AgeBadge days={item.daysSinceChanged} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, background: `${sc}22`, color: sc, border: `1px solid ${sc}44` }}>{item.type}</span>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{item.state}</span>
        {item.assignedTo && <span style={{ fontSize: 10, color: 'var(--muted)' }}>👤 {item.assignedTo}</span>}
        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, background: item.source === 'tag' ? '#f59e0b22' : '#1492ff22', color: item.source === 'tag' ? '#f59e0b' : '#1492ff', border: `1px solid ${item.source === 'tag' ? '#f59e0b44' : '#1492ff44'}` }}>
          {item.source === 'tag' ? '🏷 tag' : '🔗 link'}
        </span>
        {item.iterPath && <span style={{ fontSize: 9, color: 'var(--muted)' }}>📅 {item.iterPath.split('\\').pop()}</span>}
      </div>
      {item.blockedByIds?.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 10, color: '#ef4444' }}>
          🔒 Blocked by: {item.blockedByIds.map(bid => (
            <a key={bid} href={tfsBaseUrl ? `${tfsBaseUrl}/_workitems/edit/${bid}` : '#'} target="_blank" rel="noreferrer"
              style={{ color: '#ef4444', marginRight: 4 }}>#{bid}</a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BlockerBoardSection() {
  const selectedPIs  = useStore(s => s.selectedPIs);
  const currentPI    = useStore(s => s.currentPI);
  const selectedTeam = useStore(s => s.selectedTeam);
  const tfsBaseUrl   = useStore(s => s.tfsBaseUrl);

  const pis  = selectedPIs.length ? selectedPIs : (currentPI ? [currentPI] : []);
  const team = selectedTeam || '';

  const { data, isLoading, error, refetch, dataUpdatedAt } = useBlockers(pis, team);
  const items = data?.items || [];

  const [filterTeam, setFilterTeam] = useState('all');

  const teams = useMemo(() => [...new Set(items.map(i => i.team).filter(Boolean))].sort(), [items]);

  const filtered = useMemo(() =>
    filterTeam === 'all' ? items : items.filter(i => i.team === filterTeam),
    [items, filterTeam]
  );

  const byTeam = useMemo(() => {
    const g = {};
    filtered.forEach(i => {
      const t = i.team || 'Unknown';
      if (!g[t]) g[t] = [];
      g[t].push(i);
    });
    return Object.entries(g).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const stats = useMemo(() => ({
    total:   items.length,
    critical: items.filter(i => (i.daysSinceChanged || 0) >= 7).length,
    avgAge:  items.length
      ? Math.round(items.reduce((s, i) => s + (i.daysSinceChanged || 0), 0) / items.length)
      : 0,
    oldest:  items.reduce((max, i) => Math.max(max, i.daysSinceChanged || 0), 0),
  }), [items]);

  if (isLoading) return <PageLoader />;

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 18 }}>🚧 Blocker Board</span>
        <DataAge updatedAt={dataUpdatedAt} />
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          Items tagged 'blocked' or with dependency links · sorted by age
        </span>
        <button onClick={() => refetch()} style={{ marginLeft: 'auto', padding: '5px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', borderRadius: 4, fontSize: 11 }}>↻ Refresh</button>
      </div>

      {error && <div style={{ padding: '10px 14px', background: '#ef444420', border: '1px solid #ef444444', color: '#ef4444', marginBottom: 16, fontSize: 12 }}>⚠ {error.message}</div>}

      {/* ── Stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Total Blockers',  value: stats.total,    color: '#ef4444' },
          { label: '🔴 Critical (7d+)',value: stats.critical, color: '#dc2626' },
          { label: 'Avg Age (days)',   value: stats.avgAge,   color: '#f59e0b' },
          { label: 'Oldest (days)',    value: stats.oldest,   color: '#94a3b8' },
        ].map(s => (
          <div key={s.label} style={{
            background: 'var(--surface2)', border: `1px solid ${s.color}33`,
            borderTop: `3px solid ${s.color}`, padding: '12px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Team filter ── */}
      {teams.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {['all', ...teams].map(t => (
            <button key={t} onClick={() => setFilterTeam(t)} style={{
              padding: '3px 10px', fontSize: 11, borderRadius: 10,
              border: '1px solid var(--border)',
              background: filterTeam === t ? '#1492ff' : 'var(--surface2)',
              color: filterTeam === t ? '#fff' : 'var(--text)',
              cursor: 'pointer',
            }}>{t === 'all' ? `All Teams (${items.length})` : `${t} (${items.filter(i => i.team === t).length})`}</button>
          ))}
        </div>
      )}

      {/* ── Board ── */}
      {byTeam.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          🎉 No blockers found for the current PI / team selection.
          <div style={{ fontSize: 11, marginTop: 8 }}>Blockers are detected from items tagged "blocked" or with TFS dependency links.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {byTeam.map(([team, teamItems]) => (
            <div key={team} style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div style={{
                padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
              }}>
                <span style={{ fontWeight: 700, color: '#1492ff', fontSize: 12 }}>👥 {team}</span>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                  {teamItems.length} blocker{teamItems.length !== 1 ? 's' : ''}
                  {teamItems.some(i => (i.daysSinceChanged || 0) >= 7) && <span style={{ color: '#ef4444', marginLeft: 6 }}>⚠ critical</span>}
                </span>
              </div>
              <div style={{ padding: 10 }}>
                {teamItems.map(item => <BlockerCard key={item.id} item={item} tfsBaseUrl={tfsBaseUrl} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Legend ── */}
      <div style={{ marginTop: 16, fontSize: 10, color: 'var(--muted)', display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <span style={{ color: '#068443' }}>◼ &lt;3d — recent</span>
        <span style={{ color: '#f59e0b' }}>◼ 3-6d — attention needed</span>
        <span style={{ color: '#ef4444' }}>◼ 7d+ — critical</span>
        <span>🏷 tag = "blocked" tag on item</span>
        <span>🔗 link = TFS dependency link</span>
      </div>
    </div>
  );
}
