import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar, Doughnut } from 'react-chartjs-2';
import useStore from '../store/useStore.js';
import { apiFetch } from '../api/apiClient.js';
import { useRisks, useAnnotations } from '../api/hooks.js';
import TableModal from '../components/ui/TableModal.jsx';
import { PageLoader } from '../components/ui/PageLoader.jsx';
import { usePolicies } from '../hooks/usePolicies.js';
import CopyButton from '../components/ui/CopyButton.jsx';
import ChartAnnotations, { AnnotationButton, buildAnnotationLines } from '../components/ui/ChartAnnotations.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { SkeletonSection } from '../components/ui/SkeletonCard.jsx';
import { DataAge } from '../hooks/useDataAge.jsx';
import { TFSItemLink } from '../components/ui/TFSLink';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend, ChartDataLabels);

const RISK_STATE_COLORS = {
  Open:       '#ef4444', Identified: '#f97316', Owned:      '#3b82f6',
  Accepted:   '#f59e0b', Mitigated:  '#10b981', Resolved:   '#068443',
  Deprecated: '#94a3b8', Rejected:   '#757575',
};
const RISK_PRIO_COLORS = {
  'P1-Critical': '#ef4444', 'P2-High': '#f97316',
  'P3-Medium':   '#f59e0b', 'P4-Low':  '#3b82f6', Unknown: '#94a3b8',
};
const PRIO_ORDER = ['P1-Critical', 'P2-High', 'P3-Medium', 'P4-Low', 'Unknown'];
const ROAM_COLS = [
  { key: 'open',      label: "Unroam'd",  color: '#ef4444' },
  { key: 'owned',     label: 'Owned',     color: '#3b82f6' },
  { key: 'accepted',  label: 'Accepted',  color: '#f59e0b' },
  { key: 'mitigated', label: 'Mitigated', color: '#10b981' },
  { key: 'resolved',  label: 'Resolved',  color: '#068443' },
];

// Shared chart option builders
const donutOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: 'right', labels: { color: '#ccc', font: { size: 11 } } }, datalabels: { display: false } },
};
const prioOpts = (annotations = [], labels = [], onDelete, chartId = '') => ({
  responsive: true, maintainAspectRatio: false,
  layout: { padding: { top: 16 } },
  plugins: {
    legend: { display: false },
    datalabels: { anchor: 'end', align: 'end', color: '#ccc', font: { size: 11 }, formatter: v => v },
    annotation: { annotations: buildAnnotationLines(annotations, labels, onDelete, chartId) },
  },
  scales: {
    x: { ticks: { color: '#aaa', font: { size: 11 } }, grid: { color: '#333' } },
    y: { ticks: { color: '#aaa' }, grid: { color: '#333' }, beginAtZero: true },
  },
});
const stackedBarOpts = (indexAxis = 'x', annotations = [], labels = [], onDelete, chartId = '') => ({
  indexAxis, responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { position: 'top', labels: { color: '#ccc', font: { size: 10 } } },
    datalabels: { display: false },
    ...(indexAxis !== 'y' ? {
      annotation: { annotations: buildAnnotationLines(annotations, labels, onDelete, chartId) },
    } : {}),
  },
  scales: {
    x: { stacked: true, ticks: { color: '#aaa', font: { size: 10 } }, grid: { color: '#333' } },
    y: { stacked: true, ticks: { color: '#aaa', font: { size: 10 } }, grid: { color: '#333' }, beginAtZero: true },
  },
});

