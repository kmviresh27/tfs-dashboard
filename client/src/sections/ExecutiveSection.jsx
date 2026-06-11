import { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Title, Tooltip, Legend,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar, Doughnut } from 'react-chartjs-2';
import useStore from '../store/useStore.js';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/apiClient.js';
import { useFilteredDashboard, useObjectives, usePIChecks, useAnnotations } from '../api/hooks.js';
import { FEATURE_STATES, DEFECT_STATES } from '../constants.js';
import { getRAG, ragClass, ragSymbol, extractTeamFromPath, sprintSortKey } from '../utils.js';
import { buildSectionTFSUrl, buildTFSQueryUrl, openChartTFS, getTeamAreaPath } from '../tfsLinks.js';
import TableModal from '../components/ui/TableModal.jsx';
import { PageLoader } from '../components/ui/PageLoader.jsx';
import ChartAnnotations, { AnnotationButton } from '../components/ui/ChartAnnotations.jsx';
import { usePolicies } from '../hooks/usePolicies.js';
import { TFSLink } from '../components/ui/TFSLink';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Title, Tooltip, Legend, ChartDataLabels,
);

// ─── module-level constants ──────────────────────────────────────────────────
const OBJ_STATE_COLORS = { Done: '#068443', Approved: '#ff7f0f', New: '#1492ff', Removed: '#757575' };

// ─── helpers ─────────────────────────────────────────────────────────────────
function calcHealthScore(doneRate, resolveRate, escapeRatio) {
  return Math.round(
    0.4 * (doneRate    || 0) +
    0.3 * (resolveRate || 0) +
    0.3 * Math.max(0, 100 - (escapeRatio || 0)),
  );
}

