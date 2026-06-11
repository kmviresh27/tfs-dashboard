import { useState, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  PointElement, LineElement,
  Title, Tooltip, Legend,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar, Chart } from 'react-chartjs-2';
import useStore from '../store/useStore.js';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/apiClient.js';
import {
  useFilteredDashboard,
  useCycleTimeDistribution,
  useDefectEscapeByQuarter,
  useAnnotations,
  useGithubCoverage,
} from '../api/hooks.js';
import { PageLoader } from '../components/ui/PageLoader.jsx';
import CopyButton from '../components/ui/CopyButton.jsx';
import ChartAnnotations, { AnnotationButton, buildAnnotationLines } from '../components/ui/ChartAnnotations.jsx';
import { SkeletonSection } from '../components/ui/SkeletonCard.jsx';
import { DataAge } from '../hooks/useDataAge.jsx';
import { openChartTFS, getPIs } from '../tfsLinks.js';
import { GitHubCoverageCard } from './TestCoverageSection.jsx';

ChartJS.register(
  CategoryScale, LinearScale, BarElement,
  PointElement, LineElement,
  Title, Tooltip, Legend, ChartDataLabels,
);

const GRID  = '#454545';
const TICK  = '#ADADAD';

const AGING_COLORS  = ['#068443', '#21837c', '#F5CC00', '#ff7f0f', '#eb3f3f'];
const TEAM_COLORS   = ['#1492ff','#068443','#eb3f3f','#ff7f0f','#858FFF','#F5CC00','#21837c','#fa7000','#e040fb','#00bcd4'];
const INHOUSE_COLOR = '#1492ff';
const INFIELD_COLOR = '#eb3f3f';
const RATIO_COLOR   = '#F5CC00';

const AGING_LABELS = ['0–7 days', '8–14 days', '15–30 days', '31–60 days', '60+ days'];

function kpiCardStyle(color) {
  return {
    background: 'var(--card)',
    border: `1px solid ${color}44`,
    borderLeft: `4px solid ${color}`,
    borderRadius: 0,
    padding: '12px 18px',
    minWidth: 140,
    flex: '1 1 140px',
  };
}

