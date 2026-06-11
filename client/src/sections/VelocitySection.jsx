import React, { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  PointElement, LineElement, Filler,
  Title, Tooltip, Legend
} from 'chart.js';
import AnnotationPlugin from 'chartjs-plugin-annotation';
import { Bar, Line } from 'react-chartjs-2';
import { useQueryClient } from '@tanstack/react-query';
import useStore from '../store/useStore.js';
import { useVelocity, usePIStoryVelocity, useProgress, useAnnotations } from '../api/hooks.js';
import { apiFetch } from '../api/apiClient.js';
import { TEAM_COLORS } from '../constants.js';
import { getPIs, buildTFSQueryUrl, getTeamAreaPath, getTeamAreaPathByName, openChartTFS } from '../tfsLinks.js';
import TableModal from '../components/ui/TableModal.jsx';
import { PageLoader } from '../components/ui/PageLoader.jsx';
import CopyButton from '../components/ui/CopyButton.jsx';
import { usePolicies } from '../hooks/usePolicies.js';
import ChartAnnotations, { buildAnnotationLines } from '../components/ui/ChartAnnotations.jsx';
import { TFSLink } from '../components/ui/TFSLink';

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  PointElement, LineElement, Filler,
  Title, Tooltip, Legend,
  AnnotationPlugin,
);

const DARK_SCALE = {
  x: { grid: { display: false }, ticks: { color: '#ADADAD', maxRotation: 45, minRotation: 30 } },
  y: { grid: { color: '#454545' }, ticks: { color: '#ADADAD' }, beginAtZero: true },
};