function findTeamAreaPath(teamName, items, teamRootPaths) {
  if (!teamName || !items?.length) return null;
  const item = items.find(i => extractTeamFromPath(i.area) === teamName);
  if (!item) return null;
  const area = (item.area || '').replace(/\//g, '\\');
  // Return path up to and including the teamName segment
  const segs = area.split('\\').filter(Boolean);
  const idx  = segs.lastIndexOf(teamName);
  if (idx !== -1) return segs.slice(0, idx + 1).join('\\');
  return area;
}

function buildTeamUrl(teamAreaPath, workItemType, pis, iterationPath, tfsBaseUrl) {
  if (!teamAreaPath || !tfsBaseUrl) return null;
  let wiql = `SELECT [System.Id],[System.Title],[System.State],[System.IterationPath],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${workItemType}' AND [System.AreaPath] UNDER '${teamAreaPath}'`;
  if (pis?.length && iterationPath) {
    const piParts = pis.map(pi => `[System.IterationPath] UNDER '${iterationPath}\\${pi}'`);
    wiql += ` AND (${piParts.join(' OR ')})`;
  }
  wiql += ' ORDER BY [System.Id]';
  return buildTFSQueryUrl(tfsBaseUrl, wiql);
}

// ─── dark chart defaults ──────────────────────────────────────────────────────
const darkLegend   = { labels: { color: '#ADADAD', boxWidth: 10, font: { size: 11 } } };
const noDataLabels = { display: false };

function ArcGauge({ score, color }) {
  const r = 54, cx = 70, cy = 70;
  const startAngle = -210, totalDeg = 240;
  const pct = Math.min(100, Math.max(0, score)) / 100;

  function polar(deg, radius) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }

  function describeArc(startDeg, endDeg, radius) {
    const start = polar(startDeg, radius);
    const end = polar(endDeg, radius);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} 1 ${end.x} ${end.y}`;
  }

  const fillEnd = startAngle + totalDeg * pct;

  return (
    <svg width="140" height="100" viewBox="0 0 140 100">
      <path d={describeArc(startAngle, startAngle + totalDeg, r)} fill="none" stroke="#3a3a3a" strokeWidth="10" strokeLinecap="round" />
      {score > 0 && <path d={describeArc(startAngle, fillEnd, r)} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />}
      <text x="70" y="68" textAnchor="middle" fill={color} fontSize="24" fontWeight="700">{score}</text>
      <text x="70" y="84" textAnchor="middle" fill="#9A9A9A" fontSize="10">/ 100</text>
    </svg>
  );
}

function PIScoreHero({ f, d, store, pis }) {
  const score = calcHealthScore(f?.doneRate, d?.resolveRate, d?.escapeRatio);
  const color = score >= 70 ? '#068443' : score >= 40 ? '#F5CC00' : '#eb3f3f';
  const stability = Math.max(0, 100 - (d?.escapeRatio || 0));

  const hasTFS = !!store?.tfsBaseUrl;
  const onFeat    = hasTFS ? () => openChartTFS(store, pis, 'Feature', ["[System.State]='Done'"])    : null;
  const onResolve = hasTFS ? () => openChartTFS(store, pis, 'Defect',  ["[System.State]='Resolved'"]): null;

  // Build sprint progress — prefer effort-based, fallback to count
  const sprintRows = Object.entries(f?.totalByIteration || {})
    .map(([iterPath, { total, done, totalEffort, doneEffort }]) => {
      const segs  = iterPath.replace(/\//g, '\\').split('\\').filter(Boolean);
      const raw   = segs[segs.length - 1] || iterPath;
      const label = raw.replace(/^\d{2}-PI\d+\s*/i, '') || raw;
      const useEffort = totalEffort > 0;
      const num   = useEffort ? doneEffort  : done;
      const den   = useEffort ? totalEffort : total;
      const pct   = den > 0 ? Math.round((num / den) * 100) : 0;
      return { label, done, total, num, den, useEffort, pct, iterPath };
    })
    .filter(r => !/^\d{2}-PI\d*$/i.test(r.iterPath.split('\\').pop()))
    .sort((a, b) => sprintSortKey(a.iterPath).localeCompare(sprintSortKey(b.iterPath)));

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '20px 24px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
        <ArcGauge score={score} color={color} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>PI Programme Score</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted, var(--muted))', marginBottom: 14 }}>
            Score = <strong>40%</strong> × Feature Done Rate + <strong>30%</strong> × Defect Resolve Rate + <strong>30%</strong> × Stability (100% − Escape Ratio)
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            {[
              { label: 'Features',     value: f?.doneRate,          suffix: '%', formula: 'Features Done ÷ Total',      onClick: onFeat    },
              { label: 'Resolve Rate', value: d?.resolveRate,        suffix: '%', formula: 'Resolved ÷ Total Defects',   onClick: onResolve },
              { label: 'Stability',    value: Math.round(stability), suffix: '%', formula: '100% − Escape Ratio',        onClick: null      },
            ].map(({ label, value, suffix, formula, onClick }) => (
              <div key={label} title={formula} onClick={onClick}
                style={{ cursor: onClick ? 'pointer' : 'default' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {value != null ? value + suffix : '–'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
                <div style={{ fontSize: 10, color: 'var(--muted2, #777)', marginTop: 1, fontStyle: 'italic' }}>{formula}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <span style={{ background: `${color}22`, border: `1px solid ${color}55`, color, padding: '4px 12px', fontWeight: 700, fontSize: 12 }}>
            {score >= 70 ? '🟢 On Track' : score >= 40 ? '🟡 At Risk' : '🔴 Off Track'}
          </span>
        </div>
      </div>

      {sprintRows.length > 0 && (
        <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>
            Sprint Progress
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {sprintRows.map(({ label, done, total, num, den, useEffort, pct }) => {
              const sprintColor = pct >= 80 ? '#068443' : pct >= 50 ? '#F5CC00' : '#eb3f3f';
              return (
                <div key={label} style={{
                  flex: '1 1 120px', minWidth: 110, maxWidth: 200,
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 4, padding: '8px 10px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: sprintColor }}>{pct}%</span>
                  </div>
                  <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: sprintColor, borderRadius: 3, transition: 'width .4s' }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                    {done}/{total} feat
                    {useEffort && <span style={{ marginLeft: 6, opacity: 0.7 }}>{num}/{den} pts</span>}
                    <span style={{ marginLeft: 6, opacity: 0.65, fontStyle: 'italic' }}>
                      {useEffort ? '(done pts ÷ total pts)' : '(done feat ÷ total feat)'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HealthHero ───────────────────────────────────────────────────────────────
function HealthHero({ f, d, ragThresholds, store, pis }) {
  const density    = f.total > 0 ? Math.round((d.total / f.total) * 10) / 10 : 0;
  const score      = calcHealthScore(f.doneRate, d.resolveRate, d.escapeRatio);
  const scoreRag   = getRAG(score,          'healthScore',   ragThresholds);
  const doneRag    = getRAG(f.doneRate,      'doneRate',      ragThresholds);
  const resolveRag = getRAG(d.resolveRate,   'resolveRate',   ragThresholds);
  const escapeRag  = getRAG(d.escapeRatio,   'escapeRatio',   ragThresholds);
  const densityRag = getRAG(density,         'defectDensity', ragThresholds);

  const barPct = (value, metric) => {
    if (metric === 'defectDensity') return Math.min(100, (value / (ragThresholds.defectDensity?.amber || 3)) * 100);
    if (metric === 'escapeRatio')   return Math.min(100, (value / (ragThresholds.escapeRatio?.amber  || 25)) * 100);
    return Math.min(100, value || 0);
  };

  const hasTFS = !!store?.tfsBaseUrl;
  const metrics = [
    { label: 'Done Rate',      value: f.doneRate,    rag: doneRag,    suffix: '%', metric: 'doneRate',      formula: 'Features Done ÷ Total Features × 100',
      onClick: hasTFS ? () => openChartTFS(store, pis, 'Feature', ["[System.State]='Done'"])    : null },
    { label: 'Resolve Rate',   value: d.resolveRate, rag: resolveRag, suffix: '%', metric: 'resolveRate',   formula: 'Resolved Defects ÷ Total Defects × 100',
      onClick: hasTFS ? () => openChartTFS(store, pis, 'Defect',  ["[System.State]='Resolved'"]): null },
    { label: 'Escape Ratio',   value: d.escapeRatio, rag: escapeRag,  suffix: '%', metric: 'escapeRatio',   formula: 'Open Defects ÷ (Open + Resolved + Planned) × 100',
      onClick: hasTFS ? () => openChartTFS(store, pis, 'Defect',  ["[System.State] IN ('New','Accepted')"]): null },
    { label: 'Defect Density', value: density,       rag: densityRag, suffix: '',  metric: 'defectDensity', formula: 'Total Defects ÷ Total Features',
      onClick: hasTFS ? () => openChartTFS(store, pis, 'Defect',  [])             : null },
  ];

  return (
    <>
      <div className="health-hero">
        <div className="health-score-wrap">
          <div className={`health-score-ring ${ragClass(scoreRag)}`} title="Score = 40% × Done Rate + 30% × Resolve Rate + 30% × Stability">
            <div className="health-score-val">{score}</div>
            <div className="health-score-lbl">Health</div>
          </div>
          <div style={{ fontSize: 9, color: 'var(--muted2, #888)', marginTop: 4, textAlign: 'center', fontStyle: 'italic', lineHeight: 1.4 }}>
            40% Done + 30% Resolve<br/>+ 30% Stability
          </div>
        </div>
        <div className="health-breakdown">
          {metrics.map(m => (
            <div key={m.label} className={`health-metric ${ragClass(m.rag)}`}
              title={m.onClick ? `${m.formula}\n(click to open in TFS)` : m.formula}
              onClick={m.onClick}
              style={{ cursor: m.onClick ? 'pointer' : 'default' }}>
              <div className="hm-val">
                {m.value != null ? m.value + m.suffix : '–'}
              </div>
              <div className="hm-lbl">{m.label}</div>
              <div className="hm-bar">
                <div className="hm-bar-fill" style={{ width: barPct(m.value || 0, m.metric) + '%' }} />
              </div>
              <div style={{ fontSize: 9, color: 'var(--muted2, #888)', marginTop: 3, fontStyle: 'italic', lineHeight: 1.3 }}>{m.formula}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="kpi-strip exec-kpi-strip">
        <div className="kpi-card blue">
          <div className="kpi-val">{f.total ?? '–'}</div>
          <div className="kpi-lbl">Total Features</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-val">{f.stateCounts?.Done ?? '–'}</div>
          <div className="kpi-lbl">Features Done</div>
        </div>
        <div className={`kpi-card ${ragClass(doneRag)}`}>
          <div className="kpi-val">{f.doneRate != null ? f.doneRate + '%' : '–'}</div>
          <div className="kpi-lbl">Done Rate</div>
        </div>
        <div className="kpi-card red">
          <div className="kpi-val">{d.total ?? '–'}</div>
          <div className="kpi-lbl">Total Defects</div>
        </div>
        <div className={`kpi-card ${ragClass(escapeRag)}`}>
          <div className="kpi-val">{d.escapeRatio != null ? d.escapeRatio + '%' : '–'}</div>
          <div className="kpi-lbl">Escape Ratio</div>
        </div>
        <div className={`kpi-card ${ragClass(densityRag)}`}>
          <div className="kpi-val">{density}</div>
          <div className="kpi-lbl">Defect Density</div>
        </div>
      </div>
    </>
  );
}

// ─── CommittedVsDelivered ─────────────────────────────────────────────────────
function CommittedVsDelivered({ f, store, pis, onAddNote }) {
  const committed = f.total || 0;
  const delivered = f.stateCounts?.Done || 0;
  const remaining = Math.max(0, committed - delivered);
  const pct       = committed > 0 ? Math.round((delivered / committed) * 100) : 0;

  // Build TFS query links — use team area path when a team is selected
  const storeWithData  = { ...store, data: { features: f } };
  const teamArea       = getTeamAreaPath(storeWithData) || store.areaPath;
  const committedUrl   = buildSectionTFSUrl(storeWithData, 'Feature', pis);
  const deliveredUrl   = (() => {
    const { tfsBaseUrl, iterationPath } = store;
    if (!tfsBaseUrl || !teamArea) return null;
    const iterClauses = pis?.length && iterationPath
      ? ` AND (${pis.map(pi => `[System.IterationPath] UNDER '${iterationPath}\\${pi}'`).join(' OR ')})`
      : '';
    const wiql = `SELECT [System.Id],[System.Title],[System.State],[System.IterationPath],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='Feature' AND [System.State]='Done' AND [System.AreaPath] UNDER '${teamArea}'${iterClauses} ORDER BY [System.Id]`;
    return buildTFSQueryUrl(tfsBaseUrl, wiql);
  })();

  const gaugeData = {
    datasets: [{
      data: [delivered, remaining],
      backgroundColor: ['#06844380', '#45454560'],
      borderColor:     ['#068443',   '#454545'],
      borderWidth: 2,
    }],
    labels: ['Delivered', 'Remaining'],
  };
  const gaugeOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '72%',
    plugins: {
      legend: { display: false },
      datalabels: noDataLabels,
      tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}` } },
    },
  };

  return (
    <div className="card mt-16">
      <div className="card-header">
        <span className="card-title">Committed vs Delivered</span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <AnnotationButton onClick={() => onAddNote([], 'executive-committed-delivered')} />
          {committedUrl && <TFSLink href={committedUrl} label="All Features" />}
          {deliveredUrl && <TFSLink href={deliveredUrl} label="Done Features" />}
        </div>
      </div>
      <div className="cvd-wrap">
        <div className="cvd-gauge">
          <Doughnut data={gaugeData} options={gaugeOpts} />
          <div className="cvd-center">
            <div className="cvd-pct">{pct}%</div>
            <div className="cvd-lbl">Delivered</div>
          </div>
        </div>
        <div className="cvd-stats">
          <div className="cvd-stat" style={{ cursor: committedUrl ? 'pointer' : 'default' }}
               onClick={() => committedUrl && window.open(committedUrl, '_blank')}>
            <div className="cvd-stat-val">{committed}</div>
            <div className="cvd-stat-lbl">Committed (Planned)</div>
          </div>
          <div className="cvd-stat" style={{ cursor: deliveredUrl ? 'pointer' : 'default' }}
               onClick={() => deliveredUrl && window.open(deliveredUrl, '_blank')}>
            <div className="cvd-stat-val" style={{ color: 'var(--success)' }}>{delivered}</div>
            <div className="cvd-stat-lbl">Delivered (Done) ↗</div>
          </div>
          <div className="cvd-stat">
            <div className="cvd-stat-val">{pct}%</div>
            <div className="cvd-stat-lbl">Delivery Rate</div>
          </div>
          <div className="cvd-stat">
            <div className="cvd-stat-val" style={{ color: remaining > 0 ? 'var(--warning)' : 'var(--success)' }}>{remaining}</div>
            <div className="cvd-stat-lbl">Remaining</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TeamScorecard ────────────────────────────────────────────────────────────
function TeamScorecard({ f, d, store, pis, allItems }) {
  const { ragThresholds, tfsBaseUrl, iterationPath, teamRootPath } = store;

  const teams = [...new Set([
    ...Object.keys(f.teamBreakdown || {}),
    ...Object.keys(d.teamBreakdown || {}),
  ])].sort();

  let progTotal = 0, progDoneTotal = 0, defTotal = 0, openTotal = 0, resolvedTotal = 0;
  let escapeNumer = 0, escapeDenom = 0;

  const rows = teams.map(team => {
    const fb = f.teamBreakdown?.[team] || {};
    const db = d.teamBreakdown?.[team] || {};

    const totalF   = FEATURE_STATES.reduce((s, st) => s + (fb[st] || 0), 0);
    const doneF    = fb.Done || 0;
    const doneRate = totalF > 0 ? Math.round((doneF / totalF) * 100) : 0;

    const totalD    = DEFECT_STATES.reduce((s, st) => s + (db[st] || 0), 0);
    const openD     = (db.New || 0) + (db.Accepted || 0);
    const resolvedD = db.Resolved || 0;
    const plannedD  = db.Planned  || 0;
    const escDenom  = openD + resolvedD + plannedD;
    const escapeD   = escDenom > 0 ? Math.round((openD / escDenom) * 100) : 0;

    const resolveRate = totalD > 0 ? Math.round((resolvedD / totalD) * 100) : 0;
    const teamScore   = calcHealthScore(doneRate, resolveRate, escapeD);

    progTotal     += totalF;
    progDoneTotal += doneF;
    defTotal      += totalD;
    openTotal     += openD;
    resolvedTotal += resolvedD;
    escapeNumer   += openD;
    escapeDenom   += escDenom;

    const teamAreaPath = findTeamAreaPath(team, allItems, teamRootPath);
    const featUrl = buildTeamUrl(teamAreaPath, 'Feature', pis, iterationPath, tfsBaseUrl);
    const defUrl  = buildTeamUrl(teamAreaPath, 'Defect',  pis, iterationPath, tfsBaseUrl);

    return { team, totalF, doneF, doneRate, totalD, openD, resolvedD, escapeD, teamScore, featUrl, defUrl };
  });

  const totDone        = progTotal > 0 ? Math.round((progDoneTotal / progTotal) * 100) : 0;
  const totEscape      = escapeDenom > 0 ? Math.round((escapeNumer / escapeDenom) * 100) : 0;
  const totResolveRate = defTotal   > 0 ? Math.round((resolvedTotal / defTotal) * 100) : 0;
  const totScore       = calcHealthScore(totDone, totResolveRate, totEscape);

  const sectionFeatUrl = buildSectionTFSUrl(store, 'Feature', pis);
  const sectionDefUrl  = buildSectionTFSUrl(store, 'Defect',  pis);

  return (
    <div className="card mt-16">
      <div className="card-header"><span className="card-title">Team Scorecard</span><div style={{
    display: 'flex',
    gap: 8
  }} className="card-actions">
          {sectionFeatUrl && <TFSLink href={sectionFeatUrl} label="Features" />}
          {sectionDefUrl && <TFSLink href={sectionDefUrl} label="Defects" />}
          <TableModal label="Scorecard" title="Team Scorecard" badge={rows.length}>
            <div className="table-wrap">
              <table className="data-table scorecard-table">
                <thead>
                  <tr>
                    <th>Team</th><th>Total F</th><th>Done F</th><th>Done Rate</th>
                    <th>Total D</th><th>Open D</th><th>Resolved D</th><th>Escape</th><th>Health</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
              const dRag = getRAG(r.doneRate, 'doneRate', ragThresholds);
              const eRag = getRAG(r.escapeD, 'escapeRatio', ragThresholds);
              const hRag = getRAG(r.teamScore, 'healthScore', ragThresholds);
              const openDRag = r.openD === 0 ? 'rag-green' : r.openD > 5 ? 'rag-red' : 'rag-amber';
              return <tr key={r.team}>
                        <td style={{
                  fontWeight: 700,
                  color: 'var(--text)'
                }}>
                          {r.team}
                          {(r.featUrl || r.defUrl) && (
                            <span className="tfs-link-slot" style={{ marginLeft: 6 }}>
                              {r.featUrl && <TFSLink href={r.featUrl} label="Features" />}
                              {r.defUrl && <TFSLink href={r.defUrl} label="Defects" />}
                            </span>
                          )}
                        </td>
                        <td>{r.totalF}</td>
                        <td>{r.doneF}</td>
                        <td className={`rag-cell ${ragClass(dRag)}`}>{r.doneRate}%</td>
                        <td>{r.totalD}</td>
                        <td className={`rag-cell ${openDRag}`}>{r.openD}</td>
                        <td>{r.resolvedD}</td>
                        <td className={`rag-cell ${ragClass(eRag)}`}>{r.escapeD}%</td>
                        <td>
                          <span className={`rag-badge ${ragClass(hRag)}`}>
                            <span className="rag-dot" />
                            {ragSymbol(hRag)} {r.teamScore}
                          </span>
                        </td>
                      </tr>;
            })}
                  <tr style={{
              borderTop: '2px solid var(--border)',
              fontWeight: 700
            }}>
                    <td style={{
                fontWeight: 700,
                color: 'var(--primary-light)'
              }}>TOTAL</td>
                    <td>{progTotal}</td>
                    <td>{progDoneTotal}</td>
                    <td className={`rag-cell ${ragClass(getRAG(totDone, 'doneRate', ragThresholds))}`}>{totDone}%</td>
                    <td>{defTotal}</td>
                    <td className={`rag-cell ${openTotal > 0 ? 'rag-amber' : 'rag-green'}`}>{openTotal}</td>
                    <td>{resolvedTotal}</td>
                    <td className={`rag-cell ${ragClass(getRAG(totEscape, 'escapeRatio', ragThresholds))}`}>{totEscape}%</td>
                    <td>
                      <span className={`rag-badge ${ragClass(getRAG(totScore, 'healthScore', ragThresholds))}`}>
                        <span className="rag-dot" />
                        {ragSymbol(getRAG(totScore, 'healthScore', ragThresholds))} {totScore}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </TableModal>
        </div></div>
    </div>
  );
}

