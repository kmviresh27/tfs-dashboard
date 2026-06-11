import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar } from 'react-chartjs-2';
import useStore from '../store/useStore.js';
import { apiFetch } from '../api/apiClient.js';
import { useAnnotations } from '../api/hooks.js';
import CopyButton from '../components/ui/CopyButton.jsx';
import ChartAnnotations, { AnnotationButton, buildAnnotationLines } from '../components/ui/ChartAnnotations.jsx';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ChartDataLabels);

const CHANGE_LABELS = {
  ADDED:              { label: 'Added',          color: 'var(--success)',  bg: 'var(--success-bg)',  bdr: 'var(--success-bdr)'  },
  MOVED_IN:           { label: 'Moved In',        color: 'var(--primary-light)', bg: 'var(--violet-bg)', bdr: 'var(--violet-bdr)' },
  REMOVED:            { label: 'Removed',         color: 'var(--danger)',   bg: 'var(--danger-bg)',   bdr: 'var(--danger-bdr)'   },
  ESTIMATE_INCREASED: { label: 'Estimate UP',     color: 'var(--warning)',  bg: 'var(--warning-bg)',  bdr: 'var(--warning-bdr)'  },
  ESTIMATE_DECREASED: { label: 'Estimate DOWN',   color: 'var(--violet)',   bg: 'var(--violet-bg)',   bdr: 'var(--violet-bdr)'   },
  SPRINT_CHANGED:     { label: 'Sprint Moved',    color: 'var(--violet)',   bg: 'var(--violet-bg)',   bdr: 'var(--violet-bdr)'   },
  TEAM_CHANGED:       { label: 'Team Changed',    color: 'var(--teal)',     bg: 'var(--teal-bg)',     bdr: 'var(--teal-bdr)'     },
};

const RAG_STYLE = {
  Green: { color: 'var(--success)', bg: 'var(--success-bg)', bdr: 'var(--success-bdr)' },
  Amber: { color: 'var(--caution)', bg: 'var(--caution-bg)', bdr: 'var(--caution-bdr)' },
  Red:   { color: 'var(--danger)',  bg: 'var(--danger-bg)',  bdr: 'var(--danger-bdr)'  },
};

function sign(n) { return n > 0 ? '+' + n : String(n); }

function RagBadge({ status }) {
  const s = RAG_STYLE[status] || {};
  return (
    <span style={{ background: s.bg, color: s.color, border: '1px solid ' + s.bdr,
      borderRadius: 0, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>{status || '-'}</span>
  );
}

function ChgBadge({ changeType }) {
  const c = CHANGE_LABELS[changeType] || { label: changeType, color: 'var(--muted)', bg: 'var(--bg-card2)', bdr: 'var(--border)' };
  return (
    <span style={{ background: c.bg, color: c.color, border: '1px solid ' + c.bdr,
      borderRadius: 0, padding: '1px 8px', fontSize: 11, fontWeight: 600 }}>{c.label}</span>
  );
}

function ScopePointsChart({ baselinePoints, currentPoints, addedPoints, removedPoints, annItems = [], onDeleteAnn }) {
  const data = {
    labels: ['Baseline', 'Current', 'Added', 'Removed'],
    datasets: [{
      data: [baselinePoints, currentPoints, addedPoints, removedPoints],
      backgroundColor: ['rgba(173,173,173,0.55)', 'rgba(20,146,255,0.65)', 'rgba(6,132,67,0.65)', 'rgba(235,63,63,0.65)'],
      borderColor:     ['#adadad',               '#1492ff',               '#068443',             '#eb3f3f'],
      borderWidth: 1,
      borderRadius: 2,
    }],
  };
  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      datalabels: {
        anchor: 'end', align: 'end',
        color: '#e8e8e8', font: { weight: 700, size: 13 },
        formatter: v => v,
      },
      annotation: {
        annotations: buildAnnotationLines(annItems, data.labels, onDeleteAnn, 'scope-baseline'),
      },
      tooltip: { callbacks: { label: ctx => ' ' + ctx.parsed.y + ' pts' } },
    },
    scales: {
      x: { ticks: { color: '#adadad', font: { size: 11 } }, grid: { display: false } },
      y: {
        beginAtZero: true,
        ticks: { color: '#adadad', precision: 0 },
        grid: { color: '#3a3a3a' },
        title: { display: true, text: 'Story Points', color: '#adadad', font: { size: 11 } },
      },
    },
  };
  return (
    <div style={{ height: 220 }}>
      <Bar data={data} options={opts} />
    </div>
  );
}