// ── Overview sub-tab ──────────────────────────────────────────────────────────
function OverviewTab({ velocity, store }) {
  const teams = [...new Set(velocity.flatMap(v => Object.keys(v.piEnd.byTeam)))].sort();
  const hasPoints = velocity.some(v => Object.values(v.piEnd.byTeam).some(t => (t.totalPoints || 0) > 0));

  return (
    <div>
      {/* PI Summary cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        {velocity.map(piData => {
          const pe  = piData.piEnd;
          const rate = pe.deliveryRate ?? 0;
          const rateColor = rate >= 80 ? 'var(--success)' : rate >= 50 ? 'var(--caution, #F5CC00)' : 'var(--danger)';
          const sortedTeams = Object.entries(pe.byTeam).sort(([, a], [, b]) => b.done - a.done);
          return (
            <div key={piData.pi} className="vel-pi-card" style={{ minWidth: 180, flex: '1 1 180px' }}>
              <div className="vel-pi-card-title" style={{ fontWeight: 700, marginBottom: 8 }}>
                🏁 {piData.pi}
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400, marginLeft: 6 }}>PI-end velocity</span>
              </div>
              {sortedTeams.map(([team, v]) => (
                <div key={team} className="vel-pi-stat" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: 'var(--muted)' }}>{team}</span>
                  <span style={{ fontWeight: 700 }}>
                    {v.done}
                    {hasPoints && v.points ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> ({v.points}pts)</span> : null}
                  </span>
                </div>
              ))}
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Total Done</span>
                <span style={{ color: 'var(--success)', fontWeight: 700 }}>{pe.totalDone} / {pe.total}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{rate}% delivered</span>
                </div>
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 0, marginTop: 4 }}>
                  <div style={{ height: '100%', width: `${Math.min(rate, 100)}%`, background: rateColor, borderRadius: 0, transition: 'width 0.4s' }} />
                </div>
              </div>
              {(() => {
                const area     = getTeamAreaPath(store) || store.areaPath || '';
                const iterBase = store.iterationPath;
                if (!store.tfsBaseUrl || !area || !iterBase) return null;
                const wiql = `SELECT [System.Id],[System.Title],[System.State] FROM WorkItems WHERE [System.WorkItemType]='Feature' AND [System.AreaPath] UNDER '${area}' AND [System.IterationPath] UNDER '${iterBase}\\${piData.pi}' ORDER BY [System.Id]`;
                return (
                  <div style={{ paddingTop: 6, borderTop: '1px solid var(--border)', marginTop: 6, textAlign: 'right' }}>
                    <TFSLink href={buildTFSQueryUrl(store.tfsBaseUrl, wiql)} label="View in TFS" />
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* Velocity table */}
      {teams.length > 0 && (
        <div className="card-header" style={{
  marginTop: 16
}}><span className="card-title">Velocity Table</span><div className="card-actions"><TableModal label="Velocity Table" title="Velocity Table" badge={teams.length}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    {velocity.map(v => {
                const area = getTeamAreaPath(store) || store.areaPath || '';
                const iterBase = store.iterationPath;
                const piUrl = (() => {
                  if (!store.tfsBaseUrl || !area || !iterBase) return null;
                  const wiql = `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath],[System.IterationPath] FROM WorkItems WHERE [System.WorkItemType]='Feature' AND [System.AreaPath] UNDER '${area}' AND [System.IterationPath] UNDER '${iterBase}\\${v.pi}' ORDER BY [System.Id]`;
                  return buildTFSQueryUrl(store.tfsBaseUrl, wiql);
                })();
                return <th key={v.pi} colSpan={hasPoints ? 2 : 1} style={{
                  textAlign: 'center',
                  color: 'var(--primary-light)'
                }}>
                          {piUrl ? <TFSLink href={piUrl} label={v.pi} /> : v.pi}
                        </th>;
              })}
                    <th>Avg / PI</th>
                  </tr>
                  {hasPoints && <tr>
                      <th style={{
                color: 'var(--muted2)'
              }}>–</th>
                      {velocity.map(v => <React.Fragment key={v.pi}>
                          <th style={{
                  fontSize: 10,
                  color: 'var(--success)'
                }}>Done</th>
                          <th style={{
                  fontSize: 10,
                  color: 'var(--violet, #858FFF)'
                }}>Size</th>
                        </React.Fragment>)}
                      <th />
                    </tr>}
                </thead>
                <tbody>
                  {teams.map(team => {
              const dones = velocity.map(v => v.piEnd.byTeam[team]?.done || 0);
              const pts = velocity.map(v => v.piEnd.byTeam[team]?.points || 0);
              const avg = dones.length ? Math.round(dones.reduce((a, b) => a + b, 0) / dones.length * 10) / 10 : 0;
              const trend = dones.length >= 2 ? dones[dones.length - 1] > dones[dones.length - 2] ? '↑' : dones[dones.length - 1] < dones[dones.length - 2] ? '↓' : '→' : '–';
              const trendColor = trend === '↑' ? 'var(--success)' : trend === '↓' ? 'var(--danger)' : 'var(--muted)';
              return <tr key={team}>
                        <td style={{
                  fontWeight: 700
                }}>{team}</td>
                        {dones.map((d, i) => <React.Fragment key={i}>
                            <td style={{
                    textAlign: 'center',
                    fontWeight: 700,
                    color: 'var(--success)'
                  }}>{d}</td>
                            {hasPoints && <td style={{
                    textAlign: 'center',
                    color: 'var(--violet, #858FFF)'
                  }}>{pts[i] || 0}</td>}
                          </React.Fragment>)}
                        <td style={{
                  textAlign: 'center',
                  fontWeight: 700
                }}>{avg} <span style={{
                    color: trendColor
                  }}>{trend}</span></td>
                      </tr>;
            })}
                  {/* Totals row */}
                  {(() => {
              const totals = velocity.map(v => v.piEnd.totalDone);
              const totalPts = velocity.map(v => v.piEnd.totalDonePoints || 0);
              const avgTotal = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length * 10) / 10 : 0;
              return <tr style={{
                borderTop: '2px solid var(--border)'
              }}>
                        <td style={{
                  fontWeight: 700,
                  color: 'var(--primary-light)'
                }}>TOTAL</td>
                        {totals.map((t, i) => <React.Fragment key={i}>
                            <td style={{
                    textAlign: 'center',
                    fontWeight: 700,
                    color: 'var(--primary-light)'
                  }}>{t}</td>
                            {hasPoints && <td style={{
                    textAlign: 'center',
                    color: 'var(--violet, #858FFF)'
                  }}>{totalPts[i] || 0}</td>}
                          </React.Fragment>)}
                        <td style={{
                  textAlign: 'center',
                  fontWeight: 700,
                  color: 'var(--primary-light)'
                }}>{avgTotal}</td>
                      </tr>;
            })()}
                </tbody>
              </table>
            </div>
          </TableModal></div></div>
      )}
    </div>
  );
}