// ─── ObjectivesPanel ──────────────────────────────────────────────────────────
function ObjectivesPanel({ pis, selectedTeam, onAddNote }) {
  const { data, isLoading, error } = useObjectives(pis, selectedTeam);

  if (isLoading) return <PageLoader label="Loading Objectives…" />;
  if (error)     return <div style={{ padding: 24, color: 'var(--danger)' }}>❌ {error.message}</div>;
  if (!data)     return <div style={{ padding: 16, color: 'var(--muted)' }}>No objectives data available.</div>;

  const objectives = data.objectives || [];
  const byTeam     = data.byTeam || {};
  const teams      = Object.keys(byTeam);

  const stateCounts = {};
  objectives.forEach(o => { stateCounts[o.state] = (stateCounts[o.state] || 0) + 1; });
  const donutLabels = Object.keys(stateCounts);

  const donutData = {
    labels: donutLabels,
    datasets: [{
      data:            donutLabels.map(s => stateCounts[s]),
      backgroundColor: donutLabels.map(s => (OBJ_STATE_COLORS[s] || '#aaa') + '80'),
      borderColor:     donutLabels.map(s => OBJ_STATE_COLORS[s] || '#aaa'),
      borderWidth: 2,
    }],
  };
  const donutOpts = {
    responsive: true, maintainAspectRatio: false, cutout: '60%',
    plugins: {
      legend: { position: 'right', labels: { color: '#ccc', font: { size: 11 }, boxWidth: 10 } },
      datalabels: noDataLabels,
    },
  };

  const bvData = {
    labels: teams,
    datasets: [
      { label: 'BV Planned',   data: teams.map(t => byTeam[t].bvPlanned  || byTeam[t].bv || 0), backgroundColor: '#1492ff55', borderColor: '#1492ff', borderWidth: 2, borderRadius: 0 },
      { label: 'BV Delivered', data: teams.map(t => byTeam[t].bvDelivered || 0),                backgroundColor: '#06844355', borderColor: '#068443', borderWidth: 2, borderRadius: 0 },
    ],
  };
  const bvOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: darkLegend, datalabels: noDataLabels },
    scales: {
      x: { ticks: { color: '#aaa' }, grid: { display: false } },
      y: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true },
    },
  };

  const attainPcts = teams.map(t => byTeam[t].attainmentPct || 0);
  const attainData = {
    labels: teams,
    datasets: [{
      label:           'Attainment %',
      data:            attainPcts,
      backgroundColor: attainPcts.map(p => p >= 80 ? '#06844355' : p >= 50 ? '#f5a62355' : '#eb3f3f55'),
      borderColor:     attainPcts.map(p => p >= 80 ? '#068443'   : p >= 50 ? '#f5a623'   : '#eb3f3f'),
      borderWidth: 2, borderRadius: 0,
    }],
  };
  const attainOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      datalabels: { anchor: 'end', align: 'top', color: '#ccc', font: { size: 11 }, formatter: v => v + '%' },
    },
    scales: {
      x: { ticks: { color: '#aaa' }, grid: { display: false } },
      y: { ticks: { color: '#aaa', callback: v => v + '%' }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true, max: 100 },
    },
    layout: { padding: { top: 22 } },
  };

  const attainRag   = (data.attainmentPct   ?? 0) >= 80 ? 'rag-green' : (data.attainmentPct   ?? 0) >= 50 ? 'rag-amber' : 'rag-red';
  const bvAttainRag = (data.bvAttainmentPct ?? 0) >= 80 ? 'rag-green' : (data.bvAttainmentPct ?? 0) >= 50 ? 'rag-amber' : 'rag-red';

  return (
    <>
      <div className="kpi-strip" style={{ marginTop: 16, gridTemplateColumns: 'repeat(6,1fr)' }}>
        <div className="kpi-card blue">
          <div className="kpi-val">{data.total ?? '–'}</div>
          <div className="kpi-lbl">Total</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-val">{data.done ?? '–'}</div>
          <div className="kpi-lbl">Done</div>
        </div>
        <div className={`kpi-card ${attainRag}`}>
          <div className="kpi-val">{data.attainmentPct != null ? data.attainmentPct + '%' : '–'}</div>
          <div className="kpi-lbl">Attainment</div>
        </div>
        <div className="kpi-card muted">
          <div className="kpi-val">{data.bvPlanned ?? '–'}</div>
          <div className="kpi-lbl">BV Planned</div>
        </div>
        <div className="kpi-card teal">
          <div className="kpi-val">{data.bvDelivered ?? '–'}</div>
          <div className="kpi-lbl">BV Delivered</div>
        </div>
        <div className={`kpi-card ${bvAttainRag}`}>
          <div className="kpi-val">{data.bvAttainmentPct != null ? data.bvAttainmentPct + '%' : '–'}</div>
          <div className="kpi-lbl">BV Attainment</div>
        </div>
      </div>

      <div className="charts-grid-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-header"><span className="card-title">Objective States</span><div className="card-actions"><AnnotationButton onClick={() => onAddNote(donutLabels, 'executive-objective-states')} /></div></div>
          <div className="chart-wrap" style={{ height: 240 }}>
            {donutLabels.length > 0
              ? <Doughnut data={donutData} options={donutOpts} />
              : <div style={{ color: 'var(--muted)', padding: 16 }}>No objectives</div>}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">Attainment by Team</span><div className="card-actions"><AnnotationButton onClick={() => onAddNote(teams, 'executive-attainment-team')} /></div></div>
          <div className="chart-wrap" style={{ height: 240 }}>
            {teams.length > 0
              ? <Bar data={attainData} options={attainOpts} />
              : <div style={{ color: 'var(--muted)', padding: 16 }}>No team data</div>}
          </div>
        </div>
      </div>

      {teams.length > 0 && (
        <div className="card mt-16">
          <div className="card-header"><span className="card-title">Business Value by Team</span><div className="card-actions"><AnnotationButton onClick={() => onAddNote(teams, 'executive-business-value-team')} /></div></div>
          <div className="chart-wrap" style={{ height: 240 }}>
            <Bar data={bvData} options={bvOpts} />
          </div>
        </div>
      )}

      <div className="card mt-16">
        <div className="card-header"><span className="card-title">Objectives</span><div className="card-actions"><TableModal label="Objectives" title="Objectives" badge={objectives.length}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>ID</th><th>Title</th><th>State</th><th style={{
                textAlign: 'center'
              }}>Progress</th><th>BV</th><th>Team</th></tr>
                </thead>
                <tbody>
                  {objectives.length === 0 ? <tr><td colSpan="6" style={{
                textAlign: 'center',
                color: 'var(--muted)',
                padding: 24
              }}>No objectives found for selected PI(s)</td></tr> : objectives.map(o => {
              const c = OBJ_STATE_COLORS[o.state] || '#aaa';
              const progressMap = {
                Done: 100,
                Completed: 100,
                Approved: 75,
                Committed: 75,
                'In Progress': 60,
                Activated: 60,
                New: 10,
                'Not Started': 10,
                Removed: 0,
                Rejected: 0
              };
              const pct = progressMap[o.state] ?? 20;
              const pctColor = pct >= 80 ? '#068443' : pct >= 50 ? '#F5CC00' : '#eb3f3f';
              return <tr key={o.id}>
                            <td className="id-cell">{o.id}</td>
                            <td className="title-cell" title={o.title || ''}>{o.title || '–'}</td>
                            <td>
                              <span style={{
                    display: 'inline-block',
                    padding: '1px 8px',
                    borderRadius: 0,
                    fontSize: 11,
                    background: c + '33',
                    color: c,
                    border: `1px solid ${c}66`
                  }}>
                                {o.state || '–'}
                              </span>
                            </td>
                            <td style={{
                  minWidth: 100,
                  padding: '6px 10px'
                }}>
                              <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}>
                                <div style={{
                      flex: 1,
                      height: 6,
                      background: 'var(--border)',
                      borderRadius: 3
                    }}>
                                  <div style={{
                        height: '100%',
                        width: `${pct}%`,
                        background: pctColor,
                        borderRadius: 3,
                        transition: 'width 0.4s'
                      }} />
                                </div>
                                <span style={{
                      fontSize: 10,
                      color: pctColor,
                      fontWeight: 700,
                      minWidth: 28
                    }}>{pct}%</span>
                              </div>
                            </td>
                            <td style={{
                  textAlign: 'center',
                  fontWeight: 700,
                  color: 'var(--caution)'
                }}>{o.businessValue ?? '–'}</td>
                            <td style={{
                  fontSize: 11,
                  color: 'var(--muted)'
                }}>{o.team || '–'}</td>
                          </tr>;
            })}
                </tbody>
              </table>
            </div>
          </TableModal></div></div>
      </div>
    </>
  );
}

