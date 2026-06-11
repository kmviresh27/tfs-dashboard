import React, { useState, useRef } from 'react';
import {
  Chart as ChartJS, BarController, LineController,
  CategoryScale, LinearScale, BarElement,
  PointElement, LineElement,
  Title, Tooltip, Legend,
} from 'chart.js';
import AnnotationPlugin from 'chartjs-plugin-annotation';
import { Chart } from 'react-chartjs-2';
import { useQueryClient } from '@tanstack/react-query';
import useStore from '../store/useStore.js';
import { usePIDelivery, useAnnotations } from '../api/hooks.js';
import { apiFetch } from '../api/apiClient.js';
import { PageLoader } from '../components/ui/PageLoader.jsx';
import { usePolicies } from '../hooks/usePolicies.js';
import CopyButton from '../components/ui/CopyButton.jsx';
import DownloadCSVButton from '../components/ui/DownloadCSVButton.jsx';
import { TFSItemLink } from '../components/ui/TFSLink';
import ChartAnnotations, { buildAnnotationLines } from '../components/ui/ChartAnnotations.jsx';

ChartJS.register(
  BarController, LineController,
  CategoryScale, LinearScale, BarElement,
  PointElement, LineElement,
  Title, Tooltip, Legend,
  AnnotationPlugin,
);

const ORANGE   = '#ff8c00';
const NEON_GRN = '#39ff14';
const BLUE     = '#1492ff';
const DARK_TICKS = { color: '#ADADAD', font: { size: 11 } };
const DARK_GRID  = { color: '#454545' };

const STATUS_COLOR = { done: '#068443', inProgress: '#ff7f0f', notStarted: '#858FFF', removed: '#757575' };

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background:'var(--surface)', border:'1px solid var(--border)',
      borderTop:`3px solid ${accent||'var(--primary)'}`,
      padding:'10px 14px', minWidth:110, flex:'1 1 110px' }}>
      <div style={{ fontSize:11, color:'var(--muted)', marginBottom:3 }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:700, color:accent||'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function DeliveryRing({ pct, done, planned }) {
  const color = pct >= 80 ? '#068443' : pct >= 50 ? '#F5CC00' : '#eb3f3f';
  const r = 34, circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      background:'var(--surface)', border:'1px solid var(--border)', borderTop:`3px solid ${color}`,
      padding:'10px 18px', minWidth:120, flex:'1 1 120px', position:'relative' }}>
      <svg width={86} height={86} style={{ transform:'rotate(-90deg)' }}>
        <circle cx={43} cy={43} r={r} fill="none" stroke="#333" strokeWidth={7} />
        <circle cx={43} cy={43} r={r} fill="none" stroke={color} strokeWidth={7}
          strokeDasharray={`${dash} ${circ-dash}`} strokeLinecap="round" />
      </svg>
      <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
        fontSize:16, fontWeight:700, color, marginTop:-8 }}>{pct}%</div>
      <div style={{ fontSize:11, color:'var(--muted)', textAlign:'center', marginTop:4 }}>
        Delivery<br/><span style={{ fontWeight:700, color:'var(--text)' }}>{done} / {planned}</span>
      </div>
    </div>
  );
}

