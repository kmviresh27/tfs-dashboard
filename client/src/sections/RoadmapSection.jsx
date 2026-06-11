import { useState, useMemo, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, Tooltip, Legend,
} from 'chart.js';
import useStore from '../store/useStore.js';
import { useRoadmap, useDefectDensityTrend } from '../api/hooks.js';
import { TEAM_COLORS } from '../constants.js';
import { PageLoader } from '../components/ui/PageLoader.jsx';
import { usePolicies } from '../hooks/usePolicies.js';
import CopyButton from '../components/ui/CopyButton.jsx';
import { TFSLink } from '../components/ui/TFSLink';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const STATE_COLOR = {
  Done:       '#068443',
  Approved:   '#ff7f0f',
  Activated:  '#9B5CFF',
  New:        '#858FFF',
  Forecasted: '#1492ff',
  Removed:    '#757575',
};

function ragColor(rate)  { return rate >= 80 ? '#068443' : rate >= 50 ? '#ff7f0f' : '#eb3f3f'; }
function ragBg(rate)     { return rate >= 80 ? 'rgba(6,132,67,0.13)' : rate >= 50 ? 'rgba(255,127,15,0.13)' : 'rgba(235,63,63,0.10)'; }

// ── SVG progress ring ──────────────────────────────────────────────────────
function ProgressRing({ rate, size, hasData, isCurrent }) {
  const stroke = 5;
  const r      = (size - stroke * 2) / 2;
  const circ   = 2 * Math.PI * r;
  const dash   = hasData ? (rate / 100) * circ : 0;
  const color  = isCurrent ? 'var(--primary)' : hasData ? ragColor(rate) : 'var(--border)';
  return (
    <svg width={size} height={size}
      style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)', pointerEvents: 'none' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke="var(--border)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s ease' }} />
    </svg>
  );
}