// ─── PIChecksPanel ────────────────────────────────────────────────────────────
function PIChecksPanel({ selectedTeam, onAddNote }) {
  const { data, isLoading, error } = usePIChecks(selectedTeam);

  if (isLoading) return <PageLoader label="Loading PI Checks…" />;
  if (error)     return <div style={{ padding: 24, color: 'var(--danger)' }}>❌ {error.message}</div>;

  const checks      = data?.checks || [];
  const totalIssues = checks.reduce((s, c) => s + (c.count || 0), 0);

  const chartData = {
    labels: checks.map(c => c.name.replace('[PI] ', '')),
    datasets: [{
      label:           'Issues Found',
      data:            checks.map(c => c.count ?? 0),
      backgroundColor: checks.map(c => (c.count ?? 0) === 0 ? '#06844380' : (c.count ?? 0) <= 3 ? '#f5a62380' : '#eb3f3f80'),
      borderColor:     checks.map(c => (c.count ?? 0) === 0 ? '#068443'   : (c.count ?? 0) <= 3 ? '#f5a623'   : '#eb3f3f'),
      borderWidth: 1, borderRadius: 0,
    }],
  };
  const chartOpts = {
    indexAxis: 'y',
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      datalabels: { anchor: 'end', align: 'right', color: '#ADADAD', font: { size: 10, weight: '700' } },
      tooltip: { callbacks: { label: ctx => ` ${ctx.raw} item${ctx.raw !== 1 ? 's' : ''}` } },
    },
    scales: {
      x: { ticks: { color: '#aaa', font: { size: 10 }, stepSize: 1 }, grid: { color: 'rgba(255,255,255,.06)' } },
      y: { ticks: { color: '#ccc', font: { size: 10 } } },
    },
    layout: { padding: { right: 36 } },
  };

  const badgeStyle = totalIssues > 0
    ? { background: 'rgba(235,63,63,.12)', border: '1px solid rgba(235,63,63,.35)', color: 'var(--danger)',  padding: '2px 10px', borderRadius: 0, fontSize: 11, fontWeight: 700, display: 'inline-block' }
    : { background: 'rgba(6,132,67,.12)',  border: '1px solid rgba(6,132,67,.35)',  color: 'var(--success)', padding: '2px 10px', borderRadius: 0, fontSize: 11, fontWeight: 700, display: 'inline-block' };

  return (
    <div className="card mt-16">
      <div className="card-header"><span className="card-title">PI Readiness Checks</span><div className="card-actions"><AnnotationButton onClick={() => onAddNote(chartData.labels || [], 'executive-pi-checks')} /><span style={badgeStyle}>{totalIssues > 0 ? `${totalIssues} issues` : '✅ All clear'}</span><TableModal label="PI Checks" title="PI Readiness Checks" badge={checks.length}>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Check Name</th>
                  <th style={{
                textAlign: 'center'
              }}>Count</th>
                  <th style={{
                textAlign: 'center'
              }}>Status</th>
                  <th>TFS Link</th>
                </tr>
              </thead>
              <tbody>
                {checks.length === 0 ? <tr><td colSpan="4" style={{
                textAlign: 'center',
                color: 'var(--muted)',
                padding: 24
              }}>No checks returned</td></tr> : checks.map((c, i) => {
              const count = c.count ?? null;
              const countEl = count === null ? <span style={{
                color: 'var(--muted2)'
              }}>–</span> : count === 0 ? <span style={{
                color: 'var(--success)',
                fontWeight: 700
              }}>0</span> : <span style={{
                color: count <= 3 ? 'var(--caution)' : 'var(--danger)',
                fontWeight: 700
              }}>{count}</span>;
              const statusEl = c.error ? <span style={{
                color: 'var(--muted2)',
                fontSize: 11
              }} title={c.error}>⚠ Not found</span> : count === 0 ? <span style={{
                background: 'rgba(6,132,67,.12)',
                border: '1px solid rgba(6,132,67,.35)',
                color: 'var(--success)',
                padding: '1px 8px',
                fontSize: 10,
                fontWeight: 700
              }}>✅ OK</span> : <span style={{
                background: 'rgba(235,63,63,.12)',
                border: '1px solid rgba(235,63,63,.35)',
                color: 'var(--danger)',
                padding: '1px 8px',
                fontSize: 10,
                fontWeight: 700
              }}>⚠ {count} issue{count !== 1 ? 's' : ''}</span>;
              return <tr key={i}>
                          <td style={{
                  fontSize: 12
                }}>{c.name}</td>
                          <td style={{
                  textAlign: 'center'
                }}>{countEl}</td>
                          <td style={{
                  textAlign: 'center'
                }}>{statusEl}</td>
                          <td>
                            {c.queryUrl && <TFSLink href={c.queryUrl} label="View" />}
                          </td>
                        </tr>;
            })}
              </tbody>
            </table>
          </div>
        </TableModal></div></div>
      {checks.length > 0 && (
        <div style={{ padding: 16, height: Math.max(200, checks.length * 36 + 40) }}>
          <Bar data={chartData} options={chartOpts} />
        </div>
      )}
    </div>
  );
}