export default function PIDeliverySection() {
  const selectedPIs  = useStore(s => s.selectedPIs);
  const availablePIs = useStore(s => s.availablePIs);
  const selectedTeam = useStore(s => s.selectedTeam);
  const { chartVisible } = usePolicies();
  const [metric, setMetric]                 = useState('count');
  const [selectedSprint, setSelectedSprint] = useState(null);
  const [annPopup, setAnnPopup] = useState({ open: false, sprints: [], chartId: '' });
  const chartRef = useRef(null);

  const activePi = selectedPIs && selectedPIs.length
    ? selectedPIs[selectedPIs.length - 1]
    : (availablePIs && availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label).pop() || '');

  const { data, isLoading, error } = usePIDelivery(activePi, selectedTeam);
  const { data: annData } = useAnnotations('pi-delivery', activePi, selectedTeam);
  const annItems = annData?.items || [];
  const qc = useQueryClient();

  async function handleDeleteAnnotation(id) {
    await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['annotations', 'pi-delivery'] });
  }

  function openAnnPopup(sprints, chartId = '') {
    setAnnPopup({ open: true, sprints, chartId });
  }

  const sprints    = (data && data.sprints)    || [];
  const totals     = (data && data.totals)     || {};
  const features   = (data && data.features)   || [];
  const unassigned = (data && data.unassigned) || {};
  const snapInfo   = (data && data.snapshot)   || null;
  const hasDates   = !!(data && data.hasDates);

  const isSP = metric === 'points';

  const gv = (s, countKey, ptsKey) => isSP ? (s[ptsKey] || 0) : (s[countKey] || 0);

  // Helper: return null for future sprints so Chart.js stops the line at today
  const gvActual = (s, countKey, ptsKey) => s.isFuture ? null : gv(s, countKey, ptsKey);

  // ── Chart data ──────────────────────────────────────────────────────────────
  const xLabels = [...sprints.map(s => s.label), 'Final'];

  // Final totals for the "Final" column
  const finalPIPlan = isSP ? totals.ptsPIPlan      : totals.piPlan;
  const finalSPPlan = isSP ? totals.ptsCurrentPlan : totals.currentPlan;
  const finalActual = isSP ? totals.ptsActualDone  : totals.actualDone;

  // Bars: per-sprint contribution (unchanged — shows each sprint's own values)
  const currentPlanBars = [...sprints.map(s => gv(s,'currentPlan','currentPlanPts')), null];
  const actualDoneBars  = [...sprints.map(s => gvActual(s,'actualDone','actualDonePts')), null];

  // Lines: cumulative running totals — each point = sum of all sprints up to and including this one.
  // For future sprints, carry forward the last known value (flat line) so the chart paints
  // all the way across rather than stopping with a gap.
  let lastActual = 0, lastActualPts = 0;
  const cumActualLine = [
    ...sprints.map(s => {
      if (!s.isFuture) {
        lastActual    = isSP ? (s.cumulativeActualPts    || 0) : (s.cumulativeActual    || 0);
      }
      return lastActual;
    }),
    finalActual,
  ];

  const cumPIPlanLine     = [...sprints.map(s => gv(s,'cumulativePIPlan',    'cumulativePIPlanPts')),    finalPIPlan];
  const cumSprintPlanLine = [...sprints.map(s => gv(s,'cumulativeSprintPlan','cumulativeSprintPlanPts')),finalSPPlan];

  const chartData = {
    labels: xLabels,
    datasets: [
      {
        type: 'bar', label: 'Current Sprint Plan',
        data: currentPlanBars,
        backgroundColor: 'rgba(255,140,0,0.65)', borderColor: ORANGE, borderWidth: 1.5,
        yAxisID: 'y', order: 3,
      },
      {
        type: 'bar', label: 'Current Actual Delivery',
        data: actualDoneBars,
        backgroundColor: 'rgba(57,255,20,0.70)', borderColor: NEON_GRN, borderWidth: 1.5,
        yAxisID: 'y', order: 3,
      },
      {
        type: 'line', label: 'Cumulative PI Plan',
        data: cumPIPlanLine,
        borderColor: BLUE, backgroundColor: 'transparent',
        borderDash: [8, 4], borderWidth: 2.5,
        pointRadius: 4, pointBackgroundColor: BLUE,
        tension: 0, yAxisID: 'y1', order: 1,
      },
      {
        type: 'line', label: 'Cumulative Sprint Plan',
        data: cumSprintPlanLine,
        borderColor: ORANGE, backgroundColor: 'transparent',
        borderDash: [4, 3], borderWidth: 2,
        pointRadius: 4, pointBackgroundColor: ORANGE,
        tension: 0, yAxisID: 'y1', order: 1,
      },
      {
        type: 'line', label: 'Cumulative Actual Delivery',
        data: cumActualLine,
        borderColor: NEON_GRN, backgroundColor: 'transparent',
        borderWidth: 2.5,
        pointRadius: 5, pointBackgroundColor: NEON_GRN,
        tension: 0, yAxisID: 'y1', order: 1,
      },
    ],
  };

  const yLabel = isSP ? 'Story Points' : '# Features';
  const chartOptions = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    onClick(_evt, elements) {
      if (!elements.length) return;
      const idx = elements[0].index;
      if (idx < sprints.length) {
        const label = sprints[idx].label;
        setSelectedSprint(prev => prev === label ? null : label);
      }
    },
    plugins: {
      legend: { labels: { color: '#ADADAD', boxWidth: 14, font: { size: 11 }, padding: 14 } },
      tooltip: { callbacks: {
        afterTitle(items) {
          return items[0] && items[0].dataIndex < sprints.length ? '🖱 Click to filter features' : '';
        },
      }},
      annotation: {
        annotations: buildAnnotationLines(annItems, xLabels, handleDeleteAnnotation, 'pi-delivery-progress'),
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { ...DARK_TICKS, font: { size: 13, weight: 700 } } },
      y: {
        position: 'left', grid: DARK_GRID, ticks: DARK_TICKS, beginAtZero: true,
        title: { display: true, text: `${yLabel} / Sprint`, color: '#ADADAD', font: { size: 11 } },
      },
      y1: {
        position: 'right', grid: { display: false }, ticks: DARK_TICKS, beginAtZero: true,
        title: { display: true, text: `Cumulative ${yLabel}`, color: '#ADADAD', font: { size: 11 } },
      },
    },
  };

  // ── Drill-down filter ────────────────────────────────────────────────────────
  const drillFeatures = selectedSprint
    ? features.filter(f => f.currentSprint === selectedSprint)
    : features;

  const pct       = totals.pct || 0;
  const rateColor = pct >= 80 ? '#068443' : pct >= 50 ? '#F5CC00' : '#eb3f3f';

  if (isLoading) return <PageLoader label="Loading PI Delivery data…" />;

  return (
    <div>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between',
        marginBottom:14, flexWrap:'wrap', gap:8 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:700 }}><span className="icon-grey">🏃</span> PI Feature Delivery Progress</h2>
          <div style={{ fontSize:12, color:'var(--muted)', marginTop:3, display:'flex', flexWrap:'wrap', gap:8 }}>
            <span>Sprint-wise planned vs actual · RTE view</span>
            {activePi && <span style={{ fontWeight:700, color:'var(--text)' }}>· {activePi}</span>}
            {snapInfo
              ? <span style={{ color:'#068443', fontWeight:600 }}>📸 Baseline: {snapInfo.label} ({new Date(snapInfo.capturedAt).toLocaleDateString()})</span>
              : data && <span style={{ color:'#F5CC00' }}>⚠ No snapshot — using current assignment</span>
            }
            {hasDates
              ? <span style={{ color:'#868686' }}>✓ Sprint dates available</span>
              : data && <span style={{ color:'#868686' }}>ℹ Done bucketed by current IterationPath</span>
            }
          </div>
        </div>
        <div style={{ display:'flex', gap: 4 }}>
          {[['count','Count'],['points','Story Points']].map(([m, lbl]) => (
            <button key={m} onClick={() => setMetric(m)} style={{
              padding:'4px 12px', fontSize:12, border:'1px solid var(--border)', cursor:'pointer',
              borderRadius: 0,
              background: metric===m ? 'var(--primary,#1492ff)' : 'var(--surface2,#232323)',
              color: metric===m ? '#fff' : 'var(--muted)',
              fontWeight: metric===m ? 700 : 400,
            }}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* Loading / error */}
      
      {error && <div style={{ padding:14, color:'var(--danger,#eb3f3f)', background:'var(--surface)', border:'1px solid var(--border)', marginBottom:12 }}>⚠ {error.message}</div>}
      {!isLoading && !error && !activePi && <div style={{ padding:16, color:'var(--muted)' }}>Select a PI from the global filter (top-right) to view delivery progress.</div>}

      {/* Summary cards */}
      {data && (
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:18, alignItems:'stretch' }}>
          <DeliveryRing pct={pct} done={totals.actualDone||0} planned={totals.piPlan||totals.currentPlan||0} />
          <StatCard label="PI Plan (Baseline)" value={totals.piPlan||0}       accent={BLUE}    sub={snapInfo ? 'from snapshot' : 'no snapshot'} />
          <StatCard label="Current Plan"        value={totals.currentPlan||0}  accent={ORANGE}  />
          <StatCard label="Actual Done"         value={totals.actualDone||0}   accent={NEON_GRN} />
          <StatCard label="In Progress"         value={totals.inProgress||0}   accent="#ff7f0f" />
          <StatCard label="Not Started"         value={totals.notStarted||0}   accent="#858FFF" />
          <StatCard label="Planned SP"          value={isSP ? totals.ptsCurrentPlan||0 : totals.ptsPIPlan||0} accent="var(--muted)" sub={isSP ? 'current' : 'baseline'} />
          <StatCard label="Done SP"             value={totals.ptsActualDone||0} accent={NEON_GRN} />
        </div>
      )}

      {/* Combo chart */}
      {data && sprints.length > 0 && chartVisible('pi-delivery', 'delivery-progress') && (
        <div data-copy-scope style={{ background:'var(--surface)', border:'1px solid var(--border)', padding:16, marginBottom:14 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
            <div style={{ fontSize:13, fontWeight:600 }}>
              Sprint-wise Feature Delivery — {activePi}
            </div>
            <div style={{ fontSize:11, color:'var(--muted)', display:'flex', gap:16, alignItems:'center' }}>
              <span><span style={{ color:ORANGE }}>■</span> Bars = per-sprint</span>
              <span><span style={{ color:BLUE }}>—</span> Lines = cumulative (right axis)</span>
              <span>☝ Click sprint to filter</span>
              <button
                onClick={() => openAnnPopup(xLabels, 'pi-delivery-progress')}
                title="Add note"
                style={{ fontSize: 12, padding: '2px 7px', background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
              </button>
              <CopyButton type="chart" />
            </div>
          </div>
          <div style={{ height:360 }}>
            <Chart type="bar" ref={chartRef} data={chartData} options={chartOptions} />
          </div>
        </div>
      )}

      {/* Sprint summary table */}
      {data && sprints.length > 0 && (
        <div data-copy-scope style={{ background:'var(--surface)', border:'1px solid var(--border)', padding:14, marginBottom:14, overflowX:'auto' }}>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:10, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            Sprint Summary
            <span style={{ display:'flex', alignItems:'center', gap:4 }}>
              <DownloadCSVButton filename="pi-delivery-summary.csv" />
              <CopyButton type="table" />
            </span>
          </div>
          <table className="data-table" style={{ fontSize:12, width:'100%' }}>
            <thead>
              <tr>
                <th>Sprint</th>
                <th style={{ textAlign:'right', color:ORANGE }}>PI Plan</th>
                <th style={{ textAlign:'right', color:ORANGE }}>Current Plan</th>
                <th style={{ textAlign:'right', color:NEON_GRN }}>Actual Done</th>
                <th style={{ textAlign:'right' }}>Completion %</th>
                <th style={{ textAlign:'right', color:BLUE }}>Cum PI Plan</th>
                <th style={{ textAlign:'right', color:ORANGE }}>Cum Sprint Plan</th>
                <th style={{ textAlign:'right', color:NEON_GRN }}>Cum Actual</th>
              </tr>
            </thead>
            <tbody>
              {sprints.map(s => {
                const base = s.piPlan || s.currentPlan;
                const spPct = base > 0 ? Math.round(s.actualDone / base * 100) : 0;
                const spColor = spPct >= 80 ? '#068443' : spPct >= 50 ? '#F5CC00' : '#eb3f3f';
                return (
                  <tr key={s.label} style={{ cursor:'pointer',
                    background: selectedSprint === s.label ? 'rgba(255,140,0,0.1)' : '' }}
                    onClick={() => setSelectedSprint(prev => prev === s.label ? null : s.label)}>
                    <td style={{ fontWeight:700 }}>{s.label}</td>
                    <td style={{ textAlign:'right', color:ORANGE }}>{s.piPlan}</td>
                    <td style={{ textAlign:'right', color:ORANGE }}>{s.currentPlan}</td>
                    <td style={{ textAlign:'right', color:NEON_GRN, fontWeight:600 }}>{s.actualDone}</td>
                    <td style={{ textAlign:'right', fontWeight:700, color:spColor }}>{spPct}%</td>
                    <td style={{ textAlign:'right', color:BLUE }}>{s.cumulativePIPlan}</td>
                    <td style={{ textAlign:'right', color:ORANGE }}>{s.cumulativeSprintPlan}</td>
                    <td style={{ textAlign:'right', color:NEON_GRN, fontWeight:600 }}>{s.cumulativeActual}</td>
                  </tr>
                );
              })}
              {unassigned && unassigned.currentPlan > 0 && (
                <tr style={{ fontStyle:'italic', color:'var(--muted)',
                  background: selectedSprint === 'Unassigned' ? 'rgba(255,140,0,0.08)' : '',
                  cursor:'pointer' }}
                  onClick={() => setSelectedSprint(prev => prev === 'Unassigned' ? null : 'Unassigned')}>
                  <td>Unassigned</td>
                  <td style={{ textAlign:'right' }}>{unassigned.piPlan}</td>
                  <td style={{ textAlign:'right' }}>{unassigned.currentPlan}</td>
                  <td style={{ textAlign:'right' }}>{unassigned.actualDone}</td>
                  <td style={{ textAlign:'right' }}>–</td>
                  <td colSpan={3} />
                </tr>
              )}
              <tr style={{ fontWeight:700, borderTop:'2px solid var(--border)', background:'rgba(255,255,255,0.03)' }}>
                <td>Total</td>
                <td style={{ textAlign:'right', color:BLUE }}>{totals.piPlan||0}</td>
                <td style={{ textAlign:'right', color:ORANGE }}>{totals.currentPlan||0}</td>
                <td style={{ textAlign:'right', color:NEON_GRN }}>{totals.actualDone||0}</td>
                <td style={{ textAlign:'right', color:rateColor, fontSize:13 }}>{pct}%</td>
                <td colSpan={3} />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Feature drill-down */}
      {data && (
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', padding:14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' }}>
            <span style={{ fontSize:13, fontWeight:600 }}>
              {selectedSprint ? `Features – ${selectedSprint}` : 'All Features'}
            </span>
            <span style={{ fontSize:11, color:'var(--muted)' }}>({drillFeatures.length})</span>
            {selectedSprint && (
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedSprint(null)}>✕ Clear</button>
            )}
            <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginLeft:'auto' }}>
              {[...sprints.map(s => s.label), ...(unassigned && unassigned.currentPlan > 0 ? ['Unassigned'] : [])].map(s => {
                const b = s === 'Unassigned' ? unassigned : sprints.find(sp => sp.label === s);
                const active = selectedSprint === s;
                return (
                  <button key={s} onClick={() => setSelectedSprint(prev => prev === s ? null : s)}
                    style={{ padding:'2px 9px', fontSize:11, border:'1px solid var(--border)',
                      cursor:'pointer', borderRadius:3,
                      background: active ? ORANGE : 'var(--surface)',
                      color: active ? '#000' : 'var(--muted)', fontWeight: active ? 700 : 400 }}>
                    {s}: {b ? `${b.actualDone}/${b.currentPlan}` : '0/0'}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ overflowX:'auto', maxHeight:450, overflowY:'auto' }}>
            <table className="data-table" style={{ fontSize:12, width:'100%' }}>
              <thead>
                <tr>
                  <th>ID</th><th>Title</th><th>State</th>
                  <th>Planned Sprint</th><th>Current Sprint</th>
                  <th>Team</th><th>Owner</th>
                  <th style={{ textAlign:'right' }}>SP</th><th>Tags</th>
                </tr>
              </thead>
              <tbody>
                {drillFeatures.map(f => (
                  <tr key={f.id}>
                    <td>
                      <TFSItemLink id={f.id} href={f.tfsUrl} />
                    </td>
                    <td style={{ maxWidth:280, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {f.isAdded && <span style={{ fontSize:10, color:'#ff7f0f', marginRight:4 }}>➕</span>}
                      {f.title}
                    </td>
                    <td>
                      <span style={{ display:'inline-block', padding:'1px 6px', fontSize:10,
                        fontWeight:700, background: STATUS_COLOR[f.status]||'#757575', color:'#fff' }}>
                        {f.state}
                      </span>
                    </td>
                    <td style={{ color:BLUE }}>{f.plannedSprint}</td>
                    <td style={{ color:ORANGE, fontWeight:600 }}>{f.currentSprint}</td>
                    <td style={{ color:'var(--muted)' }}>{f.team}</td>
                    <td style={{ color:'var(--muted)' }}>{f.assignee}</td>
                    <td style={{ textAlign:'right' }}>{f.pts||'–'}</td>
                    <td style={{ fontSize:10, color:'var(--muted)', maxWidth:120,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.tags}</td>
                  </tr>
                ))}
                {!drillFeatures.length && (
                  <tr><td colSpan={9} style={{ textAlign:'center', color:'var(--muted)', padding:24 }}>No features found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sprint Timeline */}
      {data && sprints.length > 0 && (
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', padding:14, marginTop:14 }}>
          <div style={{ fontWeight:700, fontSize:13, marginBottom:12, display:'flex', alignItems:'center', gap:10 }}>
            🗓 Sprint Timeline
            <span style={{ fontSize:11, color:'var(--muted)', fontWeight:400 }}>Feature delivery progress per sprint</span>
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {sprints.map(s => {
              const base = isSP ? (s.currentPlanPts || 0) : (s.currentPlan || 0);
              const actual = isSP ? (s.actualDonePts || 0) : (s.actualDone || 0);
              const spPct = base > 0 ? Math.min(100, Math.round(actual / base * 100)) : 0;
              const isIp = s.label?.toUpperCase().includes('IP');
              const color = isIp ? '#F5CC00' : spPct >= 80 ? '#068443' : spPct >= 50 ? '#F5CC00' : '#eb3f3f';
              return (
                <div key={s.label}
                  onClick={() => setSelectedSprint(prev => prev === s.label ? null : s.label)}
                  style={{
                    flex: '1 1 110px', minWidth: 100, maxWidth: 160,
                    border: `1px solid ${selectedSprint === s.label ? color : color + '55'}`,
                    borderTop: `3px solid ${color}`,
                    background: isIp ? 'rgba(245,204,0,0.07)' : selectedSprint === s.label ? color + '15' : 'var(--surface2)',
                    padding: '10px 12px', cursor: 'pointer', textAlign: 'center',
                    transition: 'all 0.15s',
                  }}>
                  <div style={{ fontWeight:700, fontSize:12, color }}>{s.label}</div>
                  {isIp && <div style={{ fontSize:9, color:'#F5CC00', textTransform:'uppercase', letterSpacing:'0.06em', marginTop:2 }}>Innovation &amp; Planning</div>}
                  <div style={{ fontSize:22, fontWeight:700, color, margin:'6px 0', lineHeight:1 }}>{spPct}%</div>
                  <div style={{ fontSize:10, color:'var(--muted)' }}>{actual} / {base} {isSP ? 'pts' : 'features'}</div>
                  <div style={{ height:4, background:'var(--border)', marginTop:8, borderRadius:2 }}>
                    <div style={{ height:'100%', width:`${spPct}%`, background:color, borderRadius:2, transition:'width 0.4s' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Chart annotation popup (rendered when button in header is clicked) */}
      <ChartAnnotations
        section="pi-delivery"
        pi={activePi}
        team={selectedTeam}
        chartId={annPopup.chartId || ''}
        sprints={annPopup.sprints}
        open={annPopup.open}
        setOpen={open => setAnnPopup(v => ({ ...v, open }))}
        items={annItems}
        onDelete={handleDeleteAnnotation}
      />
    </div>
  );
}