function ChangeBreakdownChart({ summary: s }) {
  const rows = [
    { label: 'Added / Moved-In',  val: s.addedCount,           color: '#068443' },
    { label: 'Removed',            val: s.removedCount,         color: '#eb3f3f' },
    { label: 'Estimate Changed',   val: s.estimateChangedCount, color: '#fa7000' },
    { label: 'Sprint Moved',       val: s.sprintMovedCount,     color: '#858fff' },
    { label: 'Team Changed',       val: s.teamChangedCount,     color: '#21837c' },
  ];
  const data = {
    labels: rows.map(r => r.label),
    datasets: [{
      data: rows.map(r => r.val),
      backgroundColor: rows.map(r => r.color + 'bb'),
      borderColor:     rows.map(r => r.color),
      borderWidth: 1,
      borderRadius: 2,
    }],
  };
  const opts = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      datalabels: {
        anchor: 'end', align: 'end',
        color: '#e8e8e8', font: { weight: 700, size: 12 },
        formatter: v => v || '',
      },
      tooltip: { callbacks: { label: ctx => ' ' + ctx.parsed.x + ' items' } },
    },
    scales: {
      x: {
        beginAtZero: true,
        ticks: { color: '#adadad', precision: 0 },
        grid: { color: '#3a3a3a' },
        title: { display: true, text: 'Count', color: '#adadad', font: { size: 11 } },
      },
      y: { ticks: { color: '#adadad', font: { size: 11 } }, grid: { display: false } },
    },
  };
  return (
    <div style={{ height: 220 }}>
      <Bar data={data} options={opts} />
    </div>
  );
}

const TABS = [
  { id: 'all',      label: 'All Changes'     },
  { id: 'added',    label: 'Added'           },
  { id: 'removed',  label: 'Removed'         },
  { id: 'estimate', label: 'Estimate Change' },
  { id: 'sprint',   label: 'Sprint Move'     },
  { id: 'team',     label: 'Team Change'     },
];

