import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  PointElement, LineElement, Filler, Title, Tooltip, Legend
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar, Line, Chart } from 'react-chartjs-2';
import useStore from '../store/useStore.js';
import { useQueryClient } from '@tanstack/react-query';
import { useSprintTrend, useStoryMetrics, useSprintBurndown, useAnnotations } from '../api/hooks.js';
import { apiFetch } from '../api/apiClient.js';
import { getRAG, ragClass } from '../utils.js';
import { getTeamAreaPath, buildTFSQueryUrl } from '../tfsLinks.js';
import TableModal from '../components/ui/TableModal.jsx';
import { PageLoader } from '../components/ui/PageLoader.jsx';
import CopyButton from '../components/ui/CopyButton.jsx';
import ChartAnnotations, { AnnotationButton, buildAnnotationLines } from '../components/ui/ChartAnnotations.jsx';
import DownloadCSVButton from '../components/ui/DownloadCSVButton.jsx';import { usePolicies } from '../hooks/usePolicies.js';
import { TFSLink } from '../components/ui/TFSLink';

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  PointElement, LineElement, Filler, Title, Tooltip, Legend, ChartDataLabels
);

const DARK_LINE_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#ADADAD', boxWidth: 10 } },
    datalabels: { display: false },
  },
  scales: {
    x: { ticks: { color: '#ADADAD' }, grid: { display: false } },
    y: { ticks: { color: '#ADADAD' }, grid: { color: '#454545' }, beginAtZero: true, max: 100 },
  },
};