// ── Sprint card ────────────────────────────────────────────────────────────
function SprintCard({ sprint, tfsBaseUrl, iterationPath, pi }) {
  const pct = sprint.total > 0 ? (sprint.done / sprint.total) * 100 : 0;
  const stateCounts = {};
  (sprint.features || []).forEach(f => { stateCounts[f.state] = (stateCounts[f.state] || 0) + 1; });

  const tfsLink = tfsBaseUrl
    ? `${tfsBaseUrl}/_workitems?_a=query&wiql=${encodeURIComponent(
        `SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='Feature' AND [System.IterationPath] UNDER '${iterationPath}\\${pi}\\${sprint.sprint}'`
      )}`
    : null;

  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{sprint.sprint}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sprint.done} / {sprint.total} features</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: sprint.total > 0 ? ragColor(sprint.doneRate) : 'var(--muted)' }}>
            {sprint.total > 0 ? `${sprint.doneRate}%` : '—'}
          </span>
          {tfsLink && <TFSLink href={tfsLink} label="Open in TFS" />}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 5, borderRadius: 0, background: 'var(--border)', marginBottom: 10, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 0, width: `${pct}%`,
          background: sprint.total > 0 ? ragColor(sprint.doneRate) : 'var(--border)',
          transition: 'width 0.5s ease' }} />
      </div>

      {/* State chips */}
      {Object.keys(stateCounts).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {Object.entries(stateCounts).sort((a,b) => b[1]-a[1]).map(([state, count]) => (
            <span key={state} style={{
              fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 0,
              background: (STATE_COLOR[state] || '#888') + '22',
              color: STATE_COLOR[state] || 'var(--muted)',
              border: `1px solid ${(STATE_COLOR[state] || '#888')}44`,
            }}>{count} {state}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Timeline View ──────────────────────────────────────────────────────────
function TimelineView({ pis, selectedPI, onSelectPI, tfsBaseUrl, iterationPath, densityTrend = [] }) {
  const selectedData = pis?.find(p => p.pi === selectedPI);
  const RING = 96;

  if (!pis?.length) return null;

  // How far along the track to colour the progress line
  const currentIdx = pis.findIndex(p => p.isCurrent);
  const passedFrac = currentIdx >= 0 ? currentIdx / (pis.length - 1) : 0;

  return (
    <div>
      {/* ── Track ── */}
      <div style={{ position: 'relative', padding: `0 ${RING/2}px ${RING * 0.9}px`, marginBottom: 8 }}>

        {/* Track background line */}
        <div style={{ position: 'absolute', top: RING/2, left: RING/2, right: RING/2,
          height: 3, background: 'var(--border)', borderRadius: 0, zIndex: 0 }} />

        {/* Coloured progress fill */}
        <div style={{ position: 'absolute', top: RING/2, left: RING/2,
          width: `calc(${passedFrac * 100}% - ${RING/2}px)`,
          height: 3, background: 'linear-gradient(90deg,var(--success),var(--primary))',
          borderRadius: 0, zIndex: 0, transition: 'width 0.6s ease' }} />

        {/* PI stations */}
        <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
          {pis.map(pi => {
            const isSelected = selectedPI === pi.pi;
            const hasData    = pi.total > 0;
            const ringColor  = pi.isCurrent ? 'var(--primary)' : hasData ? ragColor(pi.doneRate) : 'var(--border)';
            const defects    = densityTrend?.find(d => d.pi === pi.pi)?.liveDefects ?? null;

            return (
              <div key={pi.pi} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                {/* Clickable ring station */}
                <button type="button" onClick={() => onSelectPI(pi.pi)}
                  style={{
                    position: 'relative', width: RING, height: RING, borderRadius: '50%', cursor: 'pointer',
                    background: isSelected
                      ? (pi.isCurrent ? 'rgba(20,146,255,0.12)' : ragBg(pi.doneRate))
                      : 'var(--bg-card)',
                    border: `2px solid ${isSelected ? ringColor : 'transparent'}`,
                    boxShadow: isSelected ? `0 0 0 4px ${ringColor}33` : '0 1px 4px rgba(0,0,0,0.25)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 1, transition: 'all 0.2s',
                  }}>
                  <ProgressRing rate={pi.doneRate} size={RING} hasData={hasData} isCurrent={pi.isCurrent} />
                  {hasData ? (
                    <>
                      <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1,
                        color: pi.isCurrent ? 'var(--primary-light)' : ragColor(pi.doneRate) }}>
                        {pi.doneRate}%
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--muted)' }}>{pi.done}/{pi.total}</span>
                      {defects != null && (
                        <span style={{ fontSize: 9, color: '#ff8080', marginTop: 1 }}>🐛 {defects}</span>
                      )}
                    </>
                  ) : (
                    <span style={{ fontSize: 22, opacity: 0.25 }}>○</span>
                  )}
                </button>

                {/* Label */}
                <div style={{ textAlign: 'center', minWidth: 80 }}>
                  <div style={{ fontSize: 13, fontWeight: isSelected ? 700 : 600,
                    color: isSelected ? 'var(--text)' : 'var(--muted)' }}>{pi.pi}</div>
                  {pi.isCurrent && <div style={{ fontSize: 10, color: 'var(--primary)', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.06em' }}>● Current</div>}
                  {pi.isPast && !pi.isCurrent && <div style={{ fontSize: 10, color: 'var(--muted)', opacity: 0.7 }}>Completed</div>}
                  {!pi.isPast && !pi.isCurrent && <div style={{ fontSize: 10, color: 'var(--muted)', opacity: 0.45 }}>Upcoming</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Sprint cards for selected PI ── */}
      {selectedData && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, paddingBottom: 10,
            borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{selectedData.pi}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>·</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selectedData.total} features</span>
            <span style={{ fontSize: 12, color: 'var(--success)' }}>{selectedData.done} done</span>
            <span style={{ marginLeft: 4, fontSize: 13, fontWeight: 700,
              color: selectedData.total > 0 ? ragColor(selectedData.doneRate) : 'var(--muted)' }}>
              {selectedData.total > 0 ? `${selectedData.doneRate}% complete` : ''}
            </span>
            {(() => {
              const dt = densityTrend?.find(d => d.pi === selectedData.pi);
              return dt ? <>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>·</span>
                <span style={{ fontSize: 12, color: '#ff8080' }}>🐛 {dt.liveDefects} defects</span>
                <span style={{ fontSize: 11, color: 'rgba(255,128,128,0.6)' }}>({dt.liveDensity} / feature)</span>
              </> : null;
            })()}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {(selectedData.sprints || []).map(sp => (
              <SprintCard key={sp.sprint} sprint={sp}
                tfsBaseUrl={tfsBaseUrl} iterationPath={iterationPath} pi={selectedData.pi} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Heatmap View — area chart + summary table ─────────────────────────────
function HeatmapView({ pis, allTeams, densityTrend = [] }) {
  const [showTable, setShowTable] = useState(false);

  if (!pis?.length || !allTeams.length) return (
    <div style={{ color: 'var(--muted)', padding: 32, textAlign: 'center' }}>No data available</div>
  );

  const piLabels = pis.map(pi => pi.pi.replace(/\d{2}-/, ''));

  // One line per team
  const teamDatasets = allTeams.map((team, idx) => {
    const color = TEAM_COLORS[idx % TEAM_COLORS.length];
    return {
      label: team,
      data: pis.map(pi => {
        const bt = pi.byTeam?.[team];
        return bt?.total > 0 ? Math.round((bt.done / bt.total) * 100) : null;
      }),
      borderColor: color,
      backgroundColor: color + '22',
      pointBackgroundColor: color,
      pointBorderColor: '#1e1e1e',
      pointBorderWidth: 1.5,
      pointRadius: 5,
      pointHoverRadius: 8,
      borderWidth: 2,
      tension: 0.35,
      spanGaps: false,
    };
  });

  // All Teams bold line
  const allTeamsDataset = {
    label: 'All Teams',
    data: pis.map(pi => pi.total > 0 ? pi.doneRate : null),
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    pointBackgroundColor: '#fff',
    pointBorderColor: '#1e1e1e',
    pointBorderWidth: 2,
    pointRadius: 6,
    pointHoverRadius: 9,
    borderWidth: 2.5,
    borderDash: [6, 3],
    tension: 0.35,
    spanGaps: false,
    order: 0,
  };

  // Defect count per PI (single dashed line, right Y-axis)
  const defectDataset = {
    label: 'Defects',
    data: pis.map(pi => {
      const t = densityTrend?.find(d => d.pi === pi.pi);
      return t != null ? t.liveDefects : null;
    }),
    borderColor: '#ff4d4d',
    backgroundColor: 'rgba(255,77,77,0.08)',
    pointBackgroundColor: '#ff4d4d',
    pointBorderColor: '#1e1e1e',
    pointBorderWidth: 1.5,
    pointRadius: 5,
    pointHoverRadius: 8,
    borderWidth: 2,
    borderDash: [5, 4],
    tension: 0.3,
    spanGaps: false,
    yAxisID: 'y2',
    order: 0,
  };

  const chartData = { labels: piLabels, datasets: [...teamDatasets, allTeamsDataset, defectDataset] };

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: 'rgba(255,255,255,0.6)',
          boxWidth: 28, boxHeight: 2,
          padding: 16,
          font: { size: 11 },
          usePointStyle: false,
        },
      },
      tooltip: {
        callbacks: {
          title: items => {
            const idx = items[0].dataIndex;
            return pis[idx]?.pi ?? piLabels[idx];
          },
          label: ctx => {
            const idx  = ctx.dataIndex;
            const team = ctx.dataset.label;
            const val  = ctx.parsed.y;
            if (val === null) return null;
            if (team === 'Defects') {
              const t = densityTrend?.find(d => d.pi === pis[idx]?.pi);
              return t ? ` Defects: ${t.liveDefects}  (density: ${t.liveDensity})` : ` Defects: ${val}`;
            }
            if (team === 'All Teams') {
              const pi = pis[idx];
              return ` All Teams: ${val}%  (${pi.done}/${pi.total})`;
            }
            const bt = pis[idx]?.byTeam?.[team];
            return bt ? ` ${team}: ${val}%  (${bt.done}/${bt.total})` : null;
          },
        },
        backgroundColor: 'rgba(10,10,18,0.96)',
        titleColor: '#fff',
        bodyColor: 'rgba(255,255,255,0.8)',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        padding: 12,
        displayColors: true,
        boxWidth: 8,
        boxHeight: 8,
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 13, weight: '600' } },
        border: { color: 'rgba(255,255,255,0.08)' },
      },
      y: {
        min: 0, max: 100,
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: {
          color: 'rgba(255,255,255,0.35)',
          font: { size: 11 },
          callback: v => `${v}%`,
          stepSize: 25,
        },
        border: { color: 'rgba(255,255,255,0.08)' },
        title: { display: true, text: 'Done Rate %', color: 'rgba(255,255,255,0.25)', font: { size: 11 } },
      },
      y2: {
        position: 'right',
        min: 0,
        grid: { drawOnChartArea: false },
        ticks: {
          color: 'rgba(255,100,100,0.5)',
          font: { size: 10 },
          callback: v => (Number.isInteger(v) ? v : ''),
        },
        border: { color: 'rgba(255,77,77,0.2)' },
        title: { display: true, text: 'Defects', color: 'rgba(255,77,77,0.4)', font: { size: 11 } },
      },
    },
  };

  // ── Summary table data ──
  const tableRows = allTeams.map((team, idx) => {
    let yearDone = 0, yearTotal = 0;
    const piCells = pis.map(pi => {
      const bt = pi.byTeam?.[team];
      if (bt?.total) { yearDone += bt.done; yearTotal += bt.total; }
      return bt?.total > 0 ? { rate: Math.round((bt.done / bt.total) * 100), done: bt.done, total: bt.total } : null;
    });
    return {
      team, color: TEAM_COLORS[idx % TEAM_COLORS.length], piCells, yearDone, yearTotal,
      yearRate: yearTotal > 0 ? Math.round((yearDone / yearTotal) * 100) : null,
    };
  }).sort((a, b) => (b.yearRate ?? -1) - (a.yearRate ?? -1));

  function RagCell({ cell }) {
    if (!cell) return <td style={{ textAlign: 'center', color: 'var(--muted)', opacity: 0.3 }}>–</td>;
    const c = cell.rate >= 80 ? '#068443' : cell.rate >= 50 ? '#ff7f0f' : '#eb3f3f';
    return (
      <td style={{ textAlign: 'center', padding: '7px 12px' }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: c }}>{cell.rate}%</div>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{cell.done}/{cell.total}</div>
      </td>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Line chart */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Team Done Rate across PIs</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {pis.find(p => p.isCurrent) && (
              <span style={{ fontSize: 11, color: 'var(--primary-light)', fontWeight: 600 }}>
                ● {pis.find(p => p.isCurrent).pi}
              </span>
            )}
            <button
              onClick={() => setShowTable(true)}
              style={{
                fontSize: 11, fontWeight: 600, padding: '4px 10px',
                background: 'transparent',
                color: 'var(--muted)',
                border: '1px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              View Table
            </button>
            <CopyButton type="chart" />
          </div>
        </div>
        <div style={{ height: 340 }}>
          <Line data={chartData} options={chartOpts} />
        </div>
      </div>

      {/* Table modal */}
      {showTable && (
        <div
          onClick={() => setShowTable(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)',
              width: '100%', maxWidth: 780,
              maxHeight: '80vh',
              display: 'flex', flexDirection: 'column',
              border: '1px solid var(--border)',
              overflow: 'hidden',
            }}
          >
            {/* Modal header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              flexShrink: 0,
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>Team Summary</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Done rate per PI · sorted by year performance</div>
              </div>
              <button
                onClick={() => setShowTable(false)}
                style={{
                  background: 'transparent', border: 'none', color: 'var(--muted)',
                  fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: '2px 6px',
                }}
              >✕</button>
            </div>

            {/* Scrollable table */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: 160, position: 'sticky', top: 0, background: 'var(--bg-card)' }}>Team</th>
                    {pis.map(pi => (
                      <th key={pi.pi} style={{
                        textAlign: 'center', position: 'sticky', top: 0, background: 'var(--bg-card)',
                        color: pi.isCurrent ? 'var(--primary-light)' : 'var(--text)',
                      }}>
                        {pi.pi.replace(/\d{2}-/, '')}
                        {pi.isCurrent && <span style={{ display: 'block', fontSize: 9, color: 'var(--primary)', textTransform: 'uppercase' }}>now</span>}
                      </th>
                    ))}
                    <th style={{ textAlign: 'center', position: 'sticky', top: 0, background: 'var(--bg-card)' }}>Year</th>
                    <th style={{ textAlign: 'center', position: 'sticky', top: 0, background: 'var(--bg-card)', color: '#ff8080' }}>Defects</th>
                    <th style={{ textAlign: 'center', position: 'sticky', top: 0, background: 'var(--bg-card)', color: '#ff8080' }}>Density</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map(row => (
                    <tr key={row.team}>
                      <td style={{ fontWeight: 600, fontSize: 12 }}>
                        <span style={{ display: 'inline-block', width: 8, height: 8, background: row.color, marginRight: 7 }} />
                        {row.team}
                      </td>
                      {row.piCells.map((cell, i) => <RagCell key={i} cell={cell} />)}
                      <td style={{ textAlign: 'center', fontWeight: 700,
                        color: row.yearRate ? (row.yearRate >= 80 ? '#068443' : row.yearRate >= 50 ? '#ff7f0f' : '#eb3f3f') : 'var(--muted)' }}>
                        {row.yearRate !== null ? `${row.yearRate}%` : '–'}
                        {row.yearTotal > 0 && <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{row.yearDone}/{row.yearTotal}</div>}
                      </td>
                      {/* Defects cols — aggregate across all PIs for this team */}
                      {(() => {
                        const totals = (densityTrend || []).reduce((acc, t) => {
                          const bt = pis.find(p => p.pi === t.pi)?.byTeam?.[row.team];
                          return bt ? { d: acc.d + t.liveDefects, f: acc.f + t.liveFeatures } : acc;
                        }, { d: 0, f: 0 });
                        return <>
                          <td style={{ textAlign: 'center', color: '#ff8080', fontWeight: 600 }}>
                            {totals.f > 0 ? totals.d : '–'}
                          </td>
                          <td style={{ textAlign: 'center', color: '#ff8080', fontSize: 12 }}>
                            {totals.f > 0 ? (totals.d / totals.f).toFixed(2) : '–'}
                          </td>
                        </>;
                      })()}
                    </tr>
                  ))}
                  <tr style={{ background: 'rgba(255,255,255,0.03)', fontWeight: 700 }}>
                    <td style={{ fontWeight: 700 }}>All Teams</td>
                    {pis.map(pi => {
                      const c = pi.total > 0 ? (pi.doneRate >= 80 ? '#068443' : pi.doneRate >= 50 ? '#ff7f0f' : '#eb3f3f') : 'var(--muted)';
                      return (
                        <td key={pi.pi} style={{ textAlign: 'center', padding: '7px 12px' }}>
                          {pi.total > 0
                            ? <><div style={{ fontWeight: 700, fontSize: 13, color: c }}>{pi.doneRate}%</div>
                                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{pi.done}/{pi.total}</div></>
                            : <span style={{ color: 'var(--muted)', opacity: 0.35 }}>–</span>}
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center' }}>
                      {(() => {
                        const gt = pis.reduce((s, p) => s + p.total, 0), gd = pis.reduce((s, p) => s + p.done, 0);
                        const gr = gt > 0 ? Math.round((gd / gt) * 100) : null;
                        const c  = gr ? (gr >= 80 ? '#068443' : gr >= 50 ? '#ff7f0f' : '#eb3f3f') : 'var(--muted)';
                        return gr !== null
                          ? <><div style={{ fontWeight: 700, color: c }}>{gr}%</div>
                              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{gd}/{gt}</div></>
                          : '–';
                      })()}
                    </td>
                    {/* All Teams defect totals */}
                    {(() => {
                      const td = (densityTrend || []).reduce((s, t) => s + (t.liveDefects || 0), 0);
                      const tf = (densityTrend || []).reduce((s, t) => s + (t.liveFeatures || 0), 0);
                      return <>
                        <td style={{ textAlign: 'center', color: '#ff8080', fontWeight: 700 }}>{td || '–'}</td>
                        <td style={{ textAlign: 'center', color: '#ff8080' }}>{tf > 0 ? (td / tf).toFixed(2) : '–'}</td>
                      </>;
                    })()}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Section ───────────────────────────────────────────────────────────
export default function RoadmapSection() {
  const selectedTeam  = useStore(s => s.selectedTeam);
  const availablePIs  = useStore(s => s.availablePIs);
  const { tabVisible } = usePolicies();
  const piFilterYear  = useStore(s => s.piFilterYear);
  const tfsBaseUrl    = useStore(s => s.tfsBaseUrl);
  const iterationPath = useStore(s => s.iterationPath);

  const availableYears = useMemo(() => {
    const ys = [...new Set(
      availablePIs
        .map(p => { const m = (p.label||'').match(/^(\d{2})-PI/); return m ? m[1] : null; })
        .filter(Boolean)
    )].sort();
    return ys;
  }, [availablePIs]);

  const defaultYear = useMemo(() => {
    if (piFilterYear) return piFilterYear;
    return availableYears.length ? availableYears[availableYears.length - 1] : String(new Date().getFullYear()).slice(-2);
  }, [piFilterYear, availableYears]);

  const [userYear, setUserYear]   = useState(null);
  const [view, setView]           = useState('timeline');
  const [selectedPI, setSelectedPI] = useState(null);
  const year = userYear || defaultYear;

  const { data, isLoading, error } = useRoadmap(year, selectedTeam);

  const piLabelList = useMemo(() => (data?.pis || []).map(p => p.pi), [data]);
  const { data: densityData } = useDefectDensityTrend(piLabelList, selectedTeam);

  // Auto-select current (or last) PI when data loads
  useEffect(() => {
    if (!data?.pis?.length) return;
    const curr = data.pis.find(p => p.isCurrent) || data.pis[data.pis.length - 1];
    setSelectedPI(curr?.pi || null);
  }, [data]);

  const allTeams = useMemo(() => {
    if (!data?.pis) return [];
    return [...new Set(data.pis.flatMap(pi => Object.keys(pi.byTeam || {})))].sort();
  }, [data]);

  const TAB = { padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-card)', color: 'var(--muted)', marginRight: 6 };
  const TAB_A = { ...TAB, background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)' };
  const tabs = [
    { id: 'timeline', label: '🛤 Timeline' },
    { id: 'heatmap', label: '🔥 Heatmap' },
  ].filter(t => tabVisible('roadmap', t.id));
  const firstTab = tabs[0]?.id;

  useEffect(() => {
    if (tabs.length && !tabs.find(t => t.id === view)) setView(firstTab);
  }, [tabs, view, firstTab]);

  if (isLoading) return <PageLoader label="Loading Roadmap…" />;

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">🗺 Roadmap</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {/* View tabs */}
          {tabs.map(tab => (
            <button key={tab.id} style={view === tab.id ? TAB_A : TAB} onClick={() => setView(tab.id)}>{tab.label}</button>
          ))}
        </div>
      </div>

      {/* Year selector */}
      {availableYears.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          {availableYears.map(y => (
            <button key={y} style={y === year ? TAB_A : TAB} onClick={() => setUserYear(y)}>20{y}</button>
          ))}
        </div>
      )}

      
      {error     && <div style={{ color: 'var(--danger)', padding: 24 }}>❌ {error.message}</div>}

      {data && (!data.pis?.length
        ? <div style={{ color: 'var(--muted)', padding: 32, textAlign: 'center' }}>No roadmap data available</div>
        : view === 'timeline'
          ? <TimelineView pis={data.pis} selectedPI={selectedPI} onSelectPI={setSelectedPI}
              tfsBaseUrl={tfsBaseUrl} iterationPath={iterationPath}
              densityTrend={densityData?.trend} />
          : <HeatmapView pis={data.pis} allTeams={allTeams} densityTrend={densityData?.trend} />
      )}
    </div>
  );
}