export default function ScopeChangeSection() {
  const tfsBaseUrl          = useStore(s => s.tfsBaseUrl);
  const activeSnapshotId    = useStore(s => s.activeSnapshotId);
  const activeSnapshotLabel = useStore(s => s.activeSnapshotLabel);
  const selectedPIs         = useStore(s => s.selectedPIs);
  const selectedTeam        = useStore(s => s.selectedTeam);

  const [comparing,     setComparing]     = useState(false);
  const [compareResult, setCompareResult] = useState(null);
  const [compareError,  setCompareError]  = useState(null);
  const [activeTab,     setActiveTab]     = useState('all');
  const [typeFilter,    setTypeFilter]    = useState('');
  const [annPopup, setAnnPopup]           = useState({ open: false, sprints: [], chartId: '' });
  const activePi = selectedPIs[selectedPIs.length - 1] || '';
  const { data: annData } = useAnnotations('scope-change', activePi, selectedTeam);
  const annItems = annData?.items || [];
  const qc = useQueryClient();

  async function handleDeleteAnnotation(id) {
    await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['annotations', 'scope-change'] });
  }

  function openAnnPopup(sprints, chartId = '') {
    setAnnPopup({ open: true, sprints, chartId });
  }

  const runCompare = useCallback(async (snapshotId, team) => {
    setComparing(true);
    setCompareError(null);
    setCompareResult(null);
    setActiveTab('all');
    try {
      const qs = `snapshotId=${snapshotId}${team ? '&teamPath=' + encodeURIComponent(team) : ''}`;
      const data = await apiFetch('/api/scope-change/compare?' + qs);
      setCompareResult(data);
    } catch (e) {
      setCompareError(e.message || 'Comparison failed');
    } finally {
      setComparing(false);
    }
  }, []);

  // Auto-run compare when activeSnapshotId or selectedTeam changes
  useEffect(() => {
    if (activeSnapshotId) runCompare(activeSnapshotId, selectedTeam);
    else { setCompareResult(null); setCompareError(null); }
  }, [activeSnapshotId, selectedTeam, runCompare]);

  const allChanges = compareResult ? [
    ...compareResult.changes.added,
    ...compareResult.changes.removed,
    ...compareResult.changes.estimateChanged,
    ...compareResult.changes.sprintMoved,
    ...compareResult.changes.teamChanged,
  ] : [];

  const tabItems = {
    all:      allChanges,
    added:    compareResult?.changes.added           || [],
    removed:  compareResult?.changes.removed         || [],
    estimate: compareResult?.changes.estimateChanged || [],
    sprint:   compareResult?.changes.sprintMoved     || [],
    team:     compareResult?.changes.teamChanged     || [],
  };

  const displayItems = typeFilter
    ? (tabItems[activeTab] || []).filter(i => i.type === typeFilter)
    : (tabItems[activeTab] || []);

  const allTypes = [...new Set(allChanges.map(i => i.type))].sort();
  const s = compareResult?.summary;

  const ragStyle = s ? (RAG_STYLE[s.riskStatus] || {}) : {};

  return (
    <div>

      {/* Section header */}
      <div className="section-header">
        <span className="section-title">Scope Change Tracking</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {activeSnapshotId
            ? <>Baseline: <strong style={{ color: 'var(--primary-light)' }}>{activeSnapshotLabel || activeSnapshotId}</strong> · compared against current PI scope in TFS</>
            : 'No snapshot selected — pick one from the Config panel'}
        </span>
      </div>


      {!activeSnapshotId && (
        <div style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-bdr)',
          padding: '14px 18px', color: 'var(--warning)', fontSize: 13, marginBottom: 16 }}>
          ⚠ No snapshot selected. Open the <strong>Config panel</strong> (top-right) and select a baseline snapshot.
        </div>
      )}

      {comparing && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
          Fetching current PI scope from TFS and comparing...
        </div>
      )}

      {compareError && (
        <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-bdr)',
          padding: '12px 16px', color: 'var(--danger)', marginBottom: 16, fontSize: 13 }}>
          {compareError}
        </div>
      )}

      {compareResult && s && (
        <>
          {/* Baseline banner */}
          <div style={{ background: 'var(--violet-bg)', border: '1px solid var(--violet-bdr)',
            padding: '8px 14px', marginBottom: 16, fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>Baseline: <strong style={{ color: 'var(--text)' }}>{s.snapshotLabel}</strong></span>
            <span>Captured: <strong style={{ color: 'var(--text)' }}>{new Date(s.baselineDate).toLocaleString()}</strong></span>
            <span>PI: <strong style={{ color: 'var(--primary-light)' }}>{(s.piLabels || []).join(', ')}</strong></span>
            {s.teamFilter && (
              <span style={{ marginLeft: 'auto', background: 'var(--teal-bg)', border: '1px solid var(--teal-bdr)',
                color: 'var(--teal)', padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>
                🏷 {s.teamFilter.split('\\').pop()}
              </span>
            )}
          </div>

          {/* KPI strip */}
          <div className="kpi-strip" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
            <div className="kpi-card">
              <div className="kpi-val" style={{ fontSize: 22 }}>{s.baselinePoints}</div>
              <div className="kpi-lbl">Baseline Pts</div>
              <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 2 }}>{s.baselineItemCount} items</div>
            </div>
            <div className="kpi-card blue">
              <div className="kpi-val" style={{ fontSize: 22 }}>{s.currentPoints}</div>
              <div className="kpi-lbl">Current Pts</div>
              <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 2 }}>{s.currentItemCount} items</div>
            </div>
            <div className={'kpi-card ' + (s.netGrowthPct > 15 ? 'red' : s.netGrowthPct > 5 ? 'orange' : 'green')}>
              <div className="kpi-val" style={{ fontSize: 22 }}>{sign(s.netGrowthPct)}%</div>
              <div className="kpi-lbl">Net Growth</div>
              <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 2 }}>{sign(s.currentPoints - s.baselinePoints)} pts</div>
            </div>
            <div className={'kpi-card ' + (s.churnPct > 25 ? 'red' : 'orange')}>
              <div className="kpi-val" style={{ fontSize: 22 }}>{s.churnPct}%</div>
              <div className="kpi-lbl">Scope Churn</div>
            </div>
            <div className="kpi-card green">
              <div className="kpi-val" style={{ fontSize: 22 }}>{'+' + s.addedPoints}</div>
              <div className="kpi-lbl">Added Pts</div>
              <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 2 }}>{s.addedCount} items</div>
            </div>
            <div className="kpi-card red">
              <div className="kpi-val" style={{ fontSize: 22 }}>{'-' + s.removedPoints}</div>
              <div className="kpi-lbl">Removed Pts</div>
              <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 2 }}>{s.removedCount} items</div>
            </div>
            <div className="kpi-card" style={{ background: ragStyle.bg, borderColor: ragStyle.bdr }}>
              <div className="kpi-val" style={{ fontSize: 20, color: ragStyle.color }}>{s.riskStatus}</div>
              <div className="kpi-lbl">Risk</div>
            </div>
          </div>

          {/* Charts row */}
          <div className="charts-grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-header">
                <span className="card-title">Scope Points Comparison</span>
                <span className="card-sub">Baseline vs current vs changes</span>
                <div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(['Baseline', 'Current', 'Added', 'Removed'], 'scope-baseline')} /><CopyButton type="chart" /></div>
              </div>
              <div style={{ padding: '12px 16px 16px' }}>
                <ScopePointsChart
                  baselinePoints={s.baselinePoints} currentPoints={s.currentPoints}
                  addedPoints={s.addedPoints} removedPoints={s.removedPoints}
                  annItems={annItems} onDeleteAnn={handleDeleteAnnotation} />
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <span className="card-title">Change Breakdown</span>
                <span className="card-sub">Count by change type</span>
                <div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(['Added / Moved-In', 'Removed', 'Estimate Changed', 'Sprint Moved', 'Team Changed'], 'scope-changes')} /><CopyButton type="chart" /></div>
              </div>
              <div style={{ padding: '12px 16px 16px' }}>
                <ChangeBreakdownChart summary={s} />
              </div>
            </div>
          </div>

          {/* Change detail table with tabs */}
          <div className="card">
            <div className="card-header" style={{ padding: '0 0 0 0', borderBottom: 'none', gap: 0 }}>
              <div style={{ display: 'flex', overflowX: 'auto', width: '100%', borderBottom: '1px solid var(--border-sub)' }}>
                {TABS.map(t => {
                  const count  = tabItems[t.id]?.length ?? 0;
                  const active = activeTab === t.id;
                  return (
                    <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                      padding: '11px 16px', fontSize: 12, fontWeight: active ? 700 : 500,
                      color: active ? 'var(--primary-light)' : 'var(--muted)',
                      borderBottom: active ? '2px solid var(--primary)' : '2px solid transparent',
                      background: 'none', border: 'none',
                      cursor: 'pointer', whiteSpace: 'nowrap', transition: 'color .15s' }}>
                      {t.label + ' '}
                      <span style={{ fontSize: 10, background: active ? 'var(--violet-bg)' : 'var(--bg-card2)',
                        color: active ? 'var(--primary-light)' : 'var(--muted2)',
                        padding: '1px 5px', borderRadius: 0 }}>{count}</span>
                    </button>
                  );
                })}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', padding: '0 12px' }}>
                  <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                    style={{ background: 'var(--bg-card2)', color: 'var(--muted)', border: '1px solid var(--border)',
                      padding: '4px 8px', fontSize: 11, borderRadius: 0 }}>
                    <option value="">All Types</option>
                    {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {displayItems.length === 0 ? (
              <div style={{ padding: '28px 16px', color: 'var(--muted)', textAlign: 'center', fontSize: 13 }}>
                No items in this category.
              </div>
            ) : (
              <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                <table className="data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                  <colgroup>
                    <col style={{ width: 110 }} />
                    <col style={{ width: 70 }} />
                    <col style={{ width: 'auto' }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 64 }} />
                    <col style={{ width: 130 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#222' }}>Type</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#222' }}>ID</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#222' }}>Title</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#222' }}>Change</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#222' }}>When</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#222' }}>Changed By</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#222' }}>Details</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#222', textAlign: 'right' }}>Points</th>
                      <th style={{ position: 'sticky', top: 0, zIndex: 2, background: '#222' }}>Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayItems.map((item, idx) => {
                      const pts = item.effort || item.storyPoints || 0;
                      let detail = '';
                      if (item.changeType === 'ESTIMATE_INCREASED' || item.changeType === 'ESTIMATE_DECREASED')
                        detail = item.baselinePoints + ' to ' + item.currentPoints + ' (' + sign(item.delta) + ' pts)';
                      else if (item.changeType === 'SPRINT_CHANGED')
                        detail = (item.baselineSprint || '?') + ' to ' + (item.currentSprint || '?');
                      else if (item.changeType === 'TEAM_CHANGED')
                        detail = ((item.baselineTeam || '').split('\\').pop()) + ' to ' + ((item.currentTeam || '').split('\\').pop());
                      return (
                        <tr key={item.id + '-' + idx}>
                          <td style={{ color: 'var(--muted2)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.type}</td>
                          <td className="id-cell">
                            {tfsBaseUrl
                              ? <a href={tfsBaseUrl + '/_workitems/edit/' + item.id} target="_blank" rel="noreferrer"
                                  style={{ color: 'var(--primary-light)', textDecoration: 'none' }}>{'#' + item.id}</a>
                              : '#' + item.id}
                          </td>
                          <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.title}>{item.title}</td>
                          <td><ChgBadge changeType={item.changeType} /></td>
                          <td style={{ fontSize: 11, color: 'var(--muted2)', whiteSpace: 'nowrap' }}>
                            {item.changedDate
                              ? new Date(item.changedDate).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
                              : '-'}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.changedBy || '-'}</td>
                          <td style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail || '-'}</td>
                          <td style={{ textAlign: 'right', color: pts ? 'var(--text)' : 'var(--border)', fontWeight: pts ? 600 : 400 }}>{pts || '-'}</td>
                          <td style={{ fontSize: 12, color: 'var(--muted2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.assignedTo || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
      <ChartAnnotations
        section="scope-change"
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