const TAB_STYLE_BASE = {
  padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  background: 'var(--bg-card)', color: 'var(--muted)', marginRight: 8,
};
const TAB_STYLE_ACTIVE = { ...TAB_STYLE_BASE, background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' };

export default function SprintSection() {
  const store         = useStore(s => s);
  const selectedPIs   = store.selectedPIs;
  const { tabVisible, chartVisible } = usePolicies();
  const availablePIs  = store.availablePIs;
  const selectedTeam  = store.selectedTeam;
  const currentPI     = store.currentPI;
  const ragThresholds = store.ragThresholds;
  const tfsBaseUrl    = store.tfsBaseUrl;
  const iterationPath = store.iterationPath;

  const pi  = selectedPIs[0] || currentPI || '';
  const pis = selectedPIs.length
    ? selectedPIs
    : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);

  // Extract team name from selectedTeam (strip ROOT: prefix, take last segment)
  const rawSel   = selectedTeam || '';
  const areaPath = rawSel.startsWith('ROOT:') ? rawSel.slice(5) : rawSel;
  const teamName = areaPath ? areaPath.split('\\').pop() : '';

  const [subTab, setSubTab]     = useState('overview');
  const [capData, setCapData]   = useState(null);
  const [capLoading, setCapLoading] = useState(false);
  const [capError, setCapError] = useState(null);
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [annPopup, setAnnPopup] = useState({ open: false, sprints: [], chartId: '' });

  const { data: trendData, isLoading: trendLoading, error: trendError } = useSprintTrend(pi, selectedTeam);
  const { data: burnData,  isLoading: burnLoading,  error: burnError  } = useSprintBurndown(pi, selectedTeam);
  const { data: smData,    isLoading: smLoading,    error: smError    } = useStoryMetrics(pis, selectedTeam);
  const { data: annData } = useAnnotations('sprint', pi, selectedTeam);
  const annItems = annData?.items || [];
  const qc = useQueryClient();

  async function handleDeleteAnnotation(id) {
    await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['annotations', 'sprint'] });
  }

  function openAnnPopup(sprints, chartId = '') {
    setAnnPopup({ open: true, sprints, chartId });
  }

  // Fetch capacity data whenever the capacity tab is active and inputs change
  useEffect(() => {
    if (subTab !== 'capacity') return;
    if (!pi || !teamName) { setCapData(null); return; }
    setCapLoading(true);
    setCapError(null);
    apiFetch(`/api/sprint-capacity?pi=${encodeURIComponent(pi)}&team=${encodeURIComponent(teamName)}`)
      .then(d => setCapData(d))
      .catch(e => setCapError(e.message))
      .finally(() => setCapLoading(false));
  }, [subTab, pi, teamName]);

  // Build chart data from sprint trend
  const sprints      = trendData?.sprints || [];
  const sprintLabels = sprints.map(s => s.sprint || s.label || '');

  // ── Overview combo chart (5 datasets: 2 bars + 3 lines, dual Y-axis) ──
  const overviewChartData = {
    labels: sprintLabels,
    datasets: [
      {
        type: 'bar',
        label: 'Features Planned',
        data: sprints.map(s => s.featureTotal),
        backgroundColor: 'rgba(90,120,220,0.55)',
        borderColor: '#5a78dc',
        borderWidth: 1,
        borderRadius: 0,
        yAxisID: 'y',
        order: 2,
      },
      {
        type: 'bar',
        label: 'Features Done',
        data: sprints.map(s => s.featureDone),
        backgroundColor: 'rgba(6,132,67,0.7)',
        borderColor: '#068443',
        borderWidth: 1,
        borderRadius: 0,
        yAxisID: 'y',
        order: 2,
      },
      {
        type: 'line',
        label: 'Done Rate %',
        data: sprints.map(s => s.isFuture ? null : s.doneRate),
        borderColor: '#39ff14',
        backgroundColor: 'rgba(57,255,20,0.08)',
        borderWidth: 2.5,
        pointRadius: 5,
        pointBackgroundColor: '#39ff14',
        tension: 0.3,
        yAxisID: 'y1',
        order: 1,
        datalabels: { display: false },
      },
      {
        type: 'line',
        label: 'Resolve Rate %',
        data: sprints.map(s => s.isFuture ? null : (s.resolveRate ?? null)),
        borderColor: '#1492ff',
        backgroundColor: 'rgba(20,146,255,0.08)',
        borderWidth: 2.5,
        pointRadius: 5,
        pointBackgroundColor: '#1492ff',
        tension: 0.3,
        yAxisID: 'y1',
        order: 1,
        datalabels: { display: false },
      },
      {
        type: 'line',
        label: 'Escape Ratio %',
        data: sprints.map(s => s.isFuture ? null : s.escapeRatio),
        borderColor: '#f87171',
        backgroundColor: 'rgba(248,113,113,0.08)',
        borderWidth: 2,
        pointRadius: 5,
        pointBackgroundColor: '#f87171',
        borderDash: [5, 4],
        tension: 0.3,
        yAxisID: 'y1',
        order: 1,
        datalabels: { display: false },
      },
    ],
  };

  const overviewChartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#ADADAD', boxWidth: 12, padding: 14 } },
      datalabels: { display: false },
      annotation: {
        annotations: buildAnnotationLines(annItems, sprintLabels, handleDeleteAnnotation, 'sprint-overview'),
      },
      tooltip: {
        callbacks: {
          label: ctx => {
            const v = ctx.parsed.y;
            const isRate = ['Done Rate %', 'Resolve Rate %', 'Escape Ratio %'].includes(ctx.dataset.label);
            return ` ${ctx.dataset.label}: ${v != null ? v + (isRate ? '%' : '') : '–'}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: '#ADADAD', maxRotation: 0 },
        grid: { display: false },
      },
      y: {
        type: 'linear',
        position: 'left',
        beginAtZero: true,
        ticks: { color: '#ADADAD', stepSize: 1, precision: 0 },
        grid: { color: '#454545' },
        title: { display: true, text: 'Feature Count', color: '#ADADAD', font: { size: 11 } },
      },
      y1: {
        type: 'linear',
        position: 'right',
        beginAtZero: true,
        max: 100,
        ticks: { color: '#ADADAD', callback: v => v + '%' },
        grid: { display: false },
        title: { display: true, text: 'Rate %', color: '#ADADAD', font: { size: 11 } },
      },
    },
  };

  const doneRateData = {
    labels: sprintLabels,
    datasets: [
      {
        label: 'Done Rate %',
        data: sprints.map(s => s.isFuture ? null : s.doneRate),
        borderColor: '#068443', backgroundColor: 'rgba(6,132,67,.15)',
        borderWidth: 2, pointRadius: 4, tension: 0.3, fill: true,
      },
      {
        label: 'Resolve Rate %',
        data: sprints.map(s => s.isFuture ? null : (s.resolveRate ?? null)),
        borderColor: '#21837c', backgroundColor: 'rgba(33,131,124,.1)',
        borderWidth: 2, pointRadius: 4, tension: 0.3, fill: true,
      },
    ],
  };

  const escapeData = {
    labels: sprintLabels,
    datasets: [{
      label: 'Escape Ratio %',
      data: sprints.map(s => s.isFuture ? null : s.escapeRatio),
      borderColor: '#eb3f3f', backgroundColor: 'rgba(235,63,63,.1)',
      borderWidth: 2, pointRadius: 4, tension: 0.3, fill: true,
    }],
  };

  const sortedSprints = useMemo(() => {
    const rows = [...sprints];
    if (!sortKey) return rows;

    rows.sort((a, b) => {
      const valuesA = {
        sprint: a.sprint || a.label || '',
        featureTotal: Number(a.featureTotal) || 0,
        featureDone: Number(a.featureDone) || 0,
        doneRate: Number(a.doneRate) || 0,
        defectTotal: Number(a.defectTotal) || 0,
        defectResolved: Number(a.defectResolved) || 0,
        escapeRatio: Number(a.escapeRatio) || 0,
      };
      const valuesB = {
        sprint: b.sprint || b.label || '',
        featureTotal: Number(b.featureTotal) || 0,
        featureDone: Number(b.featureDone) || 0,
        doneRate: Number(b.doneRate) || 0,
        defectTotal: Number(b.defectTotal) || 0,
        defectResolved: Number(b.defectResolved) || 0,
        escapeRatio: Number(b.escapeRatio) || 0,
      };

      if (sortKey === 'sprint') return valuesA.sprint.localeCompare(valuesB.sprint, undefined, { numeric: true, sensitivity: 'base' });
      return valuesA[sortKey] - valuesB[sortKey];
    });

    return sortDir === 'desc' ? rows.reverse() : rows;
  }, [sortDir, sortKey, sprints]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(dir => dir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortIndicator = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕');

  const tabs = [
    { id: 'overview',      label: 'Overview' },
    { id: 'burndown',      label: 'Burndown' },
    { id: 'trend',         label: 'Trend' },
    { id: 'capacity',      label: 'Capacity' },
    { id: 'story-metrics', label: 'Story Metrics' },
  ].filter(t => tabVisible('sprint', t.id));
  const firstTab = tabs[0]?.id;

  useEffect(() => {
    if (tabs.length && !tabs.find(t => t.id === subTab)) setSubTab(firstTab);
  }, [tabs, subTab, firstTab]);

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">📈 Sprint Health</h1>
        {pi && <span className="pi-tag">{pi}</span>}
      </div>

      {/* Sub-tabs */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 4 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            style={{
              padding: '6px 14px', borderRadius: 0, border: '1px solid var(--border)',
              background: subTab === t.id ? 'var(--primary, #1492ff)' : 'var(--surface2, #232323)',
              color: subTab === t.id ? '#fff' : 'var(--muted)',
              cursor: 'pointer', fontSize: 13, fontWeight: subTab === t.id ? 700 : 400,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {subTab === 'overview' && (
        <div>
          
          {trendError   && <div style={{ color: 'var(--danger)', padding: 16 }}>❌ {trendError.message}</div>}
          {!trendLoading && !trendError && !trendData && (
            <div style={{ color: 'var(--muted)', padding: 24 }}>Select a PI to view sprint overview.</div>
          )}
          {trendData && (
            <>
              {/* KPI summary row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Total Sprints',     value: sprints.length,                                          color: '#60a5fa' },
                  { label: 'Avg Done Rate',      value: sprints.length ? Math.round(sprints.reduce((a,s) => a + (s.doneRate||0), 0) / sprints.length) + '%' : '–', color: '#39ff14' },
                  { label: 'Avg Resolve Rate',   value: sprints.length ? Math.round(sprints.reduce((a,s) => a + (s.resolveRate||0), 0) / sprints.length) + '%' : '–', color: '#1492ff' },
                  { label: 'Avg Escape Ratio',   value: sprints.length ? Math.round(sprints.reduce((a,s) => a + (s.escapeRatio||0), 0) / sprints.length) + '%' : '–', color: '#f87171' },
                  { label: 'Total Features Done', value: sprints.reduce((a,s) => a + (s.featureDone||0), 0),   color: '#4ade80' },
                ].map(k => (
                  <div key={k.label} className="card" style={{ padding: '12px 14px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</div>
                  </div>
                ))}
              </div>

              {/* Combo chart */}
              <div className="card">
                <div className="card-header"><span className="card-title">Sprint Health Overview</span><span style={{
    fontSize: 11,
    color: 'var(--muted)',
    marginLeft: 10
  }}>
                    Bars = Feature counts (left axis) &nbsp;·&nbsp; Lines = Rates % (right axis)
                  </span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels, 'sprint-overview')} /><CopyButton type="chart" /></div></div>
                <div className="chart-wrap" style={{ height: 300 }}>
                  <Chart type="bar" data={overviewChartData} options={overviewChartOpts} />
                </div>
                {/* Legend hint */}
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: '8px 4px 0', fontSize: 12, color: 'var(--muted)' }}>
                  {[
                    { color: '#5a78dc', label: 'Features Planned', type: 'bar' },
                    { color: '#068443', label: 'Features Done',     type: 'bar' },
                    { color: '#39ff14', label: 'Done Rate %',       type: 'line' },
                    { color: '#1492ff', label: 'Resolve Rate %',    type: 'line' },
                    { color: '#f87171', label: 'Escape Ratio %',    type: 'line', dashed: true },
                  ].map(l => (
                    <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      {l.type === 'bar'
                        ? <span style={{ width: 12, height: 12, background: l.color, display: 'inline-block', borderRadius: 0, flexShrink: 0 }} />
                        : <span style={{ width: 20, height: 0, borderTop: `2.5px ${l.dashed ? 'dashed' : 'solid'} ${l.color}`, display: 'inline-block', flexShrink: 0 }} />
                      }
                      {l.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Sprint summary table */}
              {chartVisible('sprint', 'sprint-summary') && (
                <div className="card mt-16">
                  <div className="card-header"><span className="card-title">Sprint Summary</span><div className="card-actions"><DownloadCSVButton filename="sprint-summary.csv" /><CopyButton type="table" /></div></div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('sprint')}>Sprint{sortIndicator('sprint')}</th>
                          <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('featureTotal')}>Features Planned{sortIndicator('featureTotal')}</th>
                          <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('featureDone')}>Features Done{sortIndicator('featureDone')}</th>
                          <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('doneRate')}>Done Rate %{sortIndicator('doneRate')}</th>
                          <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('defectTotal')}>Defects Total{sortIndicator('defectTotal')}</th>
                          <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('defectResolved')}>Defects Resolved{sortIndicator('defectResolved')}</th>
                          <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('escapeRatio')}>Escape Ratio %{sortIndicator('escapeRatio')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedSprints.length === 0
                          ? <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted2)', padding: 24 }}>No sprint data found</td></tr>
                          : sortedSprints.map(s => {
                              const doneRAG   = getRAG(s.doneRate, 'doneRate', ragThresholds);
                              const escapeRAG = getRAG(s.escapeRatio, 'escapeRatio', ragThresholds);
                              const sprintName = s.sprint || s.label || '';
                              return (
                                <tr key={sprintName}>
                                  <td style={{ fontWeight: 700, color: 'var(--primary-light)' }}>{sprintName}</td>
                                  <td>{s.featureTotal}</td>
                                  <td>{s.featureDone}</td>
                                  <td className={`rag-cell ${ragClass(doneRAG)}`}>{s.doneRate}%</td>
                                  <td>{s.defectTotal}</td>
                                  <td>{s.defectResolved}</td>
                                  <td className={`rag-cell ${ragClass(escapeRAG)}`}>{s.escapeRatio}%</td>
                                </tr>
                              );
                            })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── BURNDOWN TAB ── */}
      {subTab === 'burndown' && (
        <BurndownTab pi={pi} data={burnData} isLoading={burnLoading} error={burnError} />
      )}

      {/* ── TREND TAB ── */}
      {subTab === 'trend' && (
        <div>
          
          {trendError   && <div style={{ color: 'var(--danger)', padding: 16 }}>❌ {trendError.message}</div>}
          {!trendLoading && !trendError && !trendData && (
            <div style={{ color: 'var(--muted)', padding: 24 }}>Select a PI to view sprint trend data.</div>
          )}
          {trendData && (
            <>
              <div className="charts-grid-2">
                {chartVisible('sprint', 'done-resolve-rate') && (
                  <div className="card">
                    <div className="card-header"><span className="card-title">Done Rate &amp; Resolve Rate</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels, 'sprint-done-rate')} /><CopyButton type="chart" /></div></div>
                    <div className="chart-wrap" style={{ height: 240 }}>
                      <Line data={doneRateData} options={DARK_LINE_OPTS} />
                    </div>
                  </div>
                )}
                {chartVisible('sprint', 'escape-ratio') && (
                  <div className="card">
                    <div className="card-header"><span className="card-title">Defect Escape Ratio</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels, 'sprint-escape-ratio')} /><CopyButton type="chart" /></div></div>
                    <div className="chart-wrap" style={{ height: 240 }}>
                      <Line data={escapeData} options={DARK_LINE_OPTS} />
                    </div>
                  </div>
                )}
              </div>

              <div className="card mt-16">
                <div className="card-header"><span className="card-title">Sprint Summary</span><div className="card-actions"><TableModal label="Sprint Trend" title="Sprint Summary" badge={sprints.length}>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('sprint')}>Sprint{sortIndicator('sprint')}</th>
                            <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('featureTotal')}>Features Planned{sortIndicator('featureTotal')}</th>
                            <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('featureDone')}>Features Done{sortIndicator('featureDone')}</th>
                            <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('doneRate')}>Done Rate %{sortIndicator('doneRate')}</th>
                            <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('defectTotal')}>Defects Total{sortIndicator('defectTotal')}</th>
                            <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('defectResolved')}>Defects Resolved{sortIndicator('defectResolved')}</th>
                            <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('escapeRatio')}>Escape Ratio %{sortIndicator('escapeRatio')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedSprints.length === 0 ? <tr><td colSpan={7} style={{
                textAlign: 'center',
                color: 'var(--muted2)',
                padding: 24
              }}>No sprint data found</td></tr> : sortedSprints.map(s => {
              const doneRAG = getRAG(s.doneRate, 'doneRate', ragThresholds);
              const escapeRAG = getRAG(s.escapeRatio, 'escapeRatio', ragThresholds);
              const sprintName = s.sprint || s.label || '';
              return <tr key={sprintName}>
                                    <td style={{
                  fontWeight: 700,
                  color: 'var(--primary-light)'
                }}>
                                      {sprintName}
                                      {tfsBaseUrl && <span style={{ marginLeft: 6, display: "inline-flex" }}><TFSLink href={`${tfsBaseUrl}/_backlogs/backlog?iteration=${encodeURIComponent(sprintName)}`} label="View Sprint" /></span>}
                                    </td>
                                    <td>{s.featureTotal}</td>
                                    <td>{s.featureDone}</td>
                                    <td className={`rag-cell ${ragClass(doneRAG)}`}>{s.doneRate}%</td>
                                    <td>{s.defectTotal}</td>
                                    <td>{s.defectResolved}</td>
                                    <td className={`rag-cell ${ragClass(escapeRAG)}`}>{s.escapeRatio}%</td>
                                  </tr>;
            })}
                        </tbody>
                      </table>
                    </div>
                  </TableModal></div></div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── CAPACITY TAB ── */}
      {subTab === 'capacity' && (
        <CapacityTab pi={pi} teamName={teamName} data={capData} loading={capLoading} error={capError} chartVisible={chartVisible} onAddNote={openAnnPopup} />
      )}

      {/* ── STORY METRICS TAB ── */}
      {subTab === 'story-metrics' && (
        <StoryMetricsTab data={smData} isLoading={smLoading} error={smError} onAddNote={openAnnPopup} />
      )}
      <ChartAnnotations
        section="sprint"
        chartId={annPopup.chartId || ''}
        pi={pi}
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

// ── Burndown sub-tab ─────────────────────────────────────────────────────────

function BurndownTab({ pi, data, isLoading, error }) {
  if (!pi)        return <div style={{ color: 'var(--muted)', padding: 24 }}>Select a PI to view burndown data.</div>;
  if (isLoading)  return <PageLoader label="Loading burndown data…" />;
  if (error)      return <div style={{ color: 'var(--danger)', padding: 16 }}>❌ {error.message}</div>;
  if (!data)      return null;

  const sprints = data.sprints || [];
  if (!sprints.length) return <div style={{ color: 'var(--muted)', padding: 24 }}>No sprint data for {pi}.</div>;

  const hasEffort = sprints.some(s => s.totalEffort > 0);
  const labels    = sprints.map(s => s.sprint);
  const totalAll  = sprints.reduce((acc, s) => acc + s.total, 0);
  const doneAll   = sprints.reduce((acc, s) => acc + s.done, 0);
  const effortAll = sprints.reduce((acc, s) => acc + s.totalEffort, 0);
  const effortDone= sprints.reduce((acc, s) => acc + s.doneEffort, 0);

  const chartData = {
    labels,
    datasets: [
      {
        type: 'bar',
        label: hasEffort ? 'Done Effort' : 'Done Features',
        data: sprints.map(s => hasEffort ? s.doneEffort : s.done),
        backgroundColor: 'rgba(6,132,67,0.75)',
        borderColor: '#068443',
        borderWidth: 1,
        borderRadius: 0,
        stack: 'burndown',
        yAxisID: 'y',
        order: 2,
      },
      {
        type: 'bar',
        label: hasEffort ? 'Remaining Effort' : 'Remaining Features',
        data: sprints.map(s => hasEffort ? s.remainingEffort : s.remaining),
        backgroundColor: 'rgba(245,204,0,0.55)',
        borderColor: '#f5cc00',
        borderWidth: 1,
        borderRadius: 0,
        stack: 'burndown',
        yAxisID: 'y',
        order: 2,
      },
      {
        type: 'line',
        label: '% Complete',
        data: sprints.map(s => s.pctComplete),
        borderColor: '#1492ff',
        backgroundColor: 'rgba(20,146,255,0.08)',
        borderWidth: 2.5,
        pointRadius: 5,
        pointBackgroundColor: sprints.map(s =>
          s.pctComplete >= 80 ? '#068443' : s.pctComplete >= 50 ? '#f5cc00' : '#eb3f3f'
        ),
        tension: 0.3,
        yAxisID: 'y1',
        order: 1,
        datalabels: {
          display: true,
          align: 'top',
          anchor: 'end',
          color: '#1492ff',
          font: { size: 11, weight: 700 },
          formatter: v => v != null ? `${v}%` : '',
        },
      },
    ],
  };

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#ADADAD', boxWidth: 12, padding: 14 } },
      tooltip: {
        callbacks: {
          label: ctx => {
            const v = ctx.parsed.y;
            if (ctx.dataset.label === '% Complete') return ` % Complete: ${v}%`;
            return ` ${ctx.dataset.label}: ${v}${hasEffort ? ' pts' : ' features'}`;
          },
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        ticks: { color: '#ADADAD', maxRotation: 0 },
        grid: { display: false },
      },
      y: {
        stacked: true,
        position: 'left',
        beginAtZero: true,
        ticks: { color: '#ADADAD', precision: 0 },
        grid: { color: '#454545' },
        title: { display: true, text: hasEffort ? 'Effort (pts)' : 'Feature Count', color: '#ADADAD', font: { size: 11 } },
      },
      y1: {
        position: 'right',
        beginAtZero: true,
        max: 100,
        ticks: { color: '#1492ff', callback: v => v + '%' },
        grid: { display: false },
        title: { display: true, text: '% Complete', color: '#1492ff', font: { size: 11 } },
      },
    },
  };

  return (
    <div>
      {/* KPI summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Total Features',    value: totalAll,  color: '#60a5fa' },
          { label: 'Done',              value: doneAll,   color: '#4ade80' },
          { label: 'Remaining',         value: totalAll - doneAll, color: '#f5cc00' },
          { label: hasEffort ? 'Overall % (Effort)' : 'Overall % (Count)',
            value: totalAll > 0 ? Math.round(doneAll / totalAll * 100) + '%'
                 : '—',
            color: doneAll / Math.max(totalAll,1) >= 0.8 ? '#068443' : doneAll / Math.max(totalAll,1) >= 0.5 ? '#f5cc00' : '#eb3f3f' },
        ].map(k => (
          <div key={k.label} className="card" style={{ padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</div>
          </div>
        ))}
      </div>
      {hasEffort && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'Total Effort (pts)', value: effortAll, color: '#a78bfa' },
            { label: 'Done Effort (pts)',  value: effortDone, color: '#4ade80' },
          ].map(k => (
            <div key={k.label} className="card" style={{ padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Stacked bar + line chart */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Sprint Burndown — {pi}</span>
          <div className="card-actions"><CopyButton type="chart" /></div>
        </div>
        <div className="chart-wrap" style={{ height: 300 }}>
          <Bar data={chartData} options={chartOpts} />
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: '8px 4px 0', fontSize: 12, color: 'var(--muted)' }}>
          {[
            { color: '#068443', label: hasEffort ? 'Done Effort' : 'Done',      type: 'bar'  },
            { color: '#f5cc00', label: hasEffort ? 'Remaining Effort' : 'Remaining', type: 'bar' },
            { color: '#1492ff', label: '% Complete',                             type: 'line' },
          ].map(l => (
            <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {l.type === 'bar'
                ? <span style={{ width: 12, height: 12, background: l.color, display: 'inline-block', flexShrink: 0 }} />
                : <span style={{ width: 20, height: 0, borderTop: `2.5px solid ${l.color}`, display: 'inline-block', flexShrink: 0 }} />}
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* Sprint table */}
      <div className="card mt-16">
        <div className="card-header">
          <span className="card-title">Per-Sprint Burndown</span>
          <div className="card-actions"><CopyButton type="table" /></div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Sprint</th>
                <th>Total</th>
                <th>Done</th>
                <th>Remaining</th>
                {hasEffort && <><th>Total Effort</th><th>Done Effort</th><th>Remaining Effort</th></>}
                <th>% Complete</th>
              </tr>
            </thead>
            <tbody>
              {sprints.map(s => {
                const pct = s.pctComplete;
                const color = pct >= 80 ? '#068443' : pct >= 50 ? '#f5cc00' : '#eb3f3f';
                return (
                  <tr key={s.sprint}>
                    <td style={{ fontWeight: 700, color: 'var(--primary-light)' }}>{s.sprint}</td>
                    <td>{s.total}</td>
                    <td style={{ color: '#4ade80' }}>{s.done}</td>
                    <td style={{ color: '#f5cc00' }}>{s.remaining}</td>
                    {hasEffort && (
                      <>
                        <td>{s.totalEffort}</td>
                        <td style={{ color: '#4ade80' }}>{s.doneEffort}</td>
                        <td style={{ color: '#f5cc00' }}>{s.remainingEffort}</td>
                      </>
                    )}
                    <td style={{ fontWeight: 700, color }}>{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Capacity sub-tab ──────────────────────────────────────────────────────────

function CapacityTab({ pi, teamName, data, loading, error, chartVisible = () => true, onAddNote }) {
  if (!pi)       return <div style={{ color: 'var(--muted)', padding: 24 }}>Select a PI to view capacity data.</div>;
  if (!teamName) return <div style={{ color: 'var(--muted)', padding: 24, textAlign: 'center' }}>👆 Select a team from the filter to view capacity data</div>;
  if (loading)   return <PageLoader label="Loading capacity…" />;
  if (error)     return <div style={{ color: 'var(--danger)', padding: 16 }}>❌ {error}</div>;
  if (!data)     return null;
  if (data.teamNotFound) return <div style={{ color: 'var(--danger)', padding: 16 }}>❌ Team &quot;{teamName}&quot; has no capacity data in TFS</div>;

  const sprints  = data.sprints || [];
  const s1       = sprints.find(s => s.availableHours > 0) || sprints[0] || {};
  const totalHrs = sprints.reduce((a, s) => a + (s.availableHours || 0), 0);
  const actDev   = s1.byActivity?.['Development']?.availHours || 0;
  const actTest  = s1.byActivity?.['Testing']?.availHours     || 0;
  const stories  = sprints.reduce((a, s) => a + (s.storiesCommitted || 0), 0);
  const done     = sprints.reduce((a, s) => a + (s.storiesDone || 0), 0);
  const doneP    = stories > 0 ? Math.round(done / stories * 100) : 0;

  // Over-allocation detection
  const activeSprints     = sprints.filter(s => s.storiesCommitted > 0);
  const overloadedSprints = activeSprints.filter(s => s.storiesDone / s.storiesCommitted < 0.7);
  const isOverAllocated   = activeSprints.length > 0 && overloadedSprints.length >= Math.ceil(activeSprints.length * 0.4);

  // Build hours chart (stacked bar by activity per sprint)
  const actSet = new Set();
  sprints.forEach(sp => Object.keys(sp.byActivity || {}).forEach(a => actSet.add(a)));
  const activities = [...actSet].sort();
  const ACT_COLORS = {
    Development: { bg: 'rgba(33,131,124,0.75)', border: '#21837c' },
    Testing:     { bg: 'rgba(90,120,220,0.75)', border: '#5a78dc' },
    Unspecified: { bg: 'rgba(140,140,140,0.5)',  border: '#8c8c8c' },
  };
  const fallbacks = ['rgba(230,180,60,0.75)', 'rgba(200,80,80,0.75)', 'rgba(100,180,100,0.75)'];
  let fi = 0;
  const hoursChartData = {
    labels: sprints.map(s => s.sprint || s.name || ''),
    datasets: activities.map(act => {
      const col = ACT_COLORS[act] || { bg: fallbacks[fi % fallbacks.length], border: fallbacks[fi++] };
      return { label: act, data: sprints.map(sp => sp.byActivity?.[act]?.availHours || 0),
               backgroundColor: col.bg, borderColor: col.border, borderWidth: 1, stack: 'hours' };
    }),
  };

  const storiesChartData = {
    labels: sprints.map(s => s.sprint || s.name || ''),
    datasets: [
      { label: 'Committed', data: sprints.map(s => s.storiesCommitted), backgroundColor: 'rgba(90,120,220,0.7)', borderColor: '#5a78dc', borderWidth: 1 },
      { label: 'Done',      data: sprints.map(s => s.storiesDone),      backgroundColor: 'rgba(33,131,124,0.7)', borderColor: '#21837c', borderWidth: 1 },
    ],
  };

  const stackedOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#ADADAD' } }, datalabels: { display: false } },
    scales: {
      x: { stacked: true, ticks: { color: '#ADADAD' }, grid: { color: 'rgba(255,255,255,.06)' } },
      y: { stacked: true, ticks: { color: '#ADADAD' }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true },
    },
  };
  const groupedOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#ADADAD' } }, datalabels: { display: false } },
    scales: {
      x: { ticks: { color: '#ADADAD' }, grid: { color: 'rgba(255,255,255,.06)' } },
      y: { ticks: { color: '#ADADAD' }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true },
    },
  };

  const byAct       = s1.byActivity || {};
  const totalActHrs = Object.values(byAct).reduce((a, v) => a + (v.availHours || 0), 0);
  const actEntries  = Object.entries(byAct).sort((a, b) => (b[1].availHours || 0) - (a[1].availHours || 0));
  const members     = s1.memberDetails || [];

  return (
    <div>
      {isOverAllocated && (
        <div style={{ background:'rgba(235,63,63,0.1)', border:'1px solid #eb3f3f44', borderLeft:'3px solid #eb3f3f', padding:'10px 16px', marginBottom:14, display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:18 }}>⚠️</span>
          <div>
            <div style={{ fontWeight:700, color:'#eb3f3f', fontSize:13 }}>Over-allocation Warning</div>
            <div style={{ fontSize:12, color:'var(--text-muted)' }}>
              {overloadedSprints.length} of {activeSprints.length} sprint{activeSprints.length !== 1 ? 's' : ''} completed less than 70% of committed work — team may be over-committed.
              {' '}Worst sprint: <strong style={{ color:'#eb3f3f' }}>{overloadedSprints[0]?.sprint || overloadedSprints[0]?.name || '–'}</strong>
              {overloadedSprints[0]?.storiesCommitted > 0 && ` (${overloadedSprints[0].storiesDone}/${overloadedSprints[0].storiesCommitted} done)`}.
            </div>
          </div>
        </div>
      )}
      <div className="kpi-strip">
        <div className="kpi-card blue">  <div className="kpi-val">{totalHrs > 0 ? `${totalHrs}h` : s1.availableHours ? `${s1.availableHours}h` : '–'}</div><div className="kpi-lbl">Total Hours</div></div>
        <div className="kpi-card teal">  <div className="kpi-val">{actDev  > 0 ? `${actDev}h`  : '–'}</div><div className="kpi-lbl">Dev Hours</div></div>
        <div className="kpi-card muted"> <div className="kpi-val">{actTest > 0 ? `${actTest}h` : '–'}</div><div className="kpi-lbl">Test Hours</div></div>
        <div className="kpi-card muted"> <div className="kpi-val">{s1.membersCount ?? '–'}</div><div className="kpi-lbl">Members</div></div>
        <div className="kpi-card orange"><div className="kpi-val">{stories > 0 ? stories : '–'}</div><div className="kpi-lbl">Stories Committed</div></div>
        <div className="kpi-card green"> <div className="kpi-val">{stories > 0 ? `${doneP}%` : '–'}</div><div className="kpi-lbl">Stories Done %</div></div>
      </div>

      <div className="charts-grid-2 mt-16">
        {activities.length > 0 && chartVisible('sprint', 'capacity-hours') && (
          <div className="card">
            <div className="card-header"><span className="card-title">Capacity Hours by Sprint</span><div className="card-actions"><AnnotationButton onClick={() => onAddNote(hoursChartData.labels || [], 'sprint-capacity')} /><CopyButton type="chart" /></div></div>
            <div className="chart-wrap" style={{ height: 240 }}>
              <Bar data={hoursChartData} options={stackedOpts} />
            </div>
          </div>
        )}
        {sprints.length > 0 && chartVisible('sprint', 'stories-committed') && (
          <div className="card">
            <div className="card-header"><span className="card-title">Stories: Committed vs Done</span><div className="card-actions"><AnnotationButton onClick={() => onAddNote(storiesChartData.labels || [], 'sprint-committed-vs-done')} /><CopyButton type="chart" /></div></div>
            <div className="chart-wrap" style={{ height: 240 }}>
              <Bar data={storiesChartData} options={groupedOpts} />
            </div>
          </div>
        )}
      </div>

      {chartVisible('sprint', 'activity') && (
        <div className="card-header" style={{
  marginTop: 16
}}><span className="card-title">Activity Breakdown</span><div className="card-actions"><TableModal label="Activity Breakdown" title="Activity Breakdown" badge={actEntries.length}>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Activity</th><th>Count</th><th>HPD</th><th>Available Hours</th><th>%</th></tr></thead>
                <tbody>
                  {actEntries.length === 0 ? <tr><td colSpan={5} style={{
                textAlign: 'center',
                color: 'var(--muted2)',
                padding: 16
              }}>No capacity data for this PI</td></tr> : actEntries.map(([act, v]) => {
              const pct = totalActHrs > 0 ? Math.round(v.availHours / totalActHrs * 100) : 0;
              return <tr key={act}>
                            <td style={{
                  fontWeight: 600
                }}>{act}</td>
                            <td>{v.count}</td>
                            <td>{v.hpd}h</td>
                            <td>{v.availHours}h</td>
                            <td>{pct}%</td>
                          </tr>;
            })}
                </tbody>
              </table>
            </div>
          </TableModal></div></div>
      )}

      <div className="card-header" style={{
  marginTop: 16
}}><span className="card-title">Team Members</span><div className="card-actions"><TableModal label="Team Members" title="Team Members" badge={members.length}>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Activity</th><th>HPD</th><th>Days Off</th><th>Eff. Days</th><th>Available Hours</th></tr></thead>
              <tbody>
                {members.length === 0 ? <tr><td colSpan={6} style={{
                textAlign: 'center',
                color: 'var(--muted2)',
                padding: 16
              }}>No member data for this sprint</td></tr> : members.flatMap((m, mi) => m.activities.map((act, idx) => <tr key={`${mi}-${idx}`}>
                          {idx === 0 && <td style={{
                fontWeight: 600
              }} rowSpan={m.activities.length}>{m.name}</td>}
                          <td>{act.activity}</td>
                          <td>{act.hpd}h</td>
                          {idx === 0 ? <td style={{
                color: m.daysOff > 0 ? 'var(--danger)' : undefined
              }}>{m.daysOff}</td> : <td>–</td>}
                          {idx === 0 ? <td>{m.effDays}</td> : <td>–</td>}
                          <td>{act.availHours}h</td>
                        </tr>))}
              </tbody>
            </table>
          </div>
        </TableModal></div></div>
    </div>
  );
}

// ── Story Metrics sub-tab ─────────────────────────────────────────────────────

function StoryMetricsTab({ data, isLoading, error, onAddNote }) {
  if (isLoading) return <PageLoader label="Loading story metrics…" />;
  if (error)     return <div style={{ color: 'var(--danger)', padding: 16 }}>❌ {error.message}</div>;
  if (!data)     return <div style={{ color: 'var(--muted)', padding: 24 }}>No story metrics data available.</div>;

  const sprints = data.sprints || [];

  const chartData = {
    labels: sprints.map(s => s.sprint),
    datasets: [{
      label: 'Stories Done',
      data: sprints.map(s => s.storiesDone),
      backgroundColor: 'rgba(6,132,67,0.7)',
      borderColor: '#068443',
      borderWidth: 1,
      borderRadius: 0,
    }],
  };

  const opts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, datalabels: { display: false } },
    scales: {
      x: { ticks: { color: '#ADADAD' }, grid: { display: false } },
      y: { ticks: { color: '#ADADAD' }, grid: { color: '#454545' }, beginAtZero: true },
    },
  };

  return (
    <div>
      {sprints.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="card-title">Stories Done per Sprint</span><div className="card-actions"><AnnotationButton onClick={() => onAddNote(chartData.labels || [], 'sprint-stories')} /><CopyButton type="chart" /></div></div>
          <div className="chart-wrap" style={{ height: 240 }}>
            <Bar data={chartData} options={opts} />
          </div>
        </div>
      )}

      <div className="card mt-16">
        <div className="card-header"><span className="card-title">Story Metrics by Sprint</span><div className="card-actions"><TableModal label="Story Metrics" title="Story Metrics by Sprint" badge={sprints.length}>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Sprint</th><th>Stories Done</th><th>Effort Done</th><th>Velocity</th></tr></thead>
                <tbody>
                  {sprints.length === 0 ? <tr><td colSpan={4} style={{
                textAlign: 'center',
                color: 'var(--muted2)',
                padding: 24
              }}>No story metrics found</td></tr> : sprints.map(s => <tr key={s.sprint}>
                          <td style={{
                fontWeight: 600
              }}>{s.sprint}</td>
                          <td>{s.storiesDone ?? '–'}</td>
                          <td>{s.effortDone ?? '–'}</td>
                          <td>{s.velocity ?? '–'}</td>
                        </tr>)}
                </tbody>
              </table>
            </div>
          </TableModal></div></div>
      </div>
    </div>
  );
}

