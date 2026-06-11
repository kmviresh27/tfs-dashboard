import { useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, ScatterController, Title, Tooltip, Legend,
  LineController,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import annotationPlugin from 'chartjs-plugin-annotation';
import { Bar, Doughnut, Scatter, Line } from 'react-chartjs-2';
import useStore from '../store/useStore.js';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/apiClient.js';
import { useFilteredDashboard, usePIChecks, usePredictability, useDependencies, useCycleTimeDistribution, useTeamCapacities, useAnnotations } from '../api/hooks.js';
import { COLORS, FEATURE_STATES, TEAM_COLORS } from '../constants.js';
import { extractTeamFromPath, extractPIFromIter, formatDate, shortIter, piBadgeStyle, sprintSortKey } from '../utils.js';
import { getTeamAreaPath, getPIs, buildSectionTFSUrl, buildTFSQueryUrl, openChartTFS } from '../tfsLinks.js';
import TableModal from '../components/ui/TableModal.jsx';
import SlideshowPager from '../components/ui/SlideshowPager.jsx';
import { PageLoader } from '../components/ui/PageLoader.jsx';
import CopyButton from '../components/ui/CopyButton.jsx';
import ChartAnnotations, { AnnotationButton, buildAnnotationLines } from '../components/ui/ChartAnnotations.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { SkeletonSection } from '../components/ui/SkeletonCard.jsx';
import { usePolicies } from '../hooks/usePolicies.js';
import { TFSLink, TFSItemLink } from '../components/ui/TFSLink';

// Bucket labels must match the backend BUCKET_LABELS in src/routes/cycleTime.js
const BUCKET_LABELS = ['0–15d', '16–30d', '31–45d', '46–60d', '61–90d', '91–120d', '120+d'];

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, ScatterController, LineController, Title, Tooltip, Legend, ChartDataLabels,
  annotationPlugin,
);

const darkOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#ADADAD', boxWidth: 10 } }, datalabels: { display: false } },
  scales: {
    x: { ticks: { color: '#ADADAD' }, grid: { display: false } },
    y: { ticks: { color: '#ADADAD' }, grid: { color: '#454545' }, beginAtZero: true },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ ok, label }) {
  const style = ok
    ? { background: 'rgba(6,132,67,.15)', color: '#068443', border: '1px solid rgba(6,132,67,.3)', borderRadius: 0, padding: '2px 8px', fontSize: 11, fontWeight: 600 }
    : { background: 'rgba(235,63,63,.15)', color: '#eb3f3f', border: '1px solid rgba(235,63,63,.3)', borderRadius: 0, padding: '2px 8px', fontSize: 11, fontWeight: 600 };
  return <span style={style}>{label}</span>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LINK_LABELS = {
  'System.LinkTypes.Dependency-Forward': '→ Blocks',
  'System.LinkTypes.Dependency-Reverse': '← Blocked By',
  'System.LinkTypes.Related':            '↔ Related',
};

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ features, store, pis, chartVisible = () => true, onAddNote, annItems = [], onDeleteAnn }) {
  const [teamSummaryView, setTeamSummaryView] = useState('points'); // 'count' | 'points'
  const teams = Object.keys(features.teamBreakdown || {});
  const staleCount = (features.items || []).filter(i => i.state === 'Forecasted' || i.state === 'New').length;
  const wipCount   = features.wipCount ?? 0;
  const slipped    = features.slippedFeatures || {};

  // Capacity per team (for current/first PI)
  const firstPI = pis?.[0] || '';
  const { data: capData } = useTeamCapacities(firstPI, teams);
  const teamCapMap = capData?.teams || {};
  const hoursPerPoint = capData?.hoursPerPoint || 6;

  // WIP in TFS link
  const wipTfsUrl = (() => {
    if (!store?.tfsBaseUrl) return null;
    const area     = getTeamAreaPath(store) || store.areaPath || '';
    const iterBase = store.iterationPath;
    if (!area || !iterBase || !pis?.length) return null;
    const piParts = pis.map(pi => `[System.IterationPath] UNDER '${iterBase}\\${pi}'`);
    const wiql = `SELECT [System.Id],[System.Title],[System.State] FROM WorkItems WHERE [System.WorkItemType]='Feature' AND [System.AreaPath] UNDER '${area}' AND [System.State] IN ('Activated','Approved','In Progress') AND (${piParts.join(' OR ')}) ORDER BY [System.Id]`;
    return buildTFSQueryUrl(store.tfsBaseUrl, wiql);
  })();

  const sc = features.stateCounts || {};
  const done       = sc.Done       || 0;
  const inProgress = (sc.Activated || 0) + (sc.Approved || 0);
  const newCount   = sc.New        || 0;
  const forecast   = sc.Forecasted || 0;

  // Feature Funnel — all states
  const funnelData = {
    labels: FEATURE_STATES,
    datasets: [{
      data: FEATURE_STATES.map(s => sc[s] ?? 0),
      backgroundColor: FEATURE_STATES.map(s => COLORS.feature[s] + 'cc'),
      borderColor:     FEATURE_STATES.map(s => COLORS.feature[s]),
      borderWidth: 2,
      hoverOffset: 8,
    }],
  };
  const funnelOpts = {
    responsive: true, maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
      datalabels: { anchor: 'end', align: 'right', color: '#ADADAD', font: { size: 10, weight: '700' } },
    },
    scales: {
      x: { grid: { color: '#454545' }, ticks: { color: '#ADADAD' }, beginAtZero: true },
      y: { grid: { display: false }, ticks: { color: '#ADADAD', font: { weight: 'bold' } } },
    },
    layout: { padding: { right: 36 } },
    onClick: (evt, elements) => {
      if (!elements.length) return;
      const state = funnelData.labels[elements[0].index];
      openChartTFS(store, pis, 'Feature', [`[System.State]='${state}'`]);
    },
    onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
  };

  // Feature Progress Donut
  const progressData = {
    labels: ['Done', 'In Progress', 'New', 'Forecasted'],
    datasets: [{
      data: [done, inProgress, newCount, forecast],
      backgroundColor: [
        COLORS.feature.Done      + 'cc',
        COLORS.feature.Approved  + 'cc',
        COLORS.feature.New       + 'cc',
        COLORS.feature.Forecasted + 'cc',
      ],
      borderColor: [
        COLORS.feature.Done,
        COLORS.feature.Approved,
        COLORS.feature.New,
        COLORS.feature.Forecasted,
      ],
      borderWidth: 2,
      hoverOffset: 6,
    }],
  };
  const progressOpts = {
    responsive: true, maintainAspectRatio: false,
    cutout: '70%',
    plugins: {
      legend: { position: 'right', labels: { color: '#ADADAD', boxWidth: 10, font: { size: 11 } } },
      datalabels: { display: false },
      tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}` } },
    },
    onClick: (evt, elements) => {
      if (!elements.length) return;
      const state = progressData.labels[elements[0].index];
      openChartTFS(store, pis, 'Feature', [`[System.State]='${state}'`]);
    },
    onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
  };

  // Team breakdown — stacked (count) or velocity grouped (points)
  const tbe = features.teamBreakdownByEffort || {};
  const teamBreakdownSrc = features.teamBreakdown || {};

  // Velocity per team: Done / In Progress / Remaining Man-Days + capacity hours
  const teamVelocity = teams.map(t => {
    const b = tbe[t] || {};
    const planned   = Object.entries(b).filter(([s]) => s !== 'Removed').reduce((s, [, v]) => s + v, 0);
    const done      = b.Done || 0;
    const wip       = (b.Activated || 0) + (b.Approved || 0) + (b['In Progress'] || 0);
    const remaining = Math.max(0, planned - done - wip);
    const pct       = planned > 0 ? Math.round((done / planned) * 100) : 0;
    const capHrs    = teamCapMap[t]?.totalAvailHours ?? null;
    const capPts  = teamCapMap[t]?.capacityPoints ?? (capHrs != null ? Math.round(capHrs / hoursPerPoint) : null);
    const members = teamCapMap[t]?.members ?? null;
    return { planned, done, wip, remaining, pct, capHrs, capPts, members };
  });

  const hasCapacity = teamVelocity.some(d => d.capPts != null && d.capPts > 0);

  const teamChartData = teamSummaryView === 'points' ? {
    labels: teams,
    datasets: [
      // Stack group 'story': Done + In Progress + Remaining = Total Planned
      {
        type: 'bar', label: 'Done (days)',
        data: teamVelocity.map(d => d.done),
        backgroundColor: 'rgba(6,132,67,0.75)', borderColor: 'rgba(6,132,67,0.9)',
        borderWidth: 1, borderRadius: 0, stack: 'story', yAxisID: 'y', order: 2,
      },
      {
        type: 'bar', label: 'In Progress (days)',
        data: teamVelocity.map(d => d.wip),
        backgroundColor: 'rgba(255,180,50,0.7)', borderColor: 'rgba(255,180,50,0.9)',
        borderWidth: 1, borderRadius: 0, stack: 'story', yAxisID: 'y', order: 2,
      },
      {
        type: 'bar', label: 'Remaining (days)',
        data: teamVelocity.map(d => d.remaining),
        backgroundColor: 'rgba(99,149,255,0.45)', borderColor: 'rgba(99,149,255,0.8)',
        borderWidth: 1, borderRadius: 0, stack: 'story', yAxisID: 'y', order: 2,
      },
      // Separate group 'capacity': Dev Capacity bar for 1:1 comparison
      ...(hasCapacity ? [{
        type: 'bar', label: 'Dev Capacity (days)',
        data: teamVelocity.map(d => d.capPts),
        backgroundColor: 'rgba(220,100,255,0.5)', borderColor: 'rgba(220,100,255,0.9)',
        borderWidth: 1, borderRadius: 0, stack: 'capacity', yAxisID: 'y', order: 2,
        datalabels: { display: false },
      }] : []),
    ],
  } : {
    labels: teams,
    datasets: FEATURE_STATES.map(s => ({
      label: s,
      data: teams.map(t => teamBreakdownSrc[t]?.[s] ?? 0),
      backgroundColor: COLORS.feature[s] + '99',
      borderColor:     COLORS.feature[s],
      borderWidth: 1, borderRadius: 0,
    })),
  };

  const teamChartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#ADADAD', boxWidth: 10, padding: 8 } },
      datalabels: teamSummaryView === 'points' ? {
        display: ctx => ctx.datasetIndex === 1 && ctx.dataset.type !== 'line',
        anchor: 'end', align: 'top',
        color: '#ADADAD', font: { size: 10, weight: 'bold' },
        formatter: (_, ctx) => {
          const pct = teamVelocity[ctx.dataIndex]?.pct;
          return pct != null ? pct + '%' : '';
        },
      } : { display: false },
      annotation: {
        annotations: buildAnnotationLines(annItems, teams, onDeleteAnn, 'features-team-summary'),
      },
      tooltip: { callbacks: {
        label: ctx => {
          if (teamSummaryView !== 'points') return ` ${ctx.dataset.label}: ${ctx.raw}`;
          if (ctx.dataset.label === 'Dev Capacity (days)') return ` Dev Capacity: ${ctx.raw} days (${Math.round(ctx.raw * hoursPerPoint)} hrs)`;
          return ` ${ctx.dataset.label}: ${ctx.raw} pts`;
        },
        afterBody: (items) => {
          if (teamSummaryView !== 'points') return;
          const idx = items[0]?.dataIndex;
          if (idx == null) return;
          const v = teamVelocity[idx];
          const lines = [`Planned: ${v.planned} pts | Velocity: ${v.pct}% (${v.done} done)`];
          if (v.capPts) lines.push(`Dev Capacity: ${v.capPts} days (${Math.round(v.capPts * hoursPerPoint)} hrs @ ${hoursPerPoint}h/day)`);
          if (v.members) lines.push(`Team size: ${v.members} members`);
          return lines;
        },
      }},
    },
    scales: {
      x: { stacked: teamSummaryView === 'points', ticks: { color: '#ADADAD' }, grid: { display: false } },
      y: { stacked: teamSummaryView === 'points', ticks: { color: '#ADADAD' }, grid: { color: '#454545' }, beginAtZero: true,
           title: { display: true, text: 'Man-Days', color: '#ADADAD', font: { size: 11 } } },
    },
    onClick: (evt, elements) => {
      if (!elements.length) return;
      const teamName = teamChartData.labels[elements[0].index];
      const state    = teamSummaryView === 'points' ? null : teamChartData.datasets[elements[0].datasetIndex].label;
      const allItems = features.items || [];
      const teamItem = allItems.find(i => {
        const seg = (i.area || '').replace(/\//g, '\\').split('\\').pop();
        return seg === teamName;
      });
      let teamAreaPath = null;
      if (teamItem && store.tfsBaseUrl) {
        const area  = (teamItem.area || '').replace(/\//g, '\\');
        const roots = Array.isArray(store.teamRootPath) ? store.teamRootPath : store.teamRootPath ? [store.teamRootPath] : [];
        for (const root of roots) {
          const base = root.replace(/\\$/, '');
          if (area.startsWith(base)) {
            const rel     = area.slice(base.length + 1);
            const teamSeg = rel.split('\\')[0];
            teamAreaPath  = `${base}\\${teamSeg}`;
            break;
          }
        }
      }
      const filters = state ? [`[System.State]='${state}'`] : [];
      openChartTFS(store, pis, 'Feature', filters, teamAreaPath);
    },
    onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
  };

  // Throughput by sprint
  const tpEntries = Object.entries(features.throughputByIteration || {}).sort((a, b) => sprintSortKey(a[0]).localeCompare(sprintSortKey(b[0])));
  const tpData = {
    labels: tpEntries.map(([k]) => k.split('\\').pop() || k),
    datasets: [{
      label: 'Features Done',
      data: tpEntries.map(([, v]) => v),
      backgroundColor: '#06844399',
      borderColor: '#068443',
      borderWidth: 2,
    }],
  };
  const tpOpts = {
    ...darkOpts,
    plugins: { ...darkOpts.plugins, legend: { display: false } },
    onClick: (evt, elements) => {
      if (!elements.length) return;
      // Use the full iteration path key (e.g. "Healthcare IT\ISP\26-PI2\26-PI2 S1")
      // not just the display label, to avoid the missing PI intermediate directory bug
      const fullIterPath = tpEntries[elements[0].index]?.[0];
      if (!fullIterPath) return;
      openChartTFS(store, pis, 'Feature', [`[System.State]='Done'`, `[System.IterationPath] UNDER '${fullIterPath}'`]);
    },
    onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
  };

  return (
    <div>
      {/* KPI strip — features only */}
      <div className="kpi-strip">
        <div className="kpi-card">      <div className="kpi-val">{features.total ?? '–'}</div><div className="kpi-lbl">Total Features</div></div>
        <div className="kpi-card green"> <div className="kpi-val">{done}</div><div className="kpi-lbl">Features Done</div></div>
        <div className="kpi-card blue">  <div className="kpi-val">{features.doneRate != null ? features.doneRate + '%' : '–'}</div><div className="kpi-lbl">Done Rate</div></div>
        <div className="kpi-card muted"> <div className="kpi-val">{wipCount}</div><div className="kpi-lbl">WIP</div></div>
        <div className="kpi-card orange"><div className="kpi-val">{staleCount}</div><div className="kpi-lbl">Stale Features</div></div>
      </div>

      {/* Cycle Time Distribution — last 4 PIs, independent of PI selector */}
      {chartVisible('features', 'cycle-time') && <CycleTimeDistributionCard teamPath={store?.selectedTeam} onAddNote={onAddNote} annItems={annItems} onDeleteAnn={onDeleteAnn} />}

      {/* Feature Funnel + Team Summary */}
      <div className="charts-grid-2 mt-16">
        {chartVisible('features', 'funnel') && (
          <div className="card">
            <div className="card-header"><span className="card-title">🚀 Feature Lifecycle Funnel</span><span className="card-sub">State progression</span><div className="card-actions"><AnnotationButton onClick={() => onAddNote(FEATURE_STATES, 'features-funnel')} /><CopyButton type="chart" /></div></div>
            <div className="chart-wrap" style={{ height: 240 }}>
              <Bar data={funnelData} options={funnelOpts} />
            </div>
          </div>
        )}
        {teams.length > 0 && chartVisible('features', 'team-summary') && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">👥 Team Summary</span>
              <span className="card-sub">{teamSummaryView === 'points' ? `Development velocity · Planned vs Dev Capacity (man-days) · ${hoursPerPoint}h = 1 day` : 'Feature states per team'}</span>
              <div className="card-actions">
                <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)' }}>
                  {['count', 'points'].map(v => (
                    <button key={v} onClick={() => setTeamSummaryView(v)} style={{
                      padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
                      background: teamSummaryView === v ? 'var(--primary)' : 'transparent',
                      color: teamSummaryView === v ? '#fff' : 'var(--muted)',
                    }}>{v === 'count' ? '# Count' : '⬡ Points'}</button>
                  ))}
                </div>
                <AnnotationButton onClick={() => onAddNote(teams, 'features-team-summary')} />
                <CopyButton type="chart" />
              </div>
            </div>
            <div className="chart-wrap" style={{ height: 240 }}>
              <Bar key={`team-${teamSummaryView}-${hasCapacity}`} data={teamChartData} options={teamChartOpts} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Cycle Time Distribution (last 4 PIs) ─────────────────────────────────────

function CycleTimeDistributionCard({ teamPath, onAddNote, annItems = [], onDeleteAnn }) {
  const { data, isLoading } = useCycleTimeDistribution(teamPath, 4);
  const tfsBaseUrl = useStore(s => s.tfsBaseUrl);
  const [showTable, setShowTable] = useState(false);
  if (isLoading) return <PageLoader label="Loading cycle time distribution…" />;
  if (!data || !data.buckets?.length) return null;

  const { pis = [], total, avg, median, p25, p75, stdDev, buckets, byTeam, misassigned = [] } = data;
  const pisText   = pis.join(', ');
  const isAllTeams = !teamPath && byTeam && Object.keys(byTeam).length > 0;

  // ── Single-team histogram chart ────────────────────────────────────────────
  const labels = buckets.map(b => b.label);
  const counts = buckets.map(b => b.count);
  const maxCount = Math.max(...counts, 1);
  const gaussValues = buckets.map(b => {
    const x = (b.from + Math.min(b.to, b.from + (b.to === Infinity ? 60 : (b.to - b.from)))) / 2;
    if (avg == null || stdDev == null || stdDev === 0) return 0;
    const density = Math.exp(-0.5 * ((x - avg) / stdDev) ** 2) / (stdDev * Math.sqrt(2 * Math.PI));
    return Math.round(density * total * (buckets[0].to - buckets[0].from));
  });
  const singleChartData = {
    labels,
    datasets: [
      { type: 'bar',  label: 'Features', data: counts,
        backgroundColor: counts.map(c => c === maxCount ? 'rgba(99,149,255,0.8)' : 'rgba(99,149,255,0.45)'),
        borderColor: 'rgba(99,149,255,0.9)', borderWidth: 1, order: 2 },
      { type: 'line', label: 'Distribution curve', data: gaussValues,
        borderColor: 'rgba(255,180,50,0.9)', backgroundColor: 'transparent',
        borderWidth: 2, pointRadius: 0, tension: 0.4, order: 1 },
    ],
  };
  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#ADADAD', boxWidth: 12 } },
      datalabels: { display: false },
      annotation: {
        annotations: buildAnnotationLines(annItems, labels, onDeleteAnn, 'features-cycle-time'),
      },
      tooltip: { callbacks: { label: ctx => ctx.dataset.type === 'line' ? null : `${ctx.parsed.y} features` } },
    },
    scales: {
      x: { ticks: { color: '#ADADAD' }, grid: { display: false } },
      y: { ticks: { color: '#ADADAD' }, grid: { color: 'rgba(255,255,255,0.05)' },
           title: { display: true, text: 'Features', color: '#ADADAD', font: { size: 11 } } },
    },
  };

  // ── Per-team stacked histogram ────────────────────────────────────────────
  const teamEntries = isAllTeams
    ? Object.entries(byTeam).filter(([, s]) => s.total > 0).sort((a, b) => a[0].localeCompare(b[0]))
    : [];

  // Palette for up to 12 teams
  const STACK_PALETTE = [
    'rgba(99,149,255,0.82)', 'rgba(255,180,50,0.82)',  'rgba(80,200,120,0.82)',
    'rgba(255,100,100,0.82)','rgba(180,100,255,0.82)', 'rgba(0,210,200,0.82)',
    'rgba(255,140,0,0.82)',  'rgba(130,220,255,0.82)', 'rgba(255,80,180,0.82)',
    'rgba(180,255,100,0.82)','rgba(220,160,60,0.82)',  'rgba(100,180,255,0.82)',
  ];

  const stackedChartData = isAllTeams ? {
    labels: BUCKET_LABELS,
    datasets: teamEntries.map(([name, s], i) => ({
      label: name,
      data: (s.buckets || []).map(b => b.count),
      backgroundColor: STACK_PALETTE[i % STACK_PALETTE.length],
      borderColor:     STACK_PALETTE[i % STACK_PALETTE.length].replace('0.82', '1'),
      borderWidth: 1,
      stack: 'features',
    })),
  } : null;

  const stackedChartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: '#ADADAD', boxWidth: 12, font: { size: 11 }, padding: 10 },
      },
      datalabels: { display: false },
      annotation: {
        annotations: buildAnnotationLines(annItems, labels, onDeleteAnn, 'features-cycle-time'),
      },
      tooltip: {
        callbacks: {
          title: items => `Cycle time: ${items[0].label}`,
          label:  ctx  => `${ctx.dataset.label}: ${ctx.parsed.y} feature${ctx.parsed.y !== 1 ? 's' : ''}`,
          footer: items => {
            const total = items.reduce((s, i) => s + i.parsed.y, 0);
            return `Total: ${total} features`;
          },
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        ticks: { color: '#ADADAD' },
        grid:  { display: false },
      },
      y: {
        stacked: true,
        ticks: { color: '#ADADAD', precision: 0 },
        grid:  { color: 'rgba(255,255,255,0.05)' },
        title: { display: true, text: 'Features', color: '#ADADAD', font: { size: 11 } },
      },
    },
  };

  return (
    <div className="card mt-16">
      <div className="card-header">
        <span className="card-title">📊 Feature Cycle Time Distribution</span>
        <span className="card-sub">
          {isAllTeams ? `All teams · ${total} Done features` : `Statistical distribution · ${total} Done features`}
        </span>
        <div className="card-actions"><AnnotationButton onClick={() => onAddNote(labels, 'features-cycle-time')} /><CopyButton type="chart" /></div>
      </div>

      {/* Overall stats strip */}
      <div style={{ padding: '10px 16px 0', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {[['Avg', avg, 'd'], ['Median', median, 'd'], ['P25', p25, 'd'], ['P75', p75, 'd'], ['Std Dev', stdDev, 'd']].map(([lbl, val, suf]) => (
          <div key={lbl} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)' }}>{val != null ? val + suf : '–'}</div>
            <div style={{ fontSize: 11, color: 'var(--muted2)' }}>{lbl}</div>
          </div>
        ))}
      </div>

      {isAllTeams ? (
        /* Stacked histogram per team */
        <div className="chart-wrap" style={{ height: 300, padding: '8px 8px 0' }}>
          <Bar data={stackedChartData} options={stackedChartOpts} />
        </div>
      ) : (
        /* Single-team histogram */
        <div className="chart-wrap" style={{ height: 220, padding: '8px 8px 0' }}>
          <Bar data={singleChartData} options={chartOpts} />
        </div>
      )}

      {/* View Details button (All Teams mode) */}
      {isAllTeams && (
        <div style={{ padding: '4px 16px 0', textAlign: 'right' }}>
          <button onClick={() => setShowTable(true)}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--primary)', fontSize: 12, padding: '4px 12px', cursor: 'pointer' }}>
            View Team Details
          </button>
        </div>
      )}

      {/* Per-team stats popup modal */}
      {isAllTeams && showTable && (
        <div onClick={() => setShowTable(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', minWidth: 480, maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>📊 Feature Cycle Time — Per Team</span>
              <button onClick={() => setShowTable(false)}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '0 0 8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Team', 'Done', 'Avg', 'Median', 'P75', 'Std Dev'].map(h => (
                      <th key={h} style={{ padding: '8px 14px', textAlign: h === 'Team' ? 'left' : 'right', color: 'var(--muted2)', fontWeight: 600, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teamEntries.map(([name, s]) => (
                    <tr key={name} style={{ borderBottom: '1px solid var(--border2)' }}>
                      <td style={{ padding: '7px 14px', color: 'var(--text)' }}>{name}</td>
                      <td style={{ padding: '7px 14px', textAlign: 'right', color: 'var(--muted)' }}>{s.total}</td>
                      <td style={{ padding: '7px 14px', textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>{s.avg ?? '–'}d</td>
                      <td style={{ padding: '7px 14px', textAlign: 'right', color: 'var(--muted)' }}>{s.median ?? '–'}d</td>
                      <td style={{ padding: '7px 14px', textAlign: 'right', color: 'var(--muted)' }}>{s.p75 ?? '–'}d</td>
                      <td style={{ padding: '7px 14px', textAlign: 'right', color: 'var(--muted)' }}>{s.stdDev ?? '–'}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--muted2)', margin: '6px 16px 12px' }}>
        ℹ Based on Done features from last 4 PIs: <strong>{pisText}</strong>.
        Start = <strong>Created Date</strong>. End = <strong>State Change Date</strong> (moved to Done).
        {!isAllTeams && ' Curve = Gaussian approximation.'}
      </p>

      {/* ── Misassigned features discrepancy (all-teams view only) ── */}
      {isAllTeams && misassigned.length > 0 && (
        <div style={{
          margin: '0 16px 14px',
          background: '#ff7f0f18',
          border: '1px solid #ff7f0f66',
          borderLeft: '4px solid #ff7f0f',
          borderRadius: 4,
          padding: '8px 12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15 }}>⚠️</span>
            <span style={{ fontSize: 12, color: '#ff7f0f', fontWeight: 600 }}>
              {misassigned.length} Done feature{misassigned.length !== 1 ? 's' : ''} not assigned to a leaf scrum team — excluded from chart
            </span>
            <TableModal
              label="View details"
              title={`⚠️ Misassigned Features (${misassigned.length})`}
              csvFilename="misassigned-features.csv"
              btnStyle={{ marginLeft: 'auto', borderColor: '#ff7f0f88', color: '#ff7f0f', fontSize: 11 }}
            >
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                These Done features are assigned to a parent/intermediate area node (e.g. <em>Hercules</em>, <em>Apollo</em>) instead of a leaf scrum team.
                Move them to the correct scrum team area path in TFS to include them in the cycle time chart.
              </p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Title</th>
                    <th>Area Path (incorrect level)</th>
                  </tr>
                </thead>
                <tbody>
                  {misassigned.map(f => (
                    <tr key={f.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {tfsBaseUrl
                          ? <a href={`${tfsBaseUrl}/_workitems/edit/${f.id}`} target="_blank" rel="noreferrer" style={{ color: '#1492ff' }}>{f.id}</a>
                          : f.id}
                      </td>
                      <td>{f.title}</td>
                      <td style={{ color: '#ff7f0f', fontFamily: 'monospace', fontSize: 11 }}>{f.areaPath}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableModal>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            These features are assigned to a parent area node, not a leaf scrum team. Fix area paths in TFS to correct this.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cross-Team Dependencies ───────────────────────────────────────────────────

function CrossTeamDeps({ pis, team, tfsBaseUrl }) {
  const { data, isLoading } = useDependencies(pis, team);
  if (isLoading) return <PageLoader label="Loading dependencies…" />;
  if (!data) return null;

  const { total = 0, crossTeamCount = 0, blockedCount = 0, features = [] } = data;

  return (
    <div className="card mt-16">
      <div className="card-header"><span className="card-title">🔗 Cross-Team Dependencies</span><div className="card-actions"><TableModal label="View Dependencies" title="Cross-Team Dependencies" badge={crossTeamCount}>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Feature ID</th><th>Feature Title</th><th>Team</th>
                  <th>Link Type</th><th>Linked Item</th><th>Linked Team</th>
                </tr>
              </thead>
              <tbody>
                {features.length === 0 ? <tr><td colSpan={6} style={{
                textAlign: 'center',
                padding: 24,
                color: 'var(--success)'
              }}>No cross-team dependencies ✅</td></tr> : features.flatMap(feat => (feat.deps || []).map((dep, di) => <tr key={`${feat.id}-${dep.id}-${di}`}>
                          <td className="id-cell"><TFSItemLink id={feat.id} tfsBaseUrl={tfsBaseUrl} /></td>
                          <td className="title-cell" title={feat.title || ''}>{feat.title || '–'}</td>
                          <td style={{
                fontSize: 11
              }}>{feat.team || '–'}</td>
                          <td style={{
                fontSize: 11,
                color: dep.crossTeam ? 'var(--caution)' : undefined
              }}>
                            {LINK_LABELS[dep.linkType] || dep.linkType}
                          </td>
                          <td style={{
                fontSize: 11
              }}>
                            <TFSItemLink id={dep.id} tfsBaseUrl={tfsBaseUrl} />
                            {' '}<span style={{
                  color: 'var(--muted)'
                }}>{dep.title || ''}</span>
                          </td>
                          <td style={{
                fontSize: 11,
                color: dep.crossTeam ? 'var(--caution)' : undefined
              }}>
                            {dep.crossTeam ? `⚠ ${dep.team || '–'}` : dep.team || '–'}
                          </td>
                        </tr>))}
              </tbody>
            </table>
          </div>
        </TableModal></div></div>
      <div style={{ display: 'flex', gap: 32, padding: '12px 16px', fontSize: 13 }}>
        <span>Total links: <strong>{total}</strong></span>
        <span>Cross-team: <strong style={{ color: crossTeamCount > 0 ? 'var(--caution)' : 'var(--success)' }}>{crossTeamCount}</strong></span>
        <span>Blocked: <strong style={{ color: blockedCount > 0 ? 'var(--danger)' : 'var(--success)' }}>{blockedCount}</strong></span>
      </div>
    </div>
  );
}

// ── Features List Tab ─────────────────────────────────────────────────────────

function FeaturesListTab({ features, tfsBaseUrl, pis, selectedTeam, chartVisible = () => true }) {
  const [search, setSearch]       = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [piFilter, setPiFilter]   = useState('');
  const [sortKey, setSortKey]     = useState('');
  const [sortDir, setSortDir]     = useState('asc');

  const items = features.items || [];
  const piSet = [...new Set(items.map(i => extractPIFromIter(i.iter)).filter(Boolean))].sort();

  const filtered = items.filter(item => {
    if (stateFilter && item.state !== stateFilter) return false;
    if (piFilter && extractPIFromIter(item.iter) !== piFilter) return false;
    if (search && !item.title?.toLowerCase().includes(search.toLowerCase()) && !String(item.id).includes(search)) return false;
    return true;
  });

  const sortedRows = useMemo(() => {
    const rows = [...filtered];
    if (!sortKey) return rows;

    rows.sort((a, b) => {
      const sprintA = (a.iter || '').replace(/\//g, '\\').split('\\').pop() || '';
      const sprintB = (b.iter || '').replace(/\//g, '\\').split('\\').pop() || '';
      const valuesA = {
        id: Number(a.id) || 0,
        title: a.title || '',
        state: a.state || '',
        pi: extractPIFromIter(a.iter),
        team: extractTeamFromPath(a.area),
        sprint: sprintA,
        assignedTo: a.assignedTo || '',
        changed: a.changed ? new Date(a.changed).getTime() : 0,
      };
      const valuesB = {
        id: Number(b.id) || 0,
        title: b.title || '',
        state: b.state || '',
        pi: extractPIFromIter(b.iter),
        team: extractTeamFromPath(b.area),
        sprint: sprintB,
        assignedTo: b.assignedTo || '',
        changed: b.changed ? new Date(b.changed).getTime() : 0,
      };

      if (sortKey === 'id') return valuesA.id - valuesB.id;
      if (sortKey === 'changed') return valuesB.changed - valuesA.changed;
      return String(valuesA[sortKey]).localeCompare(String(valuesB[sortKey]), undefined, { numeric: true, sensitivity: 'base' });
    });

    return sortDir === 'desc' ? rows.reverse() : rows;
  }, [filtered, sortDir, sortKey]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(dir => dir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortIndicator = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕');

  // Stale features: Forecasted or New, sorted oldest-changed first
  const now = new Date();
  const stale = [...items]
    .filter(item => item.state === 'Forecasted' || item.state === 'New')
    .sort((a, b) => {
      const da = a.changed ? new Date(a.changed) : new Date(0);
      const db = b.changed ? new Date(b.changed) : new Date(0);
      return da - db;
    });

  // Cycle Time by Team chart
  const ct = features.cycleTime || {};
  const ctByTeam = ct.byTeam || {};
  const ctTeams  = Object.keys(ctByTeam).sort();
  const ctAvgs   = ctTeams.map(t => {
    const v = ctByTeam[t];
    return typeof v === 'object' && v !== null ? (v.avg ?? v) : v;
  });
  const ctData = {
    labels: ctTeams,
    datasets: [{
      label: 'Avg Cycle Days',
      data:  ctAvgs,
      backgroundColor: ctTeams.map((_, i) => TEAM_COLORS[i % TEAM_COLORS.length] + 'bb'),
      borderColor:     ctTeams.map((_, i) => TEAM_COLORS[i % TEAM_COLORS.length]),
      borderWidth: 1,
    }],
  };
  const ctOpts = {
    ...darkOpts,
    plugins: {
      ...darkOpts.plugins,
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: ctx => {
            const t = ctTeams[ctx.dataIndex];
            const v = ctByTeam[t];
            if (typeof v === 'object' && v !== null) {
              return [`Avg: ${v.avg}d`, `Min: ${v.min}d`, `Max: ${v.max}d`, `Count: ${v.count}`];
            }
            return ` ${ctx.raw}d`;
          },
        },
      },
    },
    scales: {
      x: { ticks: { color: '#ADADAD' }, grid: { display: false } },
      y: { ticks: { color: '#ADADAD' }, grid: { color: '#454545' }, beginAtZero: true, title: { display: true, text: 'Days', color: '#ADADAD' } },
    },
  };

  // Feature Age Distribution chart
  const ageBuckets = features.featureAge?.buckets || {};
  const ageLabels  = Object.keys(ageBuckets);
  const ageCounts  = ageLabels.map(l => ageBuckets[l]);
  const ageColors  = ['#068443aa', '#1492ffaa', '#f5a62355', '#eb3f3f55', '#eb3f3f99'];
  const ageData = {
    labels: ageLabels,
    datasets: [{
      label: 'Features',
      data:  ageCounts,
      backgroundColor: ageColors,
      borderColor: ageColors.map(c => c.replace('aa', '').replace('55', '').replace('99', '')),
      borderWidth: 2,
      borderRadius: 0,
    }],
  };
  const ageOpts = {
    ...darkOpts,
    plugins: {
      ...darkOpts.plugins,
      legend: { display: false },
      datalabels: { anchor: 'end', align: 'end', color: '#ccc', font: { size: 11 } },
    },
    layout: { padding: { top: 22 } },
  };

  // Scatter: individual Done features — X=days since first, Y=cycle time
  const doneItems = (features?.items || []).filter(i => i.state === 'Done' && i.stateChangeDate && i.created);
  const teamGroups = {};
  doneItems.forEach(item => {
    const team = extractTeamFromPath(item.area);
    const days = Math.max(0, Math.floor((new Date(item.stateChangeDate) - new Date(item.created)) / 86400000));
    if (!teamGroups[team]) teamGroups[team] = [];
    teamGroups[team].push({ x: new Date(item.created).getTime(), rawDays: days });
  });
  const allTs = doneItems.map(i => new Date(i.created).getTime());
  const minTs  = allTs.length ? Math.min(...allTs) : 0;
  const scatterDatasets = Object.entries(teamGroups).map(([team, pts], idx) => {
    const color = TEAM_COLORS[idx % TEAM_COLORS.length];
    return {
      label: team,
      data: pts.map(p => ({ x: Math.round((p.x - minTs) / 86400000), y: p.rawDays })),
      backgroundColor: color + 'bb',
      borderColor: color,
      pointRadius: 5,
      pointHoverRadius: 7,
    };
  });
  const scatterData = { datasets: scatterDatasets };
  const scatterOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#ADADAD', boxWidth: 10, padding: 8, font: { size: 11 } } },
      datalabels: { display: false },
      tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}d` } },
    },
    scales: {
      x: { type: 'linear', beginAtZero: true, ticks: { color: '#ADADAD' }, grid: { color: '#454545' },
           title: { display: true, text: 'Days since PI start', color: '#8aa3be' } },
      y: { beginAtZero: true, ticks: { color: '#ADADAD' }, grid: { color: '#454545' },
           title: { display: true, text: 'Cycle Time (days)', color: '#8aa3be' } },
    },
  };

  return (
    <div>
      {/* Feature table */}
      <div className="card-header" style={{
  marginTop: 0
}}><span className="card-title">Features</span><div className="card-actions"><TableModal label="Feature List" title="Feature List" badge={filtered.length}>
          <div className="table-controls">
            <input className="search-input" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
            <select className="filter-select" value={stateFilter} onChange={e => setStateFilter(e.target.value)}>
              <option value="">All States</option>
              {FEATURE_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="filter-select" value={piFilter} onChange={e => setPiFilter(e.target.value)}>
              <option value="">All PIs</option>
              {piSet.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('id')}>ID{sortIndicator('id')}</th>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('title')}>Title{sortIndicator('title')}</th>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('state')}>State{sortIndicator('state')}</th>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('pi')}>PI{sortIndicator('pi')}</th>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('team')}>Team{sortIndicator('team')}</th>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('sprint')}>Sprint{sortIndicator('sprint')}</th>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('assignedTo')}>Assigned To{sortIndicator('assignedTo')}</th>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('changed')}>Changed{sortIndicator('changed')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 ? <tr><td colSpan={8} style={{
              textAlign: 'center',
              color: 'var(--muted2)',
              padding: 24
            }}>No features found</td></tr> : sortedRows.map(item => {
              const team = extractTeamFromPath(item.area);
              const piLbl = extractPIFromIter(item.iter);
              const parts = (item.iter || '').replace(/\//g, '\\').split('\\');
              const sprint = parts[parts.length - 1] || '–';
              return <tr key={item.id}>
                          <td className="id-cell"><TFSItemLink id={item.id} tfsBaseUrl={tfsBaseUrl} /></td>
                          <td className="title-cell" title={item.title || ''}>{item.title || '–'}</td>
                          <td><span className={`state-badge state-${item.state}`}>{item.state}</span></td>
                          <td><span style={piBadgeStyle(piLbl)}>{piLbl || '–'}</span></td>
                          <td>{team}</td>
                          <td style={{
                  fontSize: 11,
                  color: 'var(--muted)'
                }}>{sprint}</td>
                          <td style={{
                  fontSize: 11
                }}>{item.assignedTo || '–'}</td>
                          <td style={{
                  fontSize: 11,
                  color: 'var(--muted)'
                }}>{formatDate(item.changed)}</td>
                        </tr>;
            })}
              </tbody>
            </table>
          </div>
        </TableModal></div></div>

      {/* Stale Features */}
      {stale.length > 0 && chartVisible('features', 'stale-features') && (
        <div className="card-header" style={{
  marginTop: 16
}}><span className="card-title">⚠️ Stale Features — Forecasted / New</span><div className="card-actions"><TableModal label="Stale Features" title="⚠️ Stale Features — Forecasted / New" badge={stale.length}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>ID</th><th>Title</th><th>State</th><th>Team</th><th>Iteration</th><th>Age</th></tr>
                </thead>
                <tbody>
                  {stale.map(item => {
              const changedDate = item.changed ? new Date(item.changed) : null;
              const days = changedDate ? Math.floor((now - changedDate) / 86400000) : null;
              const team = extractTeamFromPath(item.area);
              const iter = shortIter(item.iter);
              const ageColor = days == null ? 'var(--muted)' : days > 90 ? 'var(--danger)' : days > 30 ? 'var(--caution)' : 'var(--muted)';
              return <tr key={item.id}>
                        <td className="id-cell"><TFSItemLink id={item.id} tfsBaseUrl={tfsBaseUrl} /></td>
                        <td className="title-cell" title={item.title || ''}>{item.title || '–'}</td>
                        <td><span className={`state-badge state-${item.state}`}>{item.state}</span></td>
                        <td>{team}</td>
                        <td style={{
                  fontSize: 11,
                  color: 'var(--muted2)'
                }}>{iter}</td>
                        <td style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: ageColor
                }}>{days != null ? `${days}d` : '–'}</td>
                      </tr>;
            })}
                </tbody>
              </table>
            </div>
          </TableModal></div></div>
      )}

      {/* Cycle Time Summary KPI + charts */}
      {ct.count > 0 && chartVisible('features', 'cycle-time') && (
        <div className="card mt-16">
          <div className="card-header">
            <span className="card-title">⏱ Cycle Time Summary</span>
            <span className="card-sub">Programme-wide stats for Done features</span>
          </div>
          <div className="kpi-strip" style={{ padding: '12px 16px' }}>
            <div className="kpi-card">    <div className="kpi-val">{ct.avg != null ? ct.avg + 'd' : '–'}</div><div className="kpi-lbl">Avg Days</div></div>
            <div className="kpi-card green"><div className="kpi-val">{ct.min != null ? ct.min + 'd' : '–'}</div><div className="kpi-lbl">Min Days</div></div>
            <div className="kpi-card red">  <div className="kpi-val">{ct.max != null ? ct.max + 'd' : '–'}</div><div className="kpi-lbl">Max Days</div></div>
            <div className="kpi-card blue"> <div className="kpi-val">{ct.count ?? 0}</div><div className="kpi-lbl">Done Features</div></div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted2)', margin: '0 16px 12px' }}>
            ℹ Start = <strong>Created Date</strong> (proxy for Forecasted entry). End = <strong>State Change Date</strong> when moved to Done.
          </p>
        </div>
      )}

      {/* Age Distribution */}
      {ageLabels.length > 0 && chartVisible('features', 'age-distribution') && (
        <div className="card mt-16">
          <div className="card-header"><span className="card-title">Feature Age Distribution</span><div className="card-actions"><CopyButton type="chart" /></div></div>
          <div className="chart-wrap" style={{ height: 220 }}>
            <Bar data={ageData} options={ageOpts} />
          </div>
        </div>
      )}

      {/* Cross-Team Dependencies */}
      {chartVisible('features', 'dependencies') && <CrossTeamDeps pis={pis} team={selectedTeam} tfsBaseUrl={tfsBaseUrl} />}

      {/* Scatter: individual Done features */}
      {scatterDatasets.length > 0 && chartVisible('features', 'cycle-time') && (
        <div className="card mt-16">
          <div className="card-header"><span className="card-title">⏱ Cycle Time Distribution (Done Features)</span><span className="card-sub">Each dot = 1 feature • X = days since PI start • Y = days to complete</span><div className="card-actions"><CopyButton type="chart" /></div></div>
          <div className="chart-wrap" style={{ height: 280 }}>
            <Scatter data={scatterData} options={scatterOpts} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── PI Checks Tab ─────────────────────────────────────────────────────────────

function PIChecksTab({ teamPath }) {
  const [detailCheck, setDetailCheck] = useState(null);
  const { data, isLoading, error } = usePIChecks(teamPath);

  if (isLoading) return <PageLoader label="Loading PI Checks…" />;
  if (error)     return <div style={{ padding: 24, color: 'var(--danger)', fontSize: 13 }}>❌ {error.message}</div>;

  const checks      = data?.checks || [];
  const totalIssues = checks.reduce((s, c) => s + (c.count || 0), 0);

  const chartLabels  = checks.map(c => c.name.replace('[PI] ', ''));
  const chartCounts  = checks.map(c => c.count ?? 0);
  const bgColors     = chartCounts.map(n => n === 0 ? '#06844380' : n <= 3 ? '#f5a62380' : '#eb3f3f80');
  const borderColors = chartCounts.map(n => n === 0 ? '#068443'   : n <= 3 ? '#f5a623'   : '#eb3f3f');

  const piChartData = {
    labels: chartLabels,
    datasets: [{
      label: 'Issues Found',
      data:  chartCounts,
      backgroundColor: bgColors,
      borderColor:     borderColors,
      borderWidth: 1,
      borderRadius: 0,
    }],
  };
  const piChartOpts = {
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

  return (
    <div>
      {/* Summary */}
      <div style={{ marginBottom: 12 }}>
        <StatusBadge ok={totalIssues === 0} label={totalIssues > 0 ? `${totalIssues} issues` : '✅ All clear'} />
      </div>

      {/* Bar chart */}
      {checks.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="card-title">PI Check Results</span><div className="card-actions"><CopyButton type="chart" /></div></div>
          <div className="chart-wrap" style={{ height: Math.max(120, checks.length * 34) }}>
            <Bar data={piChartData} options={piChartOpts} />
          </div>
        </div>
      )}

      {/* Checks table */}
      <div className="card mt-16">
        <div className="card-header"><span className="card-title">PI Checks</span><div className="card-actions"><TableModal label="PI Checks" title="PI Checks" badge={checks.length}>
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
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {checks.length === 0 ? <tr><td colSpan={5} style={{
                textAlign: 'center',
                color: 'var(--muted)',
                padding: 24
              }}>No checks returned</td></tr> : checks.map((c, idx) => {
              const countCell = c.count === null ? <span style={{
                color: 'var(--muted)'
              }}>–</span> : c.count === 0 ? <span style={{
                color: 'var(--success)',
                fontWeight: 700
              }}>0</span> : <span style={{
                color: c.count <= 3 ? 'var(--caution)' : 'var(--danger)',
                fontWeight: 700
              }}>{c.count}</span>;
              const statusCell = c.error ? <span style={{
                color: 'var(--muted)',
                fontSize: 11
              }} title={c.error}>⚠ Not found</span> : <StatusBadge ok={c.count === 0} label={c.count === 0 ? '✅ OK' : `⚠ ${c.count} issue${c.count !== 1 ? 's' : ''}`} />;
              return <tr key={idx}>
                            <td style={{
                  fontSize: 12
                }}>{c.name}</td>
                            <td style={{
                  textAlign: 'center'
                }}>{countCell}</td>
                            <td style={{
                  textAlign: 'center'
                }}>{statusCell}</td>
                            <td>
                              {c.queryUrl ? <TFSLink href={c.queryUrl} label="Open in TFS" /> : <span style={{
                    color: 'var(--muted)',
                    fontSize: 11
                  }}>–</span>}
                            </td>
                            <td>
                              {c.count > 0 && c.items?.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setDetailCheck(c)}>Items</button>}
                            </td>
                          </tr>;
            })}
                </tbody>
              </table>
            </div>
          </TableModal></div></div>
      </div>

      {/* Detail modal */}
      {detailCheck && (
        <div className="table-modal-overlay" onClick={() => setDetailCheck(null)}>
          <div className="table-modal-panel" style={{ maxWidth: 960 }} onClick={e => e.stopPropagation()}>
            <div className="table-modal-header">
              <span className="table-modal-title">
                🔍 {detailCheck.name} — {detailCheck.count} item{detailCheck.count !== 1 ? 's' : ''}
              </span>
              <button className="table-modal-close" onClick={() => setDetailCheck(null)}>✕</button>
            </div>
            <div className="table-modal-body">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th><th>Title</th><th>Type</th><th>State</th>
                    <th>Team</th><th>Sprint</th><th>Assigned To</th>
                  </tr>
                </thead>
                <tbody>
                  {(detailCheck.items || []).length === 0
                    ? <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--muted)', padding: 16 }}>No items</td></tr>
                    : detailCheck.items.map(item => {
                        const team   = extractTeamFromPath(item.area || '');
                        const sprint = (item.iter || '').replace(/\//g, '\\').split('\\').slice(-1)[0] || '–';
                        return (
                          <tr key={item.id}>
                            <td style={{ fontSize: 11 }}>#{item.id}</td>
                            <td className="title-cell" title={item.title || ''}>{item.title || '–'}</td>
                            <td style={{ fontSize: 11, color: 'var(--muted)' }}>{item.type || '–'}</td>
                            <td>
                              <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 0, fontSize: 11, background: 'rgba(255,255,255,.08)' }}>
                                {item.state || '–'}
                              </span>
                            </td>
                            <td style={{ fontSize: 11 }}>{team || '–'}</td>
                            <td style={{ fontSize: 11, color: 'var(--muted)' }}>{sprint}</td>
                            <td style={{ fontSize: 11 }}>{item.assignedTo || '–'}</td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Feature Confidence Voting ─────────────────────────────────────────────────
// Teams self-rate each committed feature R / Y / G before or during PI Review
const CONF_KEY = 'av-confidence-votes';
const CONF_OPTS = [
  { value: 'G', label: '🟢 Green',  bg: '#06844322', border: '#068443', color: '#068443', title: 'On track — will be done' },
  { value: 'Y', label: '🟡 Amber',  bg: '#F5CC0022', border: '#F5CC00', color: '#F5CC00', title: 'At risk — needs attention' },
  { value: 'R', label: '🔴 Red',    bg: '#eb3f3f22', border: '#eb3f3f', color: '#eb3f3f', title: 'Blocked — will NOT be done' },
];

function ConfidenceVotingTab({ features, tfsBaseUrl }) {
  const [votes, setVotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CONF_KEY) || '{}'); }
    catch { return {}; }
  });
  const [notes, setNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CONF_KEY + '-notes') || '{}'); }
    catch { return {}; }
  });
  const [filter, setFilter] = useState('committed');
  const [editNote, setEditNote] = useState(null);
  const [noteText, setNoteText] = useState('');

  function vote(id, val) {
    const next = { ...votes, [id]: val };
    setVotes(next);
    localStorage.setItem(CONF_KEY, JSON.stringify(next));
  }

  function saveNote(id, text) {
    const next = { ...notes, [id]: text };
    setNotes(next);
    localStorage.setItem(CONF_KEY + '-notes', JSON.stringify(next));
    setEditNote(null);
  }

  const allFeats = (features?.items || []);
  const committed = allFeats.filter(f => f.state !== 'Done' && f.state !== 'Removed' && f.state !== 'Forecasted');
  const displayFeats = filter === 'committed' ? committed : allFeats.filter(f => f.state !== 'Removed');

  const greenCount  = displayFeats.filter(f => votes[f.id] === 'G').length;
  const amberCount  = displayFeats.filter(f => votes[f.id] === 'Y').length;
  const redCount    = displayFeats.filter(f => votes[f.id] === 'R').length;
  const unvotedCount = displayFeats.filter(f => !votes[f.id]).length;

  return (
    <div>
      {/* Info */}
      <div style={{ background: 'rgba(20,146,255,.08)', border: '1px solid rgba(20,146,255,.2)', padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--text-muted)' }}>
        <strong style={{ color: 'var(--primary-light, #1492ff)' }}>PI Confidence Voting</strong> — Rate each committed feature R/Y/G before PI Review.
        Scores are <strong style={{ color: 'var(--caution, #F5CC00)' }}>saved locally</strong> in your browser.
      </div>

      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {[
          { label: 'Green', count: greenCount,   color: '#068443', bg: '#06844322' },
          { label: 'Amber', count: amberCount,   color: '#F5CC00', bg: '#F5CC0022' },
          { label: 'Red',   count: redCount,     color: '#eb3f3f', bg: '#eb3f3f22' },
          { label: 'Unvoted', count: unvotedCount, color: 'var(--text-muted)', bg: 'transparent' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, border: `1px solid ${k.color}44`, padding: '8px 18px', minWidth: 80, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color }}>{k.count}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</div>
          </div>
        ))}
        {/* Progress bar */}
        {displayFeats.length > 0 && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${greenCount / displayFeats.length * 100}%`, background: '#068443', transition: 'width 0.3s' }} />
              <div style={{ width: `${amberCount / displayFeats.length * 100}%`, background: '#F5CC00', transition: 'width 0.3s' }} />
              <div style={{ width: `${redCount   / displayFeats.length * 100}%`, background: '#eb3f3f', transition: 'width 0.3s' }} />
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {Math.round((greenCount + amberCount + redCount) / displayFeats.length * 100)}% voted
            </span>
          </div>
        )}
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        {[
          { v: 'committed', label: `Committed (${committed.length})` },
          { v: 'all',       label: `All active (${allFeats.filter(f => f.state !== 'Removed').length})` },
        ].map(opt => (
          <button key={opt.v} onClick={() => setFilter(opt.v)} style={{
            padding: '5px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 2,
            border: `1px solid ${filter === opt.v ? 'var(--primary)' : 'var(--border)'}`,
            background: filter === opt.v ? 'rgba(20,146,255,.15)' : 'transparent',
            color: filter === opt.v ? 'var(--primary-light, #1492ff)' : 'var(--text-muted)',
          }}>{opt.label}</button>
        ))}
        <button onClick={() => {
          const reset = {};
          localStorage.setItem(CONF_KEY, JSON.stringify(reset));
          setVotes(reset);
        }} style={{ padding: '5px 12px', fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 2, marginLeft: 'auto' }}>
          Reset all votes
        </button>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrap">
          <table className="data-table" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 80 }} />
              <col />
              <col style={{ width: 80 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 200 }} />
            </colgroup>
            <thead>
              <tr>
                <th>ID</th>
                <th>Feature</th>
                <th>State</th>
                <th style={{ textAlign: 'center' }}>Confidence</th>
                <th>Team</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {displayFeats.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No features to vote on</td></tr>
              ) : displayFeats.map(f => {
                const cv = votes[f.id];
                const opt = CONF_OPTS.find(o => o.value === cv);
                return (
                  <tr key={f.id} style={{ borderLeft: cv ? `3px solid ${opt?.border}` : '3px solid transparent' }}>
                    <td style={{ fontSize: 11, fontFamily: 'Consolas,monospace' }}>
                      <TFSItemLink id={f.id} tfsBaseUrl={tfsBaseUrl} />
                    </td>
                    <td style={{ fontSize: 12 }} title={f.title}>{f.title}</td>
                    <td style={{ fontSize: 11 }}>{f.state}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        {CONF_OPTS.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => vote(f.id, cv === opt.value ? null : opt.value)}
                            title={opt.title}
                            style={{
                              padding: '4px 8px', fontSize: 11, cursor: 'pointer', borderRadius: 2,
                              border: `1px solid ${cv === opt.value ? opt.border : 'var(--border)'}`,
                              background: cv === opt.value ? opt.bg : 'transparent',
                              color: cv === opt.value ? opt.color : 'var(--text-muted)',
                              fontWeight: cv === opt.value ? 700 : 400,
                              transition: 'all 0.15s',
                            }}
                          >{opt.label.split(' ')[0]}</button>
                        ))}
                      </div>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.team || '–'}</td>
                    <td>
                      {editNote === f.id ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input
                            value={noteText}
                            onChange={e => setNoteText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveNote(f.id, noteText); if (e.key === 'Escape') setEditNote(null); }}
                            autoFocus
                            placeholder="Add note…"
                            style={{ flex: 1, fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--primary)', color: 'var(--text)', padding: '2px 6px' }}
                          />
                          <button onClick={() => saveNote(f.id, noteText)} style={{ fontSize: 10, padding: '2px 6px', background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer' }}>✓</button>
                          <button onClick={() => setEditNote(null)} style={{ fontSize: 10, padding: '2px 6px', background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
                        </div>
                      ) : (
                        <span
                          onClick={() => { setEditNote(f.id); setNoteText(notes[f.id] || ''); }}
                          style={{ fontSize: 11, color: notes[f.id] ? 'var(--text)' : 'var(--text-muted)', cursor: 'pointer' }}
                          title="Click to edit note"
                        >
                          {notes[f.id] || '+ add note'}
                        </span>
                      )}
                    </td>
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

// ── WSJF Tab ─────────────────────────────────────────────────────────────────
// Weighted Shortest Job First = (BV + TC + RR) / Job Size
// Scores use SAFe Fibonacci: 1, 2, 3, 5, 8, 13, 20

const WSJF_FIBS = [1, 2, 3, 5, 8, 13, 20];
const WSJF_KEY  = 'av-wsjf-scores';

function WSJFTab({ features, tfsBaseUrl }) {
  const [scores, setScores] = useState(() => {
    try { return JSON.parse(localStorage.getItem(WSJF_KEY) || '{}'); }
    catch { return {}; }
  });
  const [filter, setFilter] = useState('active');

  function updateScore(id, field, val) {
    setScores(prev => {
      const next = { ...prev, [id]: { bv: 1, tc: 1, rr: 1, js: 1, ...(prev[id] || {}), [field]: Number(val) } };
      localStorage.setItem(WSJF_KEY, JSON.stringify(next));
      return next;
    });
  }

  function getVal(id, field)  { return scores[id]?.[field] ?? 1; }
  function wsjf(id) {
    const bv = getVal(id, 'bv'), tc = getVal(id, 'tc'), rr = getVal(id, 'rr'), js = getVal(id, 'js');
    return Math.round((bv + tc + rr) / js * 100) / 100;
  }

  const allFeatures = (features?.items || []);
  const visFeatures = allFeatures
    .filter(f => filter === 'all' || (f.state !== 'Done' && f.state !== 'Removed'))
    .map(f => ({ ...f, wsjfScore: wsjf(f.id) }))
    .sort((a, b) => b.wsjfScore - a.wsjfScore);

  function ScoreCell({ id, field, title: ttl }) {
    return (
      <select
        value={getVal(id, field)}
        onChange={e => updateScore(id, field, e.target.value)}
        title={ttl}
        style={{ background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: 11, padding: '2px 4px', width: 52, borderRadius: 2 }}
      >
        {WSJF_FIBS.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
    );
  }

  return (
    <div>
      <div style={{ background: 'rgba(20,146,255,.08)', border: '1px solid rgba(20,146,255,.2)', padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--text-muted)' }}>
        <strong style={{ color: 'var(--primary-light, #1492ff)' }}>WSJF</strong> = (Business Value + Time Criticality + Risk Reduction) ÷ Job Size
        &nbsp;·&nbsp; Score using SAFe Fibonacci (1–20) &nbsp;·&nbsp;
        <strong style={{ color: 'var(--caution, #F5CC00)' }}>Scores saved locally in your browser</strong>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <input type="radio" checked={filter === 'active'} onChange={() => setFilter('active')} /> Active features only
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
          <input type="radio" checked={filter === 'all'}    onChange={() => setFilter('all')} /> All features
        </label>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{visFeatures.length} features ranked</span>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data-table" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 40 }} />
              <col style={{ width: 72 }} />
              <col />
              <col style={{ width: 60 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 80 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: 'center' }}>#</th>
                <th style={{ textAlign: 'center', color: '#F5CC00' }}>WSJF ↓</th>
                <th>Feature</th>
                <th style={{ textAlign: 'center' }} title="Business Value (1-20)">BV</th>
                <th style={{ textAlign: 'center' }} title="Time Criticality (1-20)">TC</th>
                <th style={{ textAlign: 'center' }} title="Risk Reduction / Opportunity Enablement (1-20)">RR</th>
                <th style={{ textAlign: 'center' }} title="Job Size (1-20)">JS</th>
                <th>State</th>
                <th>Team</th>
              </tr>
            </thead>
            <tbody>
              {visFeatures.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>No features to score</td></tr>
              ) : visFeatures.map((f, idx) => {
                const rank = idx + 1;
                const scoreColor = rank === 1 ? 'var(--success)' : rank <= 3 ? 'var(--caution, #F5CC00)' : 'var(--text)';
                return (
                  <tr key={f.id}>
                    <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>{rank}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, color: scoreColor }}>{f.wsjfScore}</td>
                    <td style={{ maxWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                        <span style={{ flexShrink: 0 }}><TFSItemLink id={f.id} tfsBaseUrl={tfsBaseUrl} /></span>
                        <span style={{ fontSize: 12, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={f.title}>{f.title}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}><ScoreCell id={f.id} field="bv" title="Business Value" /></td>
                    <td style={{ textAlign: 'center' }}><ScoreCell id={f.id} field="tc" title="Time Criticality" /></td>
                    <td style={{ textAlign: 'center' }}><ScoreCell id={f.id} field="rr" title="Risk Reduction" /></td>
                    <td style={{ textAlign: 'center' }}><ScoreCell id={f.id} field="js" title="Job Size" /></td>
                    <td style={{ fontSize: 11 }}>{f.state || '–'}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.team || '–'}</td>
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

// ── Predictability Tab ────────────────────────────────────────────────────────

function PredGauge({ pct, title }) {
  const val   = pct ?? 0;
  const done  = Math.max(0, Math.min(100, val));
  const rest  = 100 - done;
  const color = done >= 80 ? '#068443' : done >= 50 ? '#F5CC00' : '#eb3f3f';
  const data = {
    datasets: [{
      data: [done, rest],
      backgroundColor: [color, '#333'],
      borderWidth: 0,
    }],
  };
  const opts = {
    responsive: true, maintainAspectRatio: false,
    cutout: '72%',
    plugins: { legend: { display: false }, datalabels: { display: false }, tooltip: { enabled: false } },
  };
  return (
    <div style={{ position:'relative', width:140, height:140 }}>
      <Doughnut data={data} options={opts} />
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
        <span style={{ fontSize:22, fontWeight:700, color }}>{pct != null ? pct + '%' : '–'}</span>
        <span style={{ fontSize:10, color:'var(--muted2)', marginTop:2 }}>{title}</span>
      </div>
    </div>
  );
}

function PredictabilityTab({ teamPath }) {
  const activeSnapshotId    = useStore(s => s.activeSnapshotId);
  const activeSnapshotLabel = useStore(s => s.activeSnapshotLabel);

  const { data, isLoading, error } = usePredictability(activeSnapshotId, teamPath);

  if (!activeSnapshotId) {
    return (
      <div style={{ padding:24, color:'var(--muted2)', textAlign:'center', fontSize:13 }}>
        No PI Plan Data selected — open <strong>📋 PI Plan Data</strong> in topbar to compare.
      </div>
    );
  }

  if (isLoading) return <PageLoader label="Loading predictability data…" />;
  if (error)     return <div style={{ padding:24, color:'var(--danger)' }}>❌ {error.message}</div>;
  if (!data)     return null;

  const { planned = {}, stretch = {}, byTeam = {}, features = [] } = data;

  const totalUnestimated = (planned.unestimated || 0) + (stretch.unestimated || 0);

  // Team bar chart
  const tTeams = Object.keys(byTeam).sort();
  const teamBarData = {
    labels: tTeams,
    datasets: [
      {
        label: 'Planned %',
        data:  tTeams.map(t => byTeam[t]?.plannedPct ?? 0),
        backgroundColor: '#1492ffbb',
        borderColor: '#1492ff',
        borderWidth: 1,
      },
      {
        label: 'Stretch %',
        data:  tTeams.map(t => byTeam[t]?.stretchPct ?? 0),
        backgroundColor: '#21837c99',
        borderColor: '#21837c',
        borderWidth: 1,
      },
    ],
  };
  const teamBarOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#ADADAD', boxWidth: 10, padding: 8 } },
      datalabels: { display: false },
    },
    scales: {
      x: { ticks: { color: '#ADADAD' }, grid: { display: false } },
      y: { ticks: { color: '#ADADAD' }, grid: { color: '#454545' }, beginAtZero: true, max: 100 },
    },
  };

  const ragClass = (pct) => pct == null ? '' : pct >= 80 ? 'green' : pct >= 50 ? 'amber' : 'red';

  return (
    <div>
      <div style={{ marginBottom:12, fontSize:12, color:'var(--muted2)' }}>
        Comparing against: <strong style={{ color:'var(--primary-light)' }}>{activeSnapshotLabel || activeSnapshotId}</strong>
      </div>

      {totalUnestimated > 0 && (
        <div style={{ marginBottom:12, fontSize:12, padding:'6px 12px', background:'rgba(245,166,35,.1)', border:'1px solid rgba(245,166,35,.3)', color:'var(--caution)' }}>
          ⚠ {totalUnestimated} feature{totalUnestimated > 1 ? 's' : ''} without effort estimate — counted as 1 unit each
        </div>
      )}

      {/* KPI strip */}
      <div className="kpi-strip">
        <div className="kpi-card blue">   <div className="kpi-val">{planned.totalEffort ?? '–'}</div><div className="kpi-lbl">Planned Effort</div></div>
        <div className="kpi-card green">  <div className="kpi-val">{planned.doneEffort  ?? '–'}</div><div className="kpi-lbl">Planned Done</div></div>
        <div className={`kpi-card ${ragClass(planned.predictabilityPct)}`}>
          <div className="kpi-val">{planned.predictabilityPct != null ? planned.predictabilityPct + '%' : '–'}</div>
          <div className="kpi-lbl">Planned %</div>
        </div>
        <div className="kpi-card blue">   <div className="kpi-val">{stretch.totalEffort ?? '–'}</div><div className="kpi-lbl">Stretch Effort</div></div>
        <div className="kpi-card teal">   <div className="kpi-val">{stretch.doneEffort  ?? '–'}</div><div className="kpi-lbl">Stretch Done</div></div>
        <div className={`kpi-card ${ragClass(stretch.predictabilityPct)}`}>
          <div className="kpi-val">{stretch.predictabilityPct != null ? stretch.predictabilityPct + '%' : '–'}</div>
          <div className="kpi-lbl">Stretch %</div>
        </div>
      </div>

      {/* Gauges + team bar */}
      <div className="charts-grid-2 mt-16">
        <div className="card">
          <div className="card-header"><span className="card-title">Predictability Gauges</span></div>
          <div style={{ display:'flex', gap:32, justifyContent:'center', alignItems:'center', padding:'16px 0' }}>
            <PredGauge pct={planned.predictabilityPct} title="Planned" />
            <PredGauge pct={stretch.predictabilityPct} title="Stretch" />
          </div>
        </div>
        {tTeams.length > 0 && (
          <div className="card">
            <div className="card-header"><span className="card-title">Team Predictability</span></div>
            <div style={{ height:220 }}>
              <Bar data={teamBarData} options={teamBarOpts} />
            </div>
          </div>
        )}
      </div>

      {/* Comparison table */}
      <div className="card mt-16">
        <div className="card-header"><span className="card-title">Feature Comparison</span><div className="card-actions"><TableModal label="View Comparison" title="Feature vs Snapshot Comparison" badge={features.length}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th><th>Title</th><th>Type</th><th>Snapshot State</th>
                    <th>Live State</th><th>Effort</th><th>Team</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {features.length === 0 ? <tr><td colSpan={8} style={{
                textAlign: 'center',
                color: 'var(--muted2)',
                padding: 24
              }}>No features in PI Plan Data</td></tr> : features.map(f => {
              const stateChanged = f.snapshotState !== f.liveState;
              return <tr key={f.id}>
                          <td className="id-cell">#{f.id}</td>
                          <td className="title-cell" title={f.title || ''}>{f.title || '–'}</td>
                          <td>
                            <span style={{
                    fontSize: 11,
                    padding: '1px 6px',
                    background: f.type === 'Stretch' ? '#1492ff33' : 'rgba(255,255,255,.08)',
                    color: f.type === 'Stretch' ? '#1492ff' : 'var(--muted2)'
                  }}>
                              {f.type}
                            </span>
                          </td>
                          <td style={{
                  fontSize: 12
                }}>{f.snapshotState || '–'}</td>
                          <td style={{
                  fontSize: 12,
                  color: stateChanged ? 'var(--warning)' : undefined
                }}>
                            {f.liveState || '–'}
                          </td>
                          <td style={{
                  textAlign: 'center'
                }}>{f.effort ?? '–'}</td>
                          <td style={{
                  fontSize: 12
                }}>{f.team || '–'}</td>
                          <td>
                            {f.done ? <span style={{
                    fontSize: 11,
                    color: 'var(--success)',
                    fontWeight: 600
                  }}>✅ Done</span> : <span style={{
                    fontSize: 11,
                    color: 'var(--warning)'
                  }}>⏳ Not Done</span>}
                          </td>
                        </tr>;
            })}
                </tbody>
              </table>
            </div>
          </TableModal></div></div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function FeaturesSection() {
  const store = useStore(s => s);
  const [tab, setTab] = useState('overview');
  const { tabVisible, chartVisible } = usePolicies();

  const { selectedPIs, availablePIs, selectedTeam, tfsBaseUrl } = store;
  const pis      = selectedPIs.length ? selectedPIs : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);
  const teamPath = getTeamAreaPath(store);
  const [annPopup, setAnnPopup] = useState({ open: false, sprints: [], chartId: '' });
  const activePi = selectedPIs[selectedPIs.length - 1] || '';

  const { data, isLoading, error } = useFilteredDashboard(pis, selectedTeam);
  const { data: annData } = useAnnotations('features', activePi, selectedTeam);
  const annItems = annData?.items || [];
  const qc = useQueryClient();

  async function handleDeleteAnnotation(id) {
    await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['annotations', 'features'] });
  }

  function openAnnPopup(sprints, chartId = '') {
    setAnnPopup({ open: true, sprints, chartId });
  }
  const TABS = [
    { id: 'overview',       label: 'Overview' },
    { id: 'features',       label: 'Features' },
    { id: 'confidence',     label: '🎯 Confidence' },
    { id: 'wsjf',           label: 'WSJF' },
    { id: 'pi-checks',      label: 'PI Checks' },
    { id: 'predictability', label: 'Predictability' },
  ].filter(t => tabVisible('features', t.id));
  const firstTab = TABS[0]?.id;

  useEffect(() => {
    if (TABS.length && !TABS.find(t => t.id === tab)) setTab(firstTab);
  }, [TABS, tab, firstTab]);

  if (isLoading) return <SkeletonSection />;
  if (error)     return <div style={{ padding: 24, color: 'var(--danger)' }}>❌ {error.message}</div>;

  const features = data?.features;
  if (!features?.items?.length) {
    return (
      <EmptyState
        title="No Features Found"
        message="No features match the current PI and team filters."
        icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>}
      />
    );
  }

  const tfsUrl    = buildSectionTFSUrl(store, 'Feature', pis);
  const defTfsUrl = buildSectionTFSUrl(store, 'Defect', pis);

  const slideshowRunning = store.slideshowRunning;

  if (slideshowRunning) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="section-header" style={{ flexShrink: 0 }}>
          <h1 className="section-title">🚀 Features</h1>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {pis.map(pi => <span key={pi} className="pi-tag">{pi}</span>)}
            {tfsUrl && <TFSLink href={tfsUrl} label="Features" />}
            {defTfsUrl && <TFSLink href={defTfsUrl} label="Defects" />}
          </div>
        </div>
        <SlideshowPager label="🚀 Features" pages={[
          <div style={{ height: '100%', overflowY: 'hidden' }}><OverviewTab features={features} store={store} pis={pis} chartVisible={chartVisible} onAddNote={openAnnPopup} annItems={annItems} onDeleteAnn={handleDeleteAnnotation} /></div>,
          <div style={{ height: '100%', overflowY: 'hidden' }}><FeaturesListTab features={features} tfsBaseUrl={tfsBaseUrl} pis={pis} selectedTeam={selectedTeam} chartVisible={chartVisible} /></div>,
          <div style={{ height: '100%', overflowY: 'hidden' }}><CrossTeamDeps pis={pis} team={selectedTeam} tfsBaseUrl={tfsBaseUrl} /></div>,
          <div style={{ height: '100%', overflowY: 'hidden' }}><PIChecksTab teamPath={teamPath} /></div>,
        ]} />
        <ChartAnnotations
          section="features"
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

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">🚀 Features</h1>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {pis.map(pi => <span key={pi} className="pi-tag">{pi}</span>)}
          {tfsUrl && <TFSLink href={tfsUrl} label="Features" />}
          {defTfsUrl && <TFSLink href={defTfsUrl} label="Defects" />}
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '6px 14px', borderRadius: 0, border: '1px solid var(--border)',
              background: tab === t.id ? 'var(--primary, #1492ff)' : 'var(--surface2, #232323)',
              color: tab === t.id ? '#fff' : 'var(--muted)',
              cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 700 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview'       && <OverviewTab features={features} store={store} pis={pis} chartVisible={chartVisible} onAddNote={openAnnPopup} annItems={annItems} onDeleteAnn={handleDeleteAnnotation} />}
      {tab === 'features'       && <FeaturesListTab features={features} tfsBaseUrl={tfsBaseUrl} pis={pis} selectedTeam={selectedTeam} chartVisible={chartVisible} />}
      {tab === 'confidence'     && <ConfidenceVotingTab features={features} tfsBaseUrl={tfsBaseUrl} />}
      {tab === 'wsjf'           && <WSJFTab features={features} tfsBaseUrl={tfsBaseUrl} />}
      {tab === 'pi-checks'      && <PIChecksTab teamPath={teamPath} />}
      {tab === 'predictability' && <PredictabilityTab teamPath={teamPath} />}
      <ChartAnnotations
        section="features"
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