// ── Per-Sprint sub-tab ────────────────────────────────────────────────────────
function PerSprintTab({ velocity, annotations = [], onDeleteAnnotation, onAddNote }) {
  const xLabels = velocity.flatMap(piData => piData.sprints.map(s => `${piData.pi} ${s.sprint}`));
  const teams   = [...new Set(velocity.flatMap(v => v.sprints.flatMap(s => Object.keys(s.byTeam))))].sort();

  const makeDatasets = (field) =>
    teams.map((team, i) => {
      const color = TEAM_COLORS[i % TEAM_COLORS.length];
      const data  = velocity.flatMap(piData =>
        piData.sprints.map(s => s?.byTeam[team]?.[field] || 0)
      );
      return { label: team, data, backgroundColor: color + 'bb', borderColor: color, borderWidth: 1 };
    });

  const commonOpts = (yLabel, chartId = '') => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#ADADAD', boxWidth: 10, padding: 8 } },
      annotation: { annotations: buildAnnotationLines(annotations, xLabels, onDeleteAnnotation, chartId) },
    },
    scales: {
      ...DARK_SCALE,
      y: { ...DARK_SCALE.y, title: { display: true, text: yLabel, color: '#ADADAD' } },
    },
  });

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><span className="card-title">Sprint Velocity — Features Done</span><div className="card-actions"><button onClick={() => onAddNote(xLabels, 'velocity-per-sprint-features')} title="Add note" style={{ fontSize: 12, padding: '2px 7px', background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button><CopyButton type="chart" /></div></div>
        <div className="chart-wrap" style={{ height: 280 }}>
          {xLabels.length > 0
            ? <Bar data={{ labels: xLabels, datasets: makeDatasets('done') }} options={commonOpts('Features Done', 'velocity-per-sprint-features')} />
            : <div style={{ color: 'var(--muted)', padding: 16 }}>No sprint data</div>}
        </div>
      </div>
      <div className="card">
        <div className="card-header"><span className="card-title">Story Points Done per Sprint</span><span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>(0 = Size field not set in TFS)</span><div className="card-actions"><button onClick={() => onAddNote(xLabels, 'velocity-per-sprint-points')} title="Add note" style={{ fontSize: 12, padding: '2px 7px', background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button><CopyButton type="chart" /></div></div>
        <div className="chart-wrap" style={{ height: 280 }}>
          {xLabels.length > 0
            ? <Bar data={{ labels: xLabels, datasets: makeDatasets('points') }} options={commonOpts('Size Points Done', 'velocity-per-sprint-points')} />
            : <div style={{ color: 'var(--muted)', padding: 16 }}>No sprint data</div>}
        </div>
      </div>
    </div>
  );
}

// ── Story Velocity sub-tab ────────────────────────────────────────────────────
function StoryVelocityTab({ pis, team, annotations = [], onDeleteAnnotation, onAddNote }) {
  const store = useStore(s => s);
  const { data, isLoading, error } = usePIStoryVelocity(pis, team);

  if (isLoading) return <PageLoader label="Loading story velocity…" />;
  if (error)     return <div style={{ padding: 16, color: 'var(--danger)' }}>❌ {error.message}</div>;
  if (!data)     return <div style={{ padding: 16, color: 'var(--muted)' }}>No story velocity data.</div>;

  const { byTeam = {}, totals = {}, storyType = 'User Story' } = data;

  // Story velocity TFS link
  const storyTfsUrl = (() => {
    if (!store.tfsBaseUrl) return null;
    const area     = getTeamAreaPath(store) || store.areaPath || '';
    const iterBase = store.iterationPath;
    let wiql = `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath],[System.IterationPath] FROM WorkItems WHERE [System.WorkItemType]='${storyType}' AND [System.State]<>'Removed'`;
    if (area)                     wiql += ` AND [System.AreaPath] UNDER '${area}'`;
    if (pis?.length && iterBase)  wiql += ` AND (${pis.map(pi => `[System.IterationPath] UNDER '${iterBase}\\${pi}'`).join(' OR ')})`;
    wiql += ' ORDER BY [System.AreaPath]';
    return buildTFSQueryUrl(store.tfsBaseUrl, wiql);
  })();
  const teams  = Object.keys(byTeam).sort((a, b) => (byTeam[b].plannedSP || 0) - (byTeam[a].plannedSP || 0));
  const colors = teams.map((_, i) => TEAM_COLORS[i % TEAM_COLORS.length]);

  const pct = totals.plannedSP > 0 ? Math.round(totals.completedSP / totals.plannedSP * 100) : 0;
  const pctColor = pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--caution, #F5CC00)' : 'var(--danger)';

  const chartData = {
    labels: teams,
    datasets: [
      {
        label: 'Planned SP',
        data: teams.map(t => byTeam[t].plannedSP || 0),
        backgroundColor: colors.map(c => c + '55'),
        borderColor: colors,
        borderWidth: 2,
        borderRadius: 0,
      },
      {
        label: 'Completed SP',
        data: teams.map(t => byTeam[t].completedSP || 0),
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor: colors,
        borderWidth: 2,
        borderRadius: 0,
      },
    ],
  };

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {     annotation: { annotations: buildAnnotationLines(annotations, teams, onDeleteAnnotation, 'velocity-story-team') },
    legend: { labels: { color: '#ccc', boxWidth: 12, font: { size: 11 } } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#ADADAD' } },
      y: {
        grid: { color: '#454545' }, ticks: { color: '#ADADAD' }, beginAtZero: true,
        title: { display: true, text: 'Story Points', color: '#ADADAD', font: { size: 11 } },
      },
    },
    onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
    onClick: (evt, elements) => {
      if (!elements.length) return;
      const team      = teams[elements[0].index];
      const isDone    = elements[0].datasetIndex === 1;
      const teamArea  = getTeamAreaPathByName(team, store);
      const clauses   = [`[System.State]<>'Removed'`];
      if (teamArea)  clauses.push(`[System.AreaPath] UNDER '${teamArea}'`);
      if (isDone)    clauses.push(`[System.State] IN ('Done','Closed','Resolved','Completed')`);
      openChartTFS(store, pis, storyType, clauses, teamArea || null);
    },
  };

  return (
    <div>
      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, fontSize: 13 }}>
        <span>📌 Planned: <strong>{totals.plannedSP} SP</strong> ({totals.planned} stories)</span>
        <span>✅ Completed: <strong style={{ color: 'var(--success)' }}>{totals.completedSP} SP</strong> ({totals.completed} stories)</span>
        <span>📈 Completion: <strong style={{ color: pctColor }}>{pct}%</strong></span>
      </div>

      {teams.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><span className="card-title">{storyType} Velocity by Team</span><div className="card-actions">{storyTfsUrl && <TFSLink href={storyTfsUrl} label="Open in TFS" />}<button onClick={() => onAddNote(teams, 'velocity-story-team')} title="Add note" style={{ fontSize: 12, padding: '2px 7px', background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button><CopyButton type="chart" /></div></div>
          <div className="chart-wrap" style={{ height: 280 }}>
            <Bar data={chartData} options={chartOpts} />
          </div>
        </div>
      )}

      {/* Story velocity table */}
      {teams.length > 0 && (
        <div className="card-header" style={{
  marginTop: 16
}}><span className="card-title">Story Velocity Detail</span><div className="card-actions"><TableModal label="Story Velocity" title="Story Velocity Detail" badge={teams.length}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Planned SP</th>
                    <th>Planned Stories</th>
                    <th>Completed SP</th>
                    <th>Completed Stories</th>
                    <th>Completion %</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map(team => {
              const v = byTeam[team];
              const tp = v.plannedSP > 0 ? Math.round(v.completedSP / v.plannedSP * 100) : 0;
              const tpColor = tp >= 80 ? 'var(--success)' : tp >= 50 ? 'var(--caution, #F5CC00)' : 'var(--danger)';
              return <tr key={team}>
                        <td style={{
                  fontWeight: 700
                }}>{team}</td>
                        <td style={{
                  textAlign: 'center'
                }}>{v.plannedSP || 0}</td>
                        <td style={{
                  textAlign: 'center'
                }}>{v.planned || 0}</td>
                        <td style={{
                  textAlign: 'center',
                  color: 'var(--success)',
                  fontWeight: 700
                }}>{v.completedSP || 0}</td>
                        <td style={{
                  textAlign: 'center'
                }}>{v.completed || 0}</td>
                        <td style={{
                  textAlign: 'center',
                  fontWeight: 700,
                  color: tpColor
                }}>{tp}%</td>
                      </tr>;
            })}
                </tbody>
              </table>
            </div>
          </TableModal></div></div>
      )}
    </div>
  );
}