// ROAM Board
function ROAMBoard({ items, tfsBaseUrl }) {
  const COLUMNS = [
    { key: 'unroamed', label: "Unroam'd",    color: '#eb3f3f', states: ['Open', 'Identified'],                  icon: '🚨' },
    { key: 'owned',    label: 'Owned (O)',    color: '#3b82f6', states: ['Owned'],                               icon: '👤' },
    { key: 'accepted', label: 'Accepted (A)', color: '#f59e0b', states: ['Accepted'],                            icon: '✋' },
    { key: 'mitigated',label: 'Mitigated (M)',color: '#10b981', states: ['Mitigated'],                           icon: '🛡' },
    { key: 'resolved', label: 'Resolved (R)', color: '#068443', states: ['Resolved', 'Deprecated', 'Rejected'], icon: '✅' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
      {COLUMNS.map(col => {
        const colItems = (items || []).filter(r => col.states.includes(r.state));
        return (
          <div key={col.key} style={{ background: 'var(--bg-card)', border: `1px solid ${col.color}44`, borderTop: `3px solid ${col.color}` }}>
            <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: col.color }}>{col.icon} {col.label}</span>
              <span style={{ background: `${col.color}22`, color: col.color, border: `1px solid ${col.color}44`, borderRadius: 0, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{colItems.length}</span>
            </div>
            <div style={{ padding: 8, maxHeight: 260, overflowY: 'auto' }}>
              {colItems.length === 0
                ? <div style={{ color: 'var(--muted)', fontSize: 11, padding: '8px 4px', textAlign: 'center' }}>None</div>
                : colItems.map(r => (
                  <div key={r.id} style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: '8px 10px', marginBottom: 6, fontSize: 11 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
                      <TFSItemLink id={r.id} tfsBaseUrl={tfsBaseUrl} /> {r.title}
                    </div>
                    <div style={{ color: 'var(--muted)' }}>
                      {r.rmmTeam || r.team} · {r.priority || 'No priority'}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ROAM Heatmap (reusable for byTeam or byRMM)
function ROAMHeatmap({ byMap, rowLabel = 'Team', title }) {
  const rows = Object.entries(byMap || {})
    .sort((a, b) => ((b[1].open||0)+(b[1].owned||0)+(b[1].accepted||0)) - ((a[1].open||0)+(a[1].owned||0)+(a[1].accepted||0)));
  if (!rows.length) return null;
  return (
    <div className="card mt-16">
      <div className="card-header">
        <span className="card-title">🌡 {title || 'ROAM Status Heatmap'}</span>
        <div className="card-actions"><CopyButton type="table" /></div>
      </div>
      <div data-copy-scope style={{ overflowX: 'auto' }}>
        <table className="data-table" style={{ tableLayout: 'auto', minWidth: 560 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', minWidth: 140 }}>{rowLabel}</th>
              {ROAM_COLS.map(c => (
                <th key={c.key} style={{ textAlign: 'center', color: c.color, fontWeight: 700, padding: '8px 10px' }}>{c.label}</th>
              ))}
              <th style={{ textAlign: 'center', color: 'var(--muted)' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, td]) => {
              const total = ROAM_COLS.reduce((s, c) => s + (td[c.key] || 0), 0);
              const maxVal = Math.max(...ROAM_COLS.map(c => td[c.key] || 0), 1);
              return (
                <tr key={name}>
                  <td style={{ fontSize: 12, fontWeight: 600 }}>{name}</td>
                  {ROAM_COLS.map(c => {
                    const val = td[c.key] || 0;
                    const intensity = val / maxVal;
                    return (
                      <td key={c.key} style={{ textAlign: 'center', padding: '6px 10px' }}>
                        <span style={{
                          display: 'inline-block', minWidth: 28, padding: '3px 8px', borderRadius: 3,
                          fontWeight: val > 0 ? 700 : 400,
                          background: val > 0 ? `${c.color}${Math.round(intensity * 70 + 20).toString(16).padStart(2,'0')}` : 'transparent',
                          color: val > 0 ? c.color : 'var(--muted)', fontSize: 13,
                        }}>{val}</span>
                      </td>
                    );
                  })}
                  <td style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Open items table
function OpenItemsTable({ items, tfsBaseUrl, showCategory, showRMM }) {
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');

  const sortedRows = useMemo(() => {
    const rows = [...(items || [])];
    if (!sortKey) return rows;

    rows.sort((a, b) => {
      const ageA = a.createdDate ? Math.floor((Date.now() - new Date(a.createdDate)) / 86400000) : -1;
      const ageB = b.createdDate ? Math.floor((Date.now() - new Date(b.createdDate)) / 86400000) : -1;
      const valuesA = {
        id: Number(a.id) || 0,
        title: a.title || '',
        state: a.state || '',
        priority: a.priority || '',
        category: a.category || '',
        rmmTeam: a.rmmTeam || '',
        team: a.team || '',
        age: ageA,
      };
      const valuesB = {
        id: Number(b.id) || 0,
        title: b.title || '',
        state: b.state || '',
        priority: b.priority || '',
        category: b.category || '',
        rmmTeam: b.rmmTeam || '',
        team: b.team || '',
        age: ageB,
      };

      if (sortKey === 'id' || sortKey === 'age') {
        return valuesA[sortKey] - valuesB[sortKey];
      }

      return String(valuesA[sortKey]).localeCompare(String(valuesB[sortKey]), undefined, { numeric: true, sensitivity: 'base' });
    });

    return sortDir === 'desc' ? rows.reverse() : rows;
  }, [items, sortDir, sortKey]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(dir => dir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortIndicator = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕');

  if (!items?.length) return (
    <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>No unROAM&apos;d items</div>
  );

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('id')}>ID{sortIndicator('id')}</th>
            <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('title')}>Title{sortIndicator('title')}</th>
            <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('state')}>State{sortIndicator('state')}</th>
            <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('priority')}>Priority{sortIndicator('priority')}</th>
            {showCategory && <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('category')}>Category{sortIndicator('category')}</th>}
            {showRMM && <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('rmmTeam')}>RMM Team{sortIndicator('rmmTeam')}</th>}
            <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('team')}>Team{sortIndicator('team')}</th>
            <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('age')}>Age{sortIndicator('age')}</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(r => {
            const stateColor = RISK_STATE_COLORS[r.state] || '#aaa';
            const prioColor  = RISK_PRIO_COLORS[r.priority] || '#94a3b8';
            const age = r.createdDate ? Math.floor((Date.now() - new Date(r.createdDate)) / 86400000) : '?';
            return (
              <tr key={r.id}>
                <td><TFSItemLink id={r.id} tfsBaseUrl={tfsBaseUrl} /></td>
                <td style={{ maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.title}>{r.title}</td>
                <td><span style={{ color: stateColor, fontWeight: 600 }}>{r.state}</span></td>
                <td><span style={{ color: prioColor, fontWeight: 600 }}>{r.priority}</span></td>
                {showCategory && (
                  <td>
                    <span style={{
                      fontSize: 11, borderRadius: 3, padding: '2px 6px',
                      background: r.category === 'Release' ? '#3b82f622' : r.category === 'Team' ? '#10b98122' : '#aaa2',
                      color:      r.category === 'Release' ? '#3b82f6'   : r.category === 'Team' ? '#10b981'   : '#aaa',
                    }}>{r.category || '–'}</span>
                  </td>
                )}
                {showRMM && <td style={{ fontSize: 11 }}>{r.rmmTeam || '–'}</td>}
                <td>{r.team}</td>
                <td>{age}d</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Tab button
function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '7px 18px', fontSize: 13, fontWeight: active ? 700 : 400, cursor: 'pointer',
      border: 'none', borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
      background: 'transparent', color: active ? 'var(--primary)' : 'var(--muted)',
      transition: 'all 0.15s',
    }}>
      {children}
    </button>
  );
}

// Category filter pill
function CatPill({ active, onClick, color, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '3px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 20,
      border: `1px solid ${active ? color : 'var(--border)'}`,
      background: active ? `${color}22` : 'transparent',
      color: active ? color : 'var(--muted)', fontWeight: active ? 700 : 400,
      transition: 'all 0.15s',
    }}>
      {children}
    </button>
  );
}

export default function RisksSection() {
  const selectedPIs  = useStore(s => s.selectedPIs);
  const availablePIs = useStore(s => s.availablePIs);
  const { chartVisible } = usePolicies();
  const selectedTeam = useStore(s => s.selectedTeam);
  const tfsBaseUrl   = useStore(s => s.tfsBaseUrl);

  const [activeTab,    setActiveTab]    = useState('risks');
  const [riskCategory, setRiskCategory] = useState('All');
  const [annPopup, setAnnPopup]         = useState({ open: false, sprints: [], chartId: '' });

  const pis = selectedPIs.length
    ? selectedPIs
    : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);

  const { data, isLoading, error, dataUpdatedAt } = useRisks(pis, selectedTeam);
  const activePi = selectedPIs[selectedPIs.length - 1] || '';
  const { data: annData } = useAnnotations('risks', activePi, selectedTeam);
  const annItems = annData?.items || [];
  const qc = useQueryClient();

  async function handleDeleteAnnotation(id) {
    await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['annotations', 'risks'] });
  }

  function openAnnPopup(sprints, chartId = '') {
    setAnnPopup({ open: true, sprints, chartId });
  }

  if (isLoading) return <SkeletonSection />;

  // Split items by type
  const allItems         = data?.items || [];
  const riskItems        = allItems.filter(r => r.type !== 'Product Risk');
  const productRiskItems = allItems.filter(r => r.type === 'Product Risk');

  // Apply Release/Team filter
  const filteredRisks = riskCategory === 'All'
    ? riskItems
    : riskItems.filter(r => r.category === riskCategory);

  const openRisks        = filteredRisks.filter(r => r.state === 'Open' || r.state === 'Identified');
  const openProductRisks = productRiskItems.filter(r => r.state === 'Open' || r.state === 'Identified');

  // Per-category stats
  const catData = riskCategory === 'All'
    ? null
    : (data?.byCategory?.[riskCategory] || { byState: {}, byPriority: {}, byTeam: {}, total: 0, unroamed: 0 });

  // Risks tab: state, priority, team breakdowns (filtered)
  const riskByState = catData
    ? catData.byState
    : Object.fromEntries(
        Object.entries(
          riskItems.reduce((m, r) => { m[r.state] = (m[r.state]||0)+1; return m; }, {})
        )
      );
  const riskByPriority = catData
    ? catData.byPriority
    : Object.fromEntries(
        PRIO_ORDER.map(k => [k, riskItems.filter(r => r.priority === k).length]).filter(([,v]) => v > 0)
      );
  const riskByTeam = catData
    ? catData.byTeam
    : (() => {
        const m = {};
        for (const r of riskItems) {
          if (!m[r.team]) m[r.team] = { open:0, owned:0, accepted:0, mitigated:0, resolved:0, total:0 };
          m[r.team].total++;
          if      (['Open','Identified'].includes(r.state)) m[r.team].open++;
          else if (r.state === 'Owned')     m[r.team].owned++;
          else if (r.state === 'Accepted')  m[r.team].accepted++;
          else if (r.state === 'Mitigated') m[r.team].mitigated++;
          else if (r.state === 'Resolved')  m[r.team].resolved++;
        }
        return m;
      })();

  // Risks tab charts
  const rStateEntries = Object.entries(riskByState).filter(([,v]) => v > 0);
  const rStateChart = {
    labels: rStateEntries.map(([k]) => k),
    datasets: [{ data: rStateEntries.map(([,v]) => v), backgroundColor: rStateEntries.map(([k]) => RISK_STATE_COLORS[k] || '#aaa'), borderWidth: 2, borderColor: '#1a1a2e' }],
  };
  const rPrioLabels = PRIO_ORDER.filter(k => riskByPriority[k]);
  const rPrioChart = {
    labels: rPrioLabels,
    datasets: [{ data: rPrioLabels.map(k => riskByPriority[k]), backgroundColor: rPrioLabels.map(k => RISK_PRIO_COLORS[k] || '#aaa'), borderRadius: 0 }],
  };
  const rTeamEntries = Object.entries(riskByTeam)
    .sort((a,b) => ((b[1].open||0)+(b[1].owned||0)+(b[1].accepted||0)) - ((a[1].open||0)+(a[1].owned||0)+(a[1].accepted||0)))
    .slice(0, 12);
  const rTeamNames = rTeamEntries.map(([t]) => t);
  const mkTeamDS = (key, label, color) => ({ label, backgroundColor: color, borderRadius: 0, data: rTeamNames.map(t => riskByTeam[t]?.[key] || 0) });
  const rTeamChart = {
    labels: rTeamNames,
    datasets: [
      mkTeamDS('open',      "Unroam'd",  '#ef4444'),
      mkTeamDS('owned',     'Owned',     '#3b82f6'),
      mkTeamDS('accepted',  'Accepted',  '#f59e0b'),
      mkTeamDS('mitigated', 'Mitigated', '#10b981'),
      mkTeamDS('resolved',  'Resolved',  '#068443'),
    ],
  };

  // Product Risks tab
  const byRMM = data?.byRMM || {};
  const rmmEntries = Object.entries(byRMM)
    .sort((a,b) => { if (a[0]==='Untagged') return 1; if (b[0]==='Untagged') return -1; return b[1].total - a[1].total; });
  const rmmLabels = rmmEntries.map(([g]) => g);
  const mkRmmDS = (key, label, color) => ({ label, backgroundColor: color, borderRadius: 0, data: rmmEntries.map(([,v]) => v[key]||0) });
  const rmmChart = {
    labels: rmmLabels,
    datasets: [
      mkRmmDS('open',      "Unroam'd",  '#ef4444'),
      mkRmmDS('owned',     'Owned',     '#3b82f6'),
      mkRmmDS('accepted',  'Accepted',  '#f59e0b'),
      mkRmmDS('mitigated', 'Mitigated', '#10b981'),
      mkRmmDS('resolved',  'Resolved',  '#068443'),
    ],
  };
  const byRMMTeam = Object.fromEntries(
    rmmEntries.map(([g,v]) => [g, { open: v.open||0, owned: v.owned||0, accepted: v.accepted||0, mitigated: v.mitigated||0, resolved: v.resolved||0 }])
  );

  if (!data || allItems.length === 0) {
    return (
      <EmptyState
        title="No Risks Found"
        message="No risks match the current PI and team filters."
        icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /></svg>}
      />
    );
  }

  const prTotal  = data?.byType?.['Product Risk'] || productRiskItems.length;
  const prUnroam = openProductRisks.length;

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">⚠️ Risks</h1>
        <DataAge updatedAt={dataUpdatedAt} />
        {pis.map(pi => <span key={pi} className="pi-tag">{pi}</span>)}
      </div>

      {error && <div style={{ color: 'var(--danger)', padding: 16 }}>❌ {error.message}</div>}

      {data && (
        <>
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
            <TabBtn active={activeTab === 'risks'} onClick={() => setActiveTab('risks')}>
              ⚠️ Risks <span style={{ fontSize: 11, marginLeft: 4, opacity: 0.7 }}>({data.byType?.['Risk'] ?? 0})</span>
            </TabBtn>
            <TabBtn active={activeTab === 'product-risks'} onClick={() => setActiveTab('product-risks')}>
              🛡 Product Risks <span style={{ fontSize: 11, marginLeft: 4, opacity: 0.7 }}>({prTotal})</span>
            </TabBtn>
          </div>

          {/* TAB 1: RISKS */}
          {activeTab === 'risks' && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', marginRight: 4 }}>Filter:</span>
                <CatPill active={riskCategory === 'All'}     color="var(--primary)" onClick={() => setRiskCategory('All')}>All</CatPill>
                <CatPill active={riskCategory === 'Release'} color="#3b82f6"        onClick={() => setRiskCategory('Release')}>🚀 Release</CatPill>
                <CatPill active={riskCategory === 'Team'}    color="#10b981"        onClick={() => setRiskCategory('Team')}>👥 Team</CatPill>
                <CatPill active={riskCategory === 'Unknown'} color="#94a3b8"        onClick={() => setRiskCategory('Unknown')}>❓ Unknown</CatPill>
              </div>

              <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 12 }}>ROAM: Resolved · Owned · Accepted · Mitigated</p>

              <div className="kpi-strip">
                <div className="kpi-card blue">
                  <div className="kpi-val">{filteredRisks.length}</div><div className="kpi-lbl">Total</div>
                </div>
                <div className="kpi-card orange">
                  <div className="kpi-val">{filteredRisks.filter(r => ['Open','Identified','Owned','Accepted'].includes(r.state)).length}</div>
                  <div className="kpi-lbl">Active</div>
                </div>
                <div className={`kpi-card ${openRisks.length === 0 ? 'rag-green' : openRisks.length <= 5 ? 'rag-amber' : 'rag-red'}`}>
                  <div className="kpi-val">{openRisks.length}</div><div className="kpi-lbl">Unroam&apos;d</div>
                </div>
                <div className="kpi-card blue">
                  <div className="kpi-val">{data.byCategory?.Release?.total ?? 0}</div><div className="kpi-lbl">Release Risks</div>
                </div>
                <div className="kpi-card muted">
                  <div className="kpi-val">{data.byCategory?.Team?.total ?? 0}</div><div className="kpi-lbl">Team Risks</div>
                </div>
              </div>

              {chartVisible('risks', 'roam-board') && <ROAMBoard items={filteredRisks} tfsBaseUrl={tfsBaseUrl} />}

              <div className="charts-grid-2 mt-16">
                {rStateEntries.length > 0 && chartVisible('risks', 'by-state') && (
                  <div className="card">
                    <div className="card-header"><span className="card-title">Risks by State</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(rStateChart.labels || [], 'risks-state')} /><CopyButton type="chart" /></div></div>
                    <div className="chart-wrap chart-wrap-donut" style={{ height: 240 }}>
                      <Doughnut data={rStateChart} options={donutOpts} />
                    </div>
                  </div>
                )}
                {rPrioLabels.length > 0 && chartVisible('risks', 'by-priority') && (
                  <div className="card">
                    <div className="card-header"><span className="card-title">Risks by Priority</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(rPrioLabels, 'risks-priority')} /><CopyButton type="chart" /></div></div>
                    <div className="chart-wrap" style={{ height: 240 }}>
                      <Bar data={rPrioChart} options={prioOpts(annItems, rPrioLabels, handleDeleteAnnotation, 'risks-priority')} />
                    </div>
                  </div>
                )}
              </div>

              {rTeamNames.length > 0 && chartVisible('risks', 'by-team') && (
                <div className="card mt-16">
                  <div className="card-header"><span className="card-title">Risks by Team (Top 12)</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(rTeamNames, 'risks-team')} /><CopyButton type="chart" /></div></div>
                  <div className="chart-wrap" style={{ height: 280 }}>
                    <Bar data={rTeamChart} options={stackedBarOpts('x', annItems, rTeamNames, handleDeleteAnnotation, 'risks-team')} />
                  </div>
                </div>
              )}

              {chartVisible('risks', 'roam-heatmap') && (
                <ROAMHeatmap byMap={riskByTeam} title="ROAM Status Heatmap by Team" rowLabel="Team" />
              )}

              {chartVisible('risks', 'open-risks') && openRisks.length > 0 && (
                <div className="card mt-16">
                  <div className="card-header">
                    <span className="card-title">Open / Unroam&apos;d Risks</span>
                    <div className="card-actions">
                      <TableModal label="Open Risks" title="Open / Unroam'd Risks" badge={openRisks.length}>
                        <OpenItemsTable items={openRisks} tfsBaseUrl={tfsBaseUrl} showCategory />
                      </TableModal>
                    </div>
                  </div>
                  <OpenItemsTable items={openRisks.slice(0,10)} tfsBaseUrl={tfsBaseUrl} showCategory />
                  {openRisks.length > 10 && <p style={{ fontSize:11, color:'var(--muted)', padding:'4px 12px 8px' }}>Showing 10 of {openRisks.length} — open modal for full list.</p>}
                </div>
              )}
            </>
          )}

          {/* TAB 2: PRODUCT RISKS */}
          {activeTab === 'product-risks' && (
            <>
              <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 12 }}>
                Product Risks tracked per team · team identified by <code style={{ fontSize: 11 }}>RMM</code> tag suffix (e.g. <em>CAVA RMM</em>)
              </p>

              <div className="kpi-strip">
                <div className="kpi-card blue">
                  <div className="kpi-val">{prTotal}</div><div className="kpi-lbl">Total</div>
                </div>
                <div className="kpi-card orange">
                  <div className="kpi-val">{productRiskItems.filter(r => ['Open','Identified','Owned','Accepted'].includes(r.state)).length}</div>
                  <div className="kpi-lbl">Active</div>
                </div>
                <div className={`kpi-card ${prUnroam === 0 ? 'rag-green' : prUnroam <= 5 ? 'rag-amber' : 'rag-red'}`}>
                  <div className="kpi-val">{prUnroam}</div><div className="kpi-lbl">Unroam&apos;d</div>
                </div>
                <div className="kpi-card muted">
                  <div className="kpi-val">{rmmEntries.filter(([g]) => g !== 'Untagged').length}</div>
                  <div className="kpi-lbl">RMM Teams</div>
                </div>
              </div>

              {chartVisible('risks', 'roam-board') && <ROAMBoard items={productRiskItems} tfsBaseUrl={tfsBaseUrl} />}

              {rmmLabels.length > 0 && (
                <div className="card mt-16">
                  <div className="card-header"><span className="card-title">Product Risks by RMM Team</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(rmmLabels, 'risks-rmm')} /><CopyButton type="chart" /></div></div>
                  <div className="chart-wrap" style={{ height: Math.max(240, rmmLabels.length * 36 + 60), padding: '8px 8px 0' }}>
                    <Bar data={rmmChart} options={stackedBarOpts('y', annItems, rmmLabels, handleDeleteAnnotation, 'risks-rmm')} />
                  </div>
                </div>
              )}

              <ROAMHeatmap byMap={byRMMTeam} title="ROAM Heatmap by RMM Team" rowLabel="RMM Team" />

              {rmmEntries.length > 0 && (
                <div className="card mt-16">
                  <div className="card-header">
                    <span className="card-title">Product Risk RMM Summary</span>
                    <div className="card-actions">
                      <TableModal label="Full RMM Table" title="Product Risk RMM Summary" badge={rmmEntries.length}>
                        <div className="table-wrap">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>RMM Team</th><th>Total</th><th>Unroam&apos;d</th>
                                <th>Owned</th><th>Accepted</th><th>Mitigated</th><th>Resolved</th><th>Distribution</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rmmEntries.map(([grp, v]) => {
                                const segs = [
                                  { val: v.open,      color: '#ef4444' },
                                  { val: v.owned,     color: '#3b82f6' },
                                  { val: v.accepted,  color: '#f59e0b' },
                                  { val: v.mitigated, color: '#10b981' },
                                  { val: v.resolved,  color: '#068443' },
                                ].filter(s => s.val > 0);
                                return (
                                  <tr key={grp}>
                                    <td style={{ fontWeight: 600 }}>{grp}</td>
                                    <td style={{ textAlign: 'center' }}>{v.total}</td>
                                    <td style={{ textAlign: 'center', color: '#ef4444', fontWeight: v.open ? 600 : 400 }}>{v.open}</td>
                                    <td style={{ textAlign: 'center', color: '#3b82f6' }}>{v.owned}</td>
                                    <td style={{ textAlign: 'center', color: '#f59e0b' }}>{v.accepted}</td>
                                    <td style={{ textAlign: 'center', color: '#10b981' }}>{v.mitigated}</td>
                                    <td style={{ textAlign: 'center', color: '#068443' }}>{v.resolved}</td>
                                    <td>
                                      <div style={{ display: 'flex', gap: 2, height: 10, overflow: 'hidden', minWidth: 80 }}>
                                        {segs.map(s => <div key={s.color} style={{ flex: s.val, background: s.color }} />)}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </TableModal>
                    </div>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>RMM Team</th><th>Total</th><th>Unroam&apos;d</th>
                          <th>Owned</th><th>Resolved+Mitigated</th><th>Distribution</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rmmEntries.slice(0, 8).map(([grp, v]) => {
                          const segs = [
                            { val: v.open,      color: '#ef4444' },
                            { val: v.owned,     color: '#3b82f6' },
                            { val: v.accepted,  color: '#f59e0b' },
                            { val: v.mitigated, color: '#10b981' },
                            { val: v.resolved,  color: '#068443' },
                          ].filter(s => s.val > 0);
                          return (
                            <tr key={grp}>
                              <td style={{ fontWeight: 600 }}>{grp}</td>
                              <td style={{ textAlign: 'center' }}>{v.total}</td>
                              <td style={{ textAlign: 'center', color: '#ef4444', fontWeight: v.open ? 600 : 400 }}>{v.open}</td>
                              <td style={{ textAlign: 'center', color: '#3b82f6' }}>{v.owned}</td>
                              <td style={{ textAlign: 'center', color: '#068443' }}>{(v.resolved||0)+(v.mitigated||0)}</td>
                              <td>
                                <div style={{ display: 'flex', gap: 2, height: 10, overflow: 'hidden', minWidth: 80 }}>
                                  {segs.map(s => <div key={s.color} style={{ flex: s.val, background: s.color }} />)}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {rmmEntries.length > 8 && (
                    <p style={{ fontSize: 11, color: 'var(--muted)', padding: '4px 12px 8px' }}>Showing 8 of {rmmEntries.length} teams — open modal for full list.</p>
                  )}
                </div>
              )}

              {openProductRisks.length > 0 && (
                <div className="card mt-16">
                  <div className="card-header">
                    <span className="card-title">Open / Unroam&apos;d Product Risks</span>
                    <div className="card-actions">
                      <TableModal label="Open Product Risks" title="Open / Unroam'd Product Risks" badge={openProductRisks.length}>
                        <OpenItemsTable items={openProductRisks} tfsBaseUrl={tfsBaseUrl} showRMM />
                      </TableModal>
                    </div>
                  </div>
                  <OpenItemsTable items={openProductRisks.slice(0,10)} tfsBaseUrl={tfsBaseUrl} showRMM />
                  {openProductRisks.length > 10 && (
                    <p style={{ fontSize: 11, color: 'var(--muted)', padding: '4px 12px 8px' }}>Showing 10 of {openProductRisks.length} — open modal for full list.</p>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
      <ChartAnnotations
        section="risks"
        chartId={annPopup.chartId || ''}
        pi={activePi}
        team={selectedTeam}
        sprints={annPopup.sprints}
        open={annPopup.open}
        setOpen={open => setAnnPopup(v => ({ ...v, open }))}
        items={annItems}
        onDelete={handleDeleteAnnotation}
      />
    </div>
  );
}