export default function HealthSection() {
  const store = useStore(s => s);
  const { selectedPIs, availablePIs, selectedTeam, currentPI, tfsBaseUrl, piFilterYear } = store;

  const pis = selectedPIs.length
    ? selectedPIs
    : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);

  // Current quarter defaults
  const { defaultYear, defaultQuarter } = useMemo(() => {
    const now = new Date();
    return {
      defaultYear:    now.getFullYear(),
      defaultQuarter: Math.ceil((now.getMonth() + 1) / 3),
    };
  }, []);

  const [selectedQ,  setSelectedQ]        = useState(null); // null = show all quarters
  const [annPopup, setAnnPopup]           = useState({ open: false, sprints: [], chartId: '' });

  // Derive escapeYear from global piFilterYear (e.g. '26' → 2026), fallback to current year
  const escapeYear = useMemo(() => {
    if (piFilterYear) return 2000 + parseInt(piFilterYear, 10);
    return defaultYear;
  }, [piFilterYear, defaultYear]);

  const activePi = selectedPIs[selectedPIs.length - 1] || currentPI || String(defaultYear);
  const { data: annData } = useAnnotations('health', activePi, selectedTeam);
  const annItems = annData?.items || [];
  const qc = useQueryClient();

  async function handleDeleteAnnotation(id) {
    await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['annotations', 'health'] });
  }

  function openAnnPopup(sprints, chartId = '') {
    setAnnPopup({ open: true, sprints, chartId });
  }

  const { data: dashData, isLoading: dashLoading, dataUpdatedAt } =
    useFilteredDashboard(pis, selectedTeam);

  // Cycle time — always fetch global (byTeam); KPI + chart filter client-side by selectedTeam
  const { data: cycleData, isLoading: cycleLoading } =
    useCycleTimeDistribution(null, 4);

  const { data: escapeData, isLoading: escapeLoading } =
    useDefectEscapeByQuarter(escapeYear, selectedTeam || undefined);

  const { data: ghData } = useGithubCoverage();

  // defects sub-object (same pattern as DefectsSection line 100)
  const d = dashData?.defects || {};

  // ── Feature Cycle Time per team ─────────────────────────────────────────────
  const teamCycleEntries = useMemo(() => {
    const raw = cycleData?.byTeam || {};
    // selectedTeam is a full area path; byTeam keys are the last segment
    const teamFilter = selectedTeam
      ? (selectedTeam.startsWith('ROOT:') ? selectedTeam.slice(5) : selectedTeam)
          .replace(/\//g, '\\').split('\\').pop()
      : null;
    return Object.entries(raw)
      .filter(([name, v]) => v.avg > 0 && (!teamFilter || name === teamFilter))
      .sort((a, b) => b[1].avg - a[1].avg);
  }, [cycleData, selectedTeam]);

  const cycleChartData = useMemo(() => ({
    labels: teamCycleEntries.map(([name]) => name),
    datasets: [{
      label: 'Avg Cycle Days',
      data:  teamCycleEntries.map(([, v]) => Math.round(v.avg)),
      backgroundColor: teamCycleEntries.map((_, i) => TEAM_COLORS[i % TEAM_COLORS.length] + 'bb'),
      borderColor:     teamCycleEntries.map((_, i) => TEAM_COLORS[i % TEAM_COLORS.length]),
      borderWidth: 2,
      borderRadius: 4,
    }],
  }), [teamCycleEntries]);

  const cycleChartOpts = useMemo(() => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      datalabels: {
        anchor: 'end', align: 'top',
        color: TICK, font: { size: 11, weight: '700' },
        formatter: v => v,
      },
      annotation: {
        annotations: buildAnnotationLines(annItems, cycleChartData.labels || [], handleDeleteAnnotation, 'health-cycle'),
      },
      tooltip: {
        callbacks: {
          label: ctx => {
            const entry = teamCycleEntries[ctx.dataIndex];
            if (!entry) return ` ${ctx.raw} days`;
            const v = entry[1];
            return [
              ` Avg: ${Math.round(v.avg)} days`,
              ` Median: ${Math.round(v.median ?? v.avg)} days`,
              ` Samples: ${v.total}`,
            ];
          },
        },
      },
    },
    scales: {
      x: { ticks: { color: TICK, font: { weight: 'bold' } }, grid: { display: false } },
      y: { ticks: { color: TICK }, grid: { color: GRID }, beginAtZero: true,
           title: { display: true, text: 'Avg Days (Forecasted → Done)', color: TICK, font: { size: 12 } } },
    },
    layout: { padding: { top: 24 } },
  }), [annItems, cycleChartData.labels, teamCycleEntries]);

  // ── Defect Aging ────────────────────────────────────────────────────────────
  const agingChartData = useMemo(() => ({
    labels: AGING_LABELS,
    datasets: [{
      label: 'Open Defects',
      data:  AGING_LABELS.map(l => d.agingBuckets?.[l] ?? 0),
      backgroundColor: AGING_COLORS.map(c => c + '99'),
      borderColor: AGING_COLORS,
      borderWidth: 2,
      borderRadius: 4,
    }],
  }), [d.agingBuckets]);

  // Defect Aging TFS click — open TFS filtered by age bucket (open defects only)
  const AGING_DATE_CLAUSES = {
    '0–7 days':   ["[System.State] NOT IN ('Resolved','Closed','Removed')", "[System.CreatedDate] >= @Today-7"],
    '8–14 days':  ["[System.State] NOT IN ('Resolved','Closed','Removed')", "[System.CreatedDate] >= @Today-14", "[System.CreatedDate] < @Today-7"],
    '15–30 days': ["[System.State] NOT IN ('Resolved','Closed','Removed')", "[System.CreatedDate] >= @Today-30", "[System.CreatedDate] < @Today-14"],
    '31–60 days': ["[System.State] NOT IN ('Resolved','Closed','Removed')", "[System.CreatedDate] >= @Today-60", "[System.CreatedDate] < @Today-30"],
    '60+ days':   ["[System.State] NOT IN ('Resolved','Closed','Removed')", "[System.CreatedDate] < @Today-60"],
  };

  const agingChartOpts = useMemo(() => ({
    indexAxis: 'y',
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      datalabels: {
        anchor: 'end', align: 'right',
        color: TICK, font: { size: 11, weight: '700' },
      },
      tooltip: { callbacks: { label: ctx => ` ${ctx.raw} open defects` } },
    },
    scales: {
      x: { ticks: { color: TICK }, grid: { color: GRID }, beginAtZero: true },
      y: { ticks: { color: TICK, font: { weight: 'bold' } }, grid: { display: false } },
    },
    layout: { padding: { right: 36 } },
    onClick: tfsBaseUrl ? (_, elements) => {
      if (!elements.length) return;
      const label = AGING_LABELS[elements[0].index];
      const clauses = AGING_DATE_CLAUSES[label];
      if (clauses) openChartTFS(store, null, 'Defect', clauses);
    } : undefined,
  }), [store, tfsBaseUrl]);

  // ── Escape Ratio by Quarter ──────────────────────────────────────────────────
  const quarterRows = useMemo(() => {
    const all = escapeData?.quarters || [];
    // Drop future quarters: for the currently-selected year, hide quarters > current quarter
    const filtered = all.filter(q => {
      if (escapeYear < defaultYear) return true;       // past year — show all
      if (escapeYear > defaultYear) return false;      // future year — show none
      return q.quarter <= defaultQuarter;              // current year — up to current quarter
    });
    return selectedQ ? filtered.filter(q => q.quarter === selectedQ) : filtered;
  }, [escapeData, selectedQ, escapeYear, defaultYear, defaultQuarter]);

  const escapeChartData = useMemo(() => ({
    labels: quarterRows.map(q => q.label),
    datasets: [
      {
        type: 'bar',
        label: 'In House',
        data: quarterRows.map(q => q.inHouse),
        backgroundColor: INHOUSE_COLOR + 'bb',
        borderColor: INHOUSE_COLOR,
        borderWidth: 2,
        borderRadius: 4,
        yAxisID: 'y',
        order: 2,
      },
      {
        type: 'bar',
        label: 'In Field (Customer)',
        data: quarterRows.map(q => q.inField),
        backgroundColor: INFIELD_COLOR + 'bb',
        borderColor: INFIELD_COLOR,
        borderWidth: 2,
        borderRadius: 4,
        yAxisID: 'y',
        order: 2,
      },
      {
        type: 'line',
        label: 'Escape Ratio %',
        data: quarterRows.map(q => q.ratio),
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        pointBackgroundColor: quarterRows.map(q => q.ratio > 15 ? '#eb3f3f' : RATIO_COLOR),
        pointBorderColor:     quarterRows.map(q => q.ratio > 15 ? '#eb3f3f' : RATIO_COLOR),
        pointRadius: 7,
        pointHoverRadius: 9,
        showLine: false,
        yAxisID: 'yRatio',
        order: 1,
      },
    ],
  }), [quarterRows]);

  const escapeChartOpts = useMemo(() => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: TICK, boxWidth: 12 } },
      datalabels: {
        display: ctx => ctx.dataset.type === 'line',
        color: ctx => ctx.dataset.pointBackgroundColor?.[ctx.dataIndex] || RATIO_COLOR,
        font: { size: 11, weight: '700' },
        anchor: 'end', align: 'top',
        formatter: v => v != null ? `${v}%` : '',
      },
      annotation: {
        annotations: {
          threshold15: {
            type: 'line',
            yMin: 15, yMax: 15,
            yScaleID: 'yRatio',
            borderColor: '#eb3f3f',
            borderWidth: 1.5,
            borderDash: [6, 4],
            label: {
              display: true,
              content: '15% threshold',
              position: 'end',
              color: '#eb3f3f',
              backgroundColor: 'rgba(0,0,0,0.55)',
              font: { size: 10, weight: '600' },
              padding: { x: 5, y: 2 },
            },
          },
          ...buildAnnotationLines(annItems, quarterRows.map(q => q.label), handleDeleteAnnotation, 'health-escape-quarterly'),
        },
      },
      tooltip: {
        mode: 'index',
        callbacks: {
          afterBody: (items) => {
            const idx   = items[0]?.dataIndex;
            const q     = quarterRows[idx];
            if (!q) return [];
            return [`Escape Ratio: ${q.ratio}% (In-Field ÷ In-House × 100)`];
          },
        },
      },
    },
    scales: {
      x: { ticks: { color: TICK }, grid: { display: false } },
      y: {
        type: 'linear', position: 'left',
        beginAtZero: true,
        ticks: { color: TICK, precision: 0 },
        grid: { color: GRID },
        title: { display: true, text: 'Defect Count', color: TICK },
      },
      yRatio: {
        type: 'linear', position: 'right',
        beginAtZero: true,
        ticks: { color: RATIO_COLOR, callback: v => `${v}%` },
        grid: { display: false },
        title: { display: true, text: 'Escape Ratio %', color: RATIO_COLOR },
      },
    },
  }), [annItems, quarterRows]);

  // ── KPI strip ───────────────────────────────────────────────────────────────
  // Derive the short team name used as key in cycleData.byTeam
  const activeTeamName = useMemo(() => {
    if (!selectedTeam) return null;
    return (selectedTeam.startsWith('ROOT:') ? selectedTeam.slice(5) : selectedTeam)
      .replace(/\//g, '\\').split('\\').pop() || null;
  }, [selectedTeam]);

  const avgCycleAll = useMemo(() => {
    const all = Object.entries(cycleData?.byTeam || {}).filter(([, v]) => v.avg > 0);
    const entries = activeTeamName ? all.filter(([name]) => name === activeTeamName) : all;
    if (!entries.length) return null;
    const sum = entries.reduce((s, [, v]) => s + v.avg, 0);
    return Math.round(sum / entries.length);
  }, [cycleData, activeTeamName]);

  const aging30Plus = useMemo(() =>
    (d.agingBuckets?.['31–60 days'] ?? 0) + (d.agingBuckets?.['60+ days'] ?? 0),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [d.agingBuckets, selectedTeam]);

  const currentQEscape = useMemo(() => {
    const q = escapeData?.quarters?.find(q => q.quarter === defaultQuarter);
    return q?.ratio ?? null;
  }, [escapeData, defaultQuarter]);

  if (dashLoading || cycleLoading) return <SkeletonSection />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text)' }}>❤️ Health</h2>
        <DataAge updatedAt={dataUpdatedAt} />
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>
          Quality &amp; delivery health indicators
        </span>
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={kpiCardStyle('#1492ff')}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
            Avg Cycle Time {activeTeamName ? `· ${activeTeamName}` : '(all teams)'}
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#1492ff' }}>
            {avgCycleAll != null ? `${avgCycleAll}d` : '—'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Forecasted → Done (last 4 PIs)</div>
        </div>
        <div style={kpiCardStyle('#eb3f3f')}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
            Defects Aging 30+ Days {activeTeamName ? `· ${activeTeamName}` : ''}
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: aging30Plus > 10 ? '#eb3f3f' : '#F5CC00' }}>
            {dashLoading ? <span style={{ fontSize: 14, opacity: 0.5 }}>…</span> : aging30Plus}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Open defects &gt; 30 days old</div>
        </div>
        <div style={kpiCardStyle('#F5CC00')}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
            Q{defaultQuarter} {defaultYear} Escape Ratio {activeTeamName ? `· ${activeTeamName}` : ''}
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: currentQEscape > 20 ? '#eb3f3f' : '#068443' }}>
            {escapeLoading
              ? <span style={{ fontSize: 14, opacity: 0.5 }}>…</span>
              : currentQEscape != null ? `${currentQEscape}%` : '—'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>In-Field ÷ In-House × 100</div>
        </div>
      </div>

      {/* ── Feature Cycle Time per Team ── */}
      <div className="card">
        <div className="card-header">
          <h3 style={{ margin: 0, fontSize: 15 }}>⏱ Feature Cycle Time per Team</h3>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Last 4 PIs · all teams</span>
            <div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(cycleChartData.labels || [], 'health-cycle')} /><CopyButton type="chart" /></div>
          </div>
        </div>
        <div style={{ position: 'relative', height: 260 }}>
          {cycleLoading
            ? <PageLoader />
            : teamCycleEntries.length === 0
              ? <p style={{ color: 'var(--muted)', padding: 16 }}>No cycle time data available. Features need to be in Done state.</p>
              : <Bar data={cycleChartData} options={cycleChartOpts} />
          }
        </div>

        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6, padding: '0 4px' }}>
          <strong style={{ color: 'var(--muted2)' }}>How calculated:</strong> For each <em>Done</em> feature,
          cycle time = <code>StateChangeDate − CreatedDate</code> (days). CreatedDate ≈ date feature entered
          Forecasted; StateChangeDate = last state transition (Done date for completed features).
          Avg is weighted mean across the last 4 PIs. Each team bar includes all features assigned
          to that team's area path.
        </div>
      </div>

      {/* ── Row: Defect Aging + Escape Ratio ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Defect Aging */}
        <div className="card">
          <div className="card-header">
            <h3 style={{ margin: 0, fontSize: 15 }}>🕐 Defect Aging</h3>
            <div className="card-actions" style={{ marginLeft: 'auto' }}><AnnotationButton onClick={() => openAnnPopup(AGING_LABELS, 'health-aging')} /><CopyButton type="chart" /></div>
          </div>
          <div style={{ position: 'relative', height: 220, cursor: tfsBaseUrl ? 'pointer' : 'default' }}>
            {dashLoading
              ? <PageLoader />
              : <Bar data={agingChartData} options={agingChartOpts} />
            }
          </div>
          {tfsBaseUrl && (
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, padding: '0 4px' }}>
              💡 Click a bar to open matching defects in TFS
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6, padding: '0 4px' }}>
            <strong style={{ color: 'var(--muted2)' }}>How calculated:</strong> Each open (non-closed) defect
            is bucketed by <code>(today − CreatedDate)</code> in days. Closed defects use their close/resolve
            date instead of today.
          </div>
        </div>

        {/* Escape Ratio by Quarter */}
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>📤 Defect Escape Ratio by Quarter — {escapeYear}</h3>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* Quarter filter pills */}
              <div style={{ display: 'flex', gap: 4 }}>
                {[null, 1, 2, 3, 4].map(q => (
                  <button
                    key={q ?? 'all'}
                    onClick={() => setSelectedQ(q)}
                    style={{
                      fontSize: 11, padding: '3px 9px', borderRadius: 12,
                      border: '1px solid',
                      borderColor: selectedQ === q ? 'var(--primary)' : 'var(--border)',
                      background:  selectedQ === q ? 'var(--primary)' : 'transparent',
                      color:       selectedQ === q ? '#fff' : 'var(--muted2)',
                      cursor: 'pointer',
                    }}
                  >
                    {q == null ? 'All' : `Q${q}`}
                  </button>
                ))}
              </div>
              <div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(quarterRows.map(q => q.label), 'health-escape-quarterly')} /><CopyButton type="chart" /></div>
            </div>
          </div>

          <div style={{ position: 'relative', height: 220 }}>
            {escapeLoading
              ? <PageLoader />
              : quarterRows.length === 0
                ? <p style={{ color: 'var(--muted)', padding: 16 }}>No defect data for {escapeYear}.</p>
                : <Chart type="bar" data={escapeChartData} options={escapeChartOpts} />
            }
          </div>

          {/* Per-quarter KPI strip */}
          {!escapeLoading && quarterRows.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {quarterRows.map(q => (
                <div key={q.label} style={{
                  flex: '1 1 90px', background: 'var(--bg)', borderRadius: 6,
                  padding: '6px 10px', textAlign: 'center',
                  border: `1px solid ${q.quarter === defaultQuarter && escapeYear === defaultYear ? 'var(--primary)' : 'var(--border)'}`,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{q.label}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: q.ratio > 20 ? '#eb3f3f' : '#068443' }}>
                    {q.ratio}%
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                    🏠 {q.inHouse} · 🌍 {q.inField}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6, padding: '0 4px' }}>
            <strong style={{ color: 'var(--muted2)' }}>How calculated:</strong> Defects created in the
            selected quarter are split by <em>How Found</em> field.
            <em> In Field</em> = "{escapeData?.inFieldLabel || 'Found In Field'}" (customer-found).
            <em> In House</em> = all other values (found internally).
            Escape Ratio = In-Field ÷ In-House × 100 (same formula as Defects page).
          </div>
        </div>
      </div>
      <ChartAnnotations
        section="health"
        chartId={annPopup.chartId || ''}
        pi={activePi}
        team={selectedTeam}
        sprints={annPopup.sprints}
        open={annPopup.open}
        setOpen={open => setAnnPopup(v => ({ ...v, open }))}
        items={annItems}
        onDelete={handleDeleteAnnotation}
      />

      {/* Unit Test Coverage (GitHub) */}
      <GitHubCoverageCard data={ghData} onAddNote={openAnnPopup} title="🧪 Unit Test Coverage" />
    </div>
  );
}