// ── Burnup sub-tab ────────────────────────────────────────────────────────────
function BurnupTab({ pis, team, annotations = [], onDeleteAnnotation, onAddNote }) {
  const [selectedPI, setSelectedPI] = useState(pis[pis.length - 1] || '');
  const [granularity, setGranularity] = useState('week');
  const [metric, setMetric] = useState('count'); // 'count' | 'points'

  const activePi = selectedPI || pis[0] || '';
  const { data, isLoading, error } = useProgress(activePi, granularity, team);

  function formatLabel(key) {
    if (!key) return key;
    if (granularity === 'month') {
      const [y, m] = key.split('-');
      return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' });
    } else if (granularity === 'week') {
      const d = new Date(key);
      return `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`;
    } else {
      const d = new Date(key);
      return `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`;
    }
  }

  function makeChart(title, burnup, color, chartId) {
    if (!burnup || !burnup.dates?.length) return (
      <div style={{ color: 'var(--muted)', padding: 24, textAlign: 'center' }}>No data for {title}</div>
    );

    // Filter dates to the year of the selected PI (e.g. "26-PI2" → 2026)
    const piYearMatch = activePi.match(/^(\d{2})-/);
    const filterYear  = piYearMatch ? 2000 + parseInt(piYearMatch[1], 10) : null;

    let dates     = burnup.dates;
    let scopeAll  = metric === 'points' ? burnup.scopePts : burnup.scope;
    let doneAll   = metric === 'points' ? burnup.donePts  : burnup.done;

    if (filterYear) {
      const idx = dates.reduce((acc, d, i) => {
        if (parseInt(d.split('-')[0], 10) === filterYear) acc.push(i);
        return acc;
      }, []);
      if (idx.length) {
        dates    = idx.map(i => dates[i]);
        scopeAll = idx.map(i => scopeAll[i]);
        doneAll  = idx.map(i => doneAll[i]);
      }
    }

    const labels    = dates.map(formatLabel);
    const scopeData = scopeAll;
    const doneData  = doneAll;
    const total     = scopeData[scopeData.length - 1] || 0;
    const done      = doneData[doneData.length  - 1] || 0;
    const pct       = total > 0 ? Math.round(done / total * 100) : 0;
    const remaining = total - done;

    const chartData = {
      labels,
      datasets: [
        {
          label: `Scope (${metric === 'points' ? 'pts' : 'items'})`,
          data: scopeData,
          borderColor: '#6b7280',
          backgroundColor: '#6b728022',
          borderWidth: 2,
          borderDash: [5, 3],
          pointRadius: granularity === 'day' ? 2 : 4,
          tension: 0.3,
          fill: false,
        },
        {
          label: `Done (${metric === 'points' ? 'pts' : 'items'})`,
          data: doneData,
          borderColor: color,
          backgroundColor: color + '22',
          borderWidth: 2.5,
          pointRadius: granularity === 'day' ? 2 : 4,
          tension: 0.3,
          fill: '+0', // fill gap between Done and Scope
          fillColor: '#ef444411',
        },
      ],
    };

    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        annotation: { annotations: buildAnnotationLines(annotations, labels, onDeleteAnnotation, chartId) },
        legend: { labels: { color: '#ADADAD', boxWidth: 12, padding: 10 } },
        tooltip: {
          callbacks: {
            afterBody: ctx => {
              const idx = ctx[0]?.dataIndex;
              if (idx == null) return '';
              const s = scopeData[idx] || 0, d = doneData[idx] || 0;
              return `Remaining: ${s - d}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#ADADAD', maxRotation: 45, minRotation: 30, maxTicksLimit: 16 } },
        y: { grid: { color: '#454545' }, ticks: { color: '#ADADAD' }, beginAtZero: true,
             title: { display: true, text: metric === 'points' ? 'Story Points' : 'Items', color: '#ADADAD' } },
      },
    };

    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span className="card-title">{title} Burnup — {activePi}</span>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, alignItems: 'center' }} className="card-actions">
            <span style={{ color: 'var(--muted)' }}>Scope: <strong style={{ color: '#fff' }}>{total}</strong></span>
            <span style={{ color: 'var(--muted)' }}>Done: <strong style={{ color: 'var(--success)' }}>{done}</strong></span>
            <span style={{ color: 'var(--muted)' }}>Remaining: <strong style={{ color: remaining > 0 ? 'var(--caution, #F5CC00)' : 'var(--success)' }}>{remaining}</strong></span>
            <span style={{ color: 'var(--muted)' }}>Progress: <strong style={{ color: pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--caution, #F5CC00)' : 'var(--danger)' }}>{pct}%</strong></span>
            <button onClick={() => onAddNote(labels, chartId)} title="Add note" style={{ fontSize: 12, padding: '2px 7px', background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <CopyButton type="chart" />
          </div>
        </div>
        <div className="chart-wrap" style={{ height: 280 }}>
          <Line data={chartData} options={opts} />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* PI selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>PI</span>
          <select
            value={activePi}
            onChange={e => setSelectedPI(e.target.value)}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: '#fff', padding: '4px 10px', fontSize: 12 }}
          >
            {pis.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {/* Granularity */}
        <div style={{ display: 'flex', gap: 0 }}>
          {['day', 'week', 'month'].map(g => (
            <button key={g} onClick={() => setGranularity(g)}
              style={{
                padding: '4px 12px', fontSize: 12, border: '1px solid var(--border)',
                background: granularity === g ? 'var(--primary, #1492ff)' : 'var(--surface2)',
                color: granularity === g ? '#fff' : 'var(--muted)', cursor: 'pointer',
                textTransform: 'capitalize',
              }}>{g}</button>
          ))}
        </div>

        {/* Metric toggle */}
        <div style={{ display: 'flex', gap: 0 }}>
          {[['count', 'Item Count'], ['points', 'Story Points']].map(([val, label]) => (
            <button key={val} onClick={() => setMetric(val)}
              style={{
                padding: '4px 12px', fontSize: 12, border: '1px solid var(--border)',
                background: metric === val ? 'var(--success)' : 'var(--surface2)',
                color: metric === val ? '#fff' : 'var(--muted)', cursor: 'pointer',
              }}>{label}</button>
          ))}
        </div>
      </div>

      
      {error     && <div style={{ color: 'var(--danger)', padding: 16 }}>❌ {error.message}</div>}

      {!isLoading && !error && data && (
        <>
          {makeChart('📦 Features', data.features, '#1492ff', 'velocity-burnup-features')}
          {makeChart('📋 Stories',  data.stories,  '#068443', 'velocity-burnup-stories')}
        </>
      )}
    </div>
  );
}

// ── Burndown sub-tab ──────────────────────────────────────────────────────────
function BurndownTab({ pis, team, annotations = [], onDeleteAnnotation, onAddNote }) {
  const [selectedPI, setSelectedPI] = useState(pis[pis.length - 1] || '');
  const [granularity, setGranularity] = useState('week');
  const [metric, setMetric] = useState('count');

  const activePi = selectedPI || pis[0] || '';
  const { data, isLoading, error } = useProgress(activePi, granularity, team);

  function formatLabel(key, gran) {
    if (!key) return key;
    if (gran === 'month') {
      const [y, m] = key.split('-');
      return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' });
    }
    const d = new Date(key);
    return `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`;
  }

  function makeBurndown(title, burnup, color, chartId) {
    if (!burnup?.dates?.length) return (
      <div style={{ color: 'var(--muted)', padding: 24, textAlign: 'center' }}>No data for {title}</div>
    );

    // Filter to PI year
    const piYearMatch = activePi.match(/^(\d{2})-/);
    const filterYear  = piYearMatch ? 2000 + parseInt(piYearMatch[1], 10) : null;

    let dates    = burnup.dates;
    let scopeArr = metric === 'points' ? burnup.scopePts : burnup.scope;
    let doneArr  = metric === 'points' ? burnup.donePts  : burnup.done;

    if (filterYear) {
      const idx = dates.reduce((acc, d, i) => {
        if (parseInt(d.split('-')[0], 10) === filterYear) acc.push(i); return acc;
      }, []);
      if (idx.length) {
        dates    = idx.map(i => dates[i]);
        scopeArr = idx.map(i => scopeArr[i]);
        doneArr  = idx.map(i => doneArr[i]);
      }
    }

    const remaining  = scopeArr.map((s, i) => Math.max(0, s - (doneArr[i] || 0)));
    const labels     = dates.map(d => formatLabel(d, granularity));
    const totalScope = scopeArr[0] || 0;
    const endRemain  = remaining[remaining.length - 1] ?? 0;
    const n          = remaining.length;

    // Ideal burndown: straight line from totalScope → 0
    const idealLine  = remaining.map((_, i) => Math.round(totalScope * (1 - i / Math.max(n - 1, 1)) * 10) / 10);

    const chartData = {
      labels,
      datasets: [
        {
          label: 'Ideal',
          data: idealLine,
          borderColor: '#6b7280',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          tension: 0,
        },
        {
          label: `Remaining (${metric === 'points' ? 'pts' : 'items'})`,
          data: remaining,
          borderColor: color,
          backgroundColor: color + '22',
          borderWidth: 2.5,
          pointRadius: granularity === 'day' ? 2 : 4,
          tension: 0.3,
          fill: true,
        },
      ],
    };

    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        annotation: { annotations: buildAnnotationLines(annotations, labels, onDeleteAnnotation, chartId) },
        legend: { labels: { color: '#ADADAD', boxWidth: 12, padding: 10 } },
        tooltip: {
          callbacks: {
            afterBody: ctx => {
              const i = ctx[0]?.dataIndex;
              if (i == null) return '';
              return `Ideal: ${idealLine[i]} · Scope: ${scopeArr[i]}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#ADADAD', maxRotation: 45, minRotation: 30, maxTicksLimit: 16 } },
        y: {
          grid: { color: '#454545' }, ticks: { color: '#ADADAD' }, beginAtZero: true,
          title: { display: true, text: metric === 'points' ? 'Remaining Story Points' : 'Remaining Items', color: '#ADADAD' },
        },
      },
    };

    const pct = totalScope > 0 ? Math.round((totalScope - endRemain) / totalScope * 100) : 0;

    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span className="card-title">{title} Burndown — {activePi}</span>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, alignItems: 'center' }} className="card-actions">
            <span style={{ color: 'var(--muted)' }}>Scope: <strong style={{ color: '#fff' }}>{totalScope}</strong></span>
            <span style={{ color: 'var(--muted)' }}>Remaining: <strong style={{ color: endRemain > 0 ? 'var(--caution,#F5CC00)' : 'var(--success)' }}>{endRemain}</strong></span>
            <span style={{ color: 'var(--muted)' }}>Done: <strong style={{ color: pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--caution,#F5CC00)' : 'var(--danger)' }}>{pct}%</strong></span>
            <button onClick={() => onAddNote(labels, chartId)} title="Add note" style={{ fontSize: 12, padding: '2px 7px', background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <CopyButton type="chart" />
          </div>
        </div>
        <div className="chart-wrap" style={{ height: 280 }}>
          <Line data={chartData} options={opts} />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>PI</span>
          <select value={activePi} onChange={e => setSelectedPI(e.target.value)}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', color: '#fff', padding: '4px 10px', fontSize: 12 }}>
            {pis.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 0 }}>
          {['day', 'week', 'month'].map(g => (
            <button key={g} onClick={() => setGranularity(g)} style={{
              padding: '4px 12px', fontSize: 12, border: '1px solid var(--border)',
              background: granularity === g ? 'var(--primary,#1492ff)' : 'var(--surface2)',
              color: granularity === g ? '#fff' : 'var(--muted)', cursor: 'pointer', textTransform: 'capitalize',
            }}>{g}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 0 }}>
          {[['count', 'Item Count'], ['points', 'Story Points']].map(([val, lbl]) => (
            <button key={val} onClick={() => setMetric(val)} style={{
              padding: '4px 12px', fontSize: 12, border: '1px solid var(--border)',
              background: metric === val ? 'var(--success)' : 'var(--surface2)',
              color: metric === val ? '#fff' : 'var(--muted)', cursor: 'pointer',
            }}>{lbl}</button>
          ))}
        </div>
      </div>

      {isLoading && <PageLoader label="Loading burndown data…" />}
      {error     && <div style={{ color: 'var(--danger)', padding: 16 }}>❌ {error.message}</div>}
      {!isLoading && !error && data && (
        <>
          {makeBurndown('📦 Features', data.features, '#1492ff', 'velocity-burndown-features')}
          {makeBurndown('📋 Stories',  data.stories,  '#068443', 'velocity-burndown-stories')}
        </>
      )}
    </div>
  );
}

// ── Cumulative Flow Diagram tab ───────────────────────────────────────────────
function CFDTab({ pis, team, annotations = [], onDeleteAnnotation, onAddNote }) {
  const [selectedPI, setSelectedPI] = useState(pis[pis.length - 1] || '');
  const [metric, setMetric]         = useState('count');

  const activePi = selectedPI || pis[0] || '';
  const { data, isLoading, error } = useProgress(activePi, 'week', team);

  function makeCFD(burnup, title, colorDone, colorRemaining, chartId) {
    if (!burnup?.dates?.length) return (
      <div style={{ color: 'var(--muted)', padding: 24, textAlign: 'center' }}>No data for {title}</div>
    );

    const scopeArr = metric === 'points' ? (burnup.scopePts || burnup.scope) : burnup.scope;
    const doneArr  = metric === 'points' ? (burnup.donePts  || burnup.done)  : burnup.done;
    const labels   = burnup.dates.map(d => {
      const dt = new Date(d);
      return `${dt.toLocaleString('default', { month: 'short' })} ${dt.getDate()}`;
    });

    // Three series: Done (filled), Remaining = scope-done (filled above done), Scope (top line)
    const remainingArr = scopeArr.map((s, i) => Math.max(0, s - (doneArr[i] || 0)));

    const chartData = {
      labels,
      datasets: [
        {
          label: `Done (${metric === 'points' ? 'pts' : 'items'})`,
          data: doneArr,
          borderColor: colorDone,
          backgroundColor: colorDone + '88',
          fill: 'origin',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 0,
          order: 1,
        },
        {
          label: `Remaining`,
          data: remainingArr,
          borderColor: colorRemaining,
          backgroundColor: colorRemaining + '44',
          fill: 'origin',
          tension: 0.3,
          borderWidth: 1.5,
          pointRadius: 0,
          order: 2,
        },
        {
          label: `Scope`,
          data: scopeArr,
          borderColor: '#6b7280',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.3,
          borderWidth: 1.5,
          borderDash: [5, 3],
          pointRadius: 0,
          order: 3,
        },
      ],
    };

    const opts = {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        annotation: { annotations: buildAnnotationLines(annotations, labels, onDeleteAnnotation, chartId) },
        legend: { labels: { color: '#ADADAD', boxWidth: 10 } },
        datalabels: { display: false },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { ticks: { color: '#ADADAD', maxRotation: 45, minRotation: 30 }, grid: { display: false } },
        y: { ticks: { color: '#ADADAD' }, grid: { color: '#454545' }, beginAtZero: true, stacked: false },
      },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
    };

    const lastIdx    = scopeArr.length - 1;
    const totalScope = scopeArr[lastIdx] || 0;
    const totalDone  = doneArr[lastIdx]  || 0;
    const totalRem   = remainingArr[lastIdx] || 0;

    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><span className="card-title">{title} — Cumulative Flow</span><div className="card-actions"><button onClick={() => onAddNote(labels, chartId)} title="Add note" style={{ fontSize: 12, padding: '2px 7px', background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button><CopyButton type="chart" /></div></div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', padding: '8px 16px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
          <span>📦 Scope: <strong>{totalScope}</strong></span>
          <span style={{ color: 'var(--success)' }}>✅ Done: <strong>{totalDone}</strong></span>
          <span style={{ color: 'var(--caution, #F5CC00)' }}>⏳ Remaining: <strong>{totalRem}</strong></span>
          <span style={{ color: 'var(--muted)' }}>Done rate: <strong>{totalScope > 0 ? Math.round(totalDone / totalScope * 100) : 0}%</strong></span>
        </div>
        <div data-copy-scope className="chart-wrap" style={{ height: 240, padding: '12px 8px 8px' }}>
          <Line data={chartData} options={opts} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={selectedPI} onChange={e => setSelectedPI(e.target.value)}
          style={{ background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '4px 8px', fontSize: 12 }}>
          {pis.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={metric} onChange={e => setMetric(e.target.value)}
          style={{ background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', padding: '4px 8px', fontSize: 12 }}>
          <option value="count">Item Count</option>
          <option value="points">Story Points</option>
        </select>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Weekly snapshots — Done (solid) + Remaining (light) vs Scope (dashed)</span>
      </div>
      {isLoading && <div style={{ color: 'var(--muted)', padding: 24, textAlign: 'center' }}>Loading CFD data…</div>}
      {error     && <div style={{ color: 'var(--danger)', padding: 16 }}>❌ {error.message}</div>}
      {!isLoading && !error && data && (
        <>
          {makeCFD(data.features, '📦 Features', '#1492ff', '#9B5CFF', 'velocity-cfd-features')}
          {makeCFD(data.stories,  '📋 Stories',  '#068443', '#21837c', 'velocity-cfd-stories')}
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview',       label: 'Overview' },
  { id: 'per-sprint',     label: 'Per-Sprint' },
  { id: 'story-velocity', label: 'Story Velocity' },
  { id: 'burnup',         label: 'Burnup' },
  { id: 'burndown',       label: 'Burndown' },
  { id: 'cfd',            label: 'CFD' },
];

export default function VelocitySection() {
  const [activeTab, setActiveTab] = useState('overview');
  const [annPopup, setAnnPopup]   = useState({ open: false, sprints: [], chartId: '' });
  const store        = useStore(s => s);
  const selectedTeam = store.selectedTeam;
  const { tabVisible } = usePolicies();

  const pis = getPIs(store);
  const { data, isLoading, error } = useVelocity(pis, selectedTeam);
  const { data: annData } = useAnnotations('velocity', pis[0] || '', selectedTeam);
  const annItems = annData?.items || [];
  const qc = useQueryClient();

  async function handleDeleteAnnotation(id) {
    await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['annotations', 'velocity'] });
  }

  function openAnnPopup(sprints, chartId = '') {
    setAnnPopup({ open: true, sprints, chartId });
  }

  const rawVelocity = data?.velocity || [];
  const velocity    = rawVelocity;
  const tabs = TABS.filter(t => tabVisible('velocity', t.id));
  const firstTab = tabs[0]?.id;

  useEffect(() => {
    if (tabs.length && !tabs.find(t => t.id === activeTab)) setActiveTab(firstTab);
  }, [tabs, activeTab, firstTab]);

  if (isLoading) return <PageLoader label="Loading Velocity data…" />;

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">⚡ Velocity</h1>
        {pis.map(pi => <span key={pi} className="pi-tag">{pi}</span>)}
      </div>

      {/* Sub-tab bar */}
      <div className="sub-tabs" style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`sub-tab-btn${activeTab === tab.id ? ' active' : ''}`}
            style={{
              padding: '6px 14px', borderRadius: 0, border: '1px solid var(--border)',
              background: activeTab === tab.id ? 'var(--primary, #1492ff)' : 'var(--surface2, #232323)',
              color: activeTab === tab.id ? '#fff' : 'var(--muted)',
              cursor: 'pointer', fontSize: 13, fontWeight: activeTab === tab.id ? 700 : 400,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      
      {error     && <div style={{ color: 'var(--danger)', padding: 16 }}>❌ {error.message}</div>}

      {!isLoading && !error && velocity.length === 0 && activeTab !== 'story-velocity' && (
        <div style={{ color: 'var(--muted)', padding: 16 }}>No velocity data available.</div>
      )}

      {!isLoading && !error && (
        <>
          {activeTab === 'overview'       && velocity.length > 0 && <OverviewTab velocity={velocity} store={store} />}
          {activeTab === 'per-sprint'     && velocity.length > 0 && <PerSprintTab velocity={velocity} annotations={annItems} onDeleteAnnotation={handleDeleteAnnotation} onAddNote={openAnnPopup} />}
          {activeTab === 'story-velocity' && <StoryVelocityTab pis={pis} team={selectedTeam} annotations={annItems} onDeleteAnnotation={handleDeleteAnnotation} onAddNote={openAnnPopup} />}
          {activeTab === 'burnup'         && <BurnupTab pis={pis} team={selectedTeam} annotations={annItems} onDeleteAnnotation={handleDeleteAnnotation} onAddNote={openAnnPopup} />}
          {activeTab === 'burndown'       && <BurndownTab pis={pis} team={selectedTeam} annotations={annItems} onDeleteAnnotation={handleDeleteAnnotation} onAddNote={openAnnPopup} />}
          {activeTab === 'cfd'            && <CFDTab pis={pis} team={selectedTeam} annotations={annItems} onDeleteAnnotation={handleDeleteAnnotation} onAddNote={openAnnPopup} />}
        </>
      )}
      <ChartAnnotations
        section="velocity"
        chartId={annPopup.chartId || ''}
        pi={pis[0] || ''}
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