// ─── Tab nav style helper ─────────────────────────────────────────────────────
const tabBtnStyle = (active) => ({
  flex: 1,
  padding: '6px 12px',
  border: 'none',
  borderRadius: 0,
  background: active ? 'var(--bg)' : 'transparent',
  color: active ? 'var(--primary-light)' : 'var(--muted)',
  fontWeight: active ? 700 : 400,
  fontSize: 12,
  cursor: 'pointer',
  transition: 'all 160ms ease',
  boxShadow: active ? '0 1px 3px rgba(0,0,0,.4)' : 'none',
  whiteSpace: 'nowrap',
});

function BVPredictabilityCard({ data, isLoading, error }) {
  const bvPlanned = data?.bvPlanned || 0;
  const bvDelivered = data?.bvDelivered || 0;
  const bvAttainmentPct = data?.bvAttainmentPct ?? (bvPlanned > 0 ? Math.round((bvDelivered / bvPlanned) * 100) : 0);
  const color = bvAttainmentPct >= 80 ? '#068443' : bvAttainmentPct >= 60 ? '#F5CC00' : '#eb3f3f';
  const progressPct = bvPlanned > 0 ? Math.min(100, Math.round((bvDelivered / bvPlanned) * 100)) : 0;
  const teams = Object.entries(data?.byTeam || {}).sort(([, a], [, b]) => (b.attainmentPct || 0) - (a.attainmentPct || 0));

  return (
    <div className="card mt-16">
      <div className="card-header">
        <div>
          <span className="card-title">🎯 PI Predictability (BV Attainment)</span>
          <div className="card-sub">Business Value planned vs delivered from PI Objectives</div>
        </div>
        {!isLoading && !error && bvPlanned > 0 && (
          <span style={{ background: `${color}22`, border: `1px solid ${color}55`, color, padding: '4px 10px', fontSize: 11, fontWeight: 700 }}>
            {bvAttainmentPct >= 80 ? 'Predictable PI' : bvAttainmentPct >= 60 ? 'Watch BV' : 'BV Risk'}
          </span>
        )}
      </div>
      <div style={{ padding: 16 }}>
        {isLoading
          ? null
          : error
            ? <div style={{ color: 'var(--danger)' }}>❌ {error.message}</div>
            : bvPlanned === 0
              ? <div style={{ color: 'var(--muted)' }}>No business value scores recorded in PI Objectives — score fields in TFS to enable</div>
              : <>
                  <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' }}>
                    <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 18 }}>
                      <div style={{ fontSize: 38, fontWeight: 800, color }}>{bvAttainmentPct}%</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>BV Attainment</div>
                      <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>Business Value planned vs delivered from PI Objectives</div>
                    </div>
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginBottom: 14 }}>
                        <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 14 }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: '#1492ff' }}>{bvPlanned}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6 }}>Planned: {bvPlanned} BV</div>
                        </div>
                        <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 14 }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: '#068443' }}>{bvDelivered}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6 }}>Delivered: {bvDelivered} BV</div>
                        </div>
                      </div>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 700, marginBottom: 8 }}>BV Progress</div>
                      <div style={{ height: 12, background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 0, overflow: 'hidden' }}>
                        <div style={{ width: `${progressPct}%`, height: '100%', background: color }} />
                      </div>
                      <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12, marginTop: 8 }}>{bvDelivered} of {bvPlanned} planned BV delivered ({bvAttainmentPct}%).</div>
                      <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12, marginTop: 12 }}>SAFe target: ≥80% BV attainment = predictable PI</div>
                    </div>
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>Per-team BV breakdown</div>
                    {teams.length > 0
                      ? <div className="table-wrap">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Team</th>
                                <th style={{ textAlign: 'center' }}>Planned BV</th>
                                <th style={{ textAlign: 'center' }}>Delivered BV</th>
                                <th style={{ textAlign: 'center' }}>Attainment %</th>
                              </tr>
                            </thead>
                            <tbody>
                              {teams.map(([team, info]) => {
                                const teamPct = info.attainmentPct ?? 0;
                                const teamColor = teamPct >= 80 ? '#068443' : teamPct >= 60 ? '#F5CC00' : '#eb3f3f';
                                return (
                                  <tr key={team}>
                                    <td>{team}</td>
                                    <td style={{ textAlign: 'center' }}>{info.bvPlanned || info.bv || 0}</td>
                                    <td style={{ textAlign: 'center' }}>{info.bvDelivered || 0}</td>
                                    <td style={{ textAlign: 'center', color: teamColor, fontWeight: 700 }}>{teamPct}%</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      : <div style={{ color: 'var(--muted)' }}>No team breakdown available.</div>}
                  </div>
                </>}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ExecutiveSection() {
  const store = useStore(s => s);
  const { selectedPIs, availablePIs, selectedTeam, ragThresholds } = store;
  const [tab, setTab] = useState('health');
  const [annPopup, setAnnPopup] = useState({ open: false, sprints: [], chartId: '' });
  const { tabVisible, chartVisible } = usePolicies();

  const pis = selectedPIs.length
    ? selectedPIs
    : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);

  const { data, isLoading, error } = useFilteredDashboard(pis, selectedTeam);
  const activePi = selectedPIs[selectedPIs.length - 1] || '';
  const { data: objData, isLoading: objLoading, error: objError } = useObjectives(pis, selectedTeam);
  const { data: piChecksData } = usePIChecks(selectedTeam);
  const { data: annData } = useAnnotations('executive', activePi, selectedTeam);
  const annItems = annData?.items || [];
  const qc = useQueryClient();

  async function handleDeleteAnnotation(id) {
    await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['annotations', 'executive'] });
  }

  function openAnnPopup(sprints, chartId = '') {
    setAnnPopup({ open: true, sprints, chartId });
  }
  const tabs = [
    { id: 'health',     label: '📊 Health' },
    { id: 'scorecard',  label: '🏅 Scorecard' },
    { id: 'objectives', label: '🎯 Objectives' },
    { id: 'pichecks',   label: '🔍 PI Checks' },
  ].filter(t => tabVisible('executive', t.id));
  const firstTab = tabs[0]?.id;

  useEffect(() => {
    if (tabs.length && !tabs.find(t => t.id === tab)) setTab(firstTab);
  }, [tabs, tab, firstTab]);

  if (isLoading) return <PageLoader label="Loading Programme Health…" />;
  if (error)     return <div style={{ padding: 24, color: 'var(--danger)' }}>❌ {error.message}</div>;

  const f = data?.features;
  const d = data?.defects;

  const storeWithData  = data ? { ...store, data } : store;
  const sectionFeatUrl = buildSectionTFSUrl(storeWithData, 'Feature', pis);
  const sectionDefUrl  = buildSectionTFSUrl(storeWithData, 'Defect',  pis);
  const readinessIssues = (piChecksData?.checks || []).reduce((sum, check) => sum + (check.count || 0), 0);
  const readinessTone = readinessIssues === 0 ? 'var(--success)' : readinessIssues <= 3 ? 'var(--warning)' : 'var(--danger)';
  const readinessBg = readinessIssues === 0 ? 'var(--success-bg)' : readinessIssues <= 3 ? 'var(--warning-bg)' : 'var(--danger-bg)';
  const readinessBorder = readinessIssues === 0 ? 'var(--success-bdr)' : readinessIssues <= 3 ? 'var(--warning-bdr)' : 'var(--danger-bdr)';

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">🏆 Programme Health</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {pis.map(pi => <span key={pi} className="pi-tag">{pi}</span>)}
          {sectionFeatUrl && <TFSLink href={sectionFeatUrl} label="Features" />}
          {sectionDefUrl  && <TFSLink href={sectionDefUrl} label="Defects" />}
        </div>
      </div>

      {f && d && (
        <>
          <div style={{
            marginBottom: 16,
            padding: '10px 14px',
            border: `1px solid ${readinessBorder}`,
            background: readinessBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ color: readinessTone, fontWeight: 700 }}>
                {readinessIssues === 0 ? 'PI readiness healthy' : `PI readiness needs attention · ${readinessIssues} issue${readinessIssues === 1 ? '' : 's'}`}
              </span>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                Based on the latest executive PI checks for the current team scope.
              </span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setTab('pichecks')}>
              Review PI Checks
            </button>
          </div>
          {chartVisible('executive', 'pi-score-hero') && <PIScoreHero f={f} d={d} store={store} pis={pis} />}
          {chartVisible('executive', 'bv-predictability') && <BVPredictabilityCard data={objData} isLoading={objLoading} error={objError} />}
          {chartVisible('executive', 'health-hero') && <HealthHero f={f} d={d} ragThresholds={ragThresholds} store={store} pis={pis} />}
        </>
      )}

      {!data && (
        <div style={{ color: 'var(--muted)', padding: 16 }}>No data available. Configure and refresh.</div>
      )}

      {data && (
        <>
          <div style={{
            display: 'flex', gap: 4, marginTop: 16,
            background: 'var(--bg-card2)', padding: 3,
            border: '1px solid var(--border)',
          }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={tabBtnStyle(tab === t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'health' && <CommittedVsDelivered f={f} store={store} pis={pis} onAddNote={openAnnPopup} />}

          {tab === 'scorecard' && (
            <TeamScorecard
              f={f}
              d={d}
              store={store}
              pis={pis}
              allItems={[...(f.items || []), ...(d.items || [])]}
            />
          )}

          {tab === 'objectives' && (
            <ObjectivesPanel pis={pis} selectedTeam={selectedTeam} onAddNote={openAnnPopup} />
          )}

          {tab === 'pichecks' && (
            <PIChecksPanel selectedTeam={selectedTeam} onAddNote={openAnnPopup} />
          )}
        </>
      )}
      <ChartAnnotations
        section="executive"
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

