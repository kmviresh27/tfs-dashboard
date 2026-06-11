import { useMemo, useState } from 'react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Filler,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import useStore from '../store/useStore.js';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/apiClient.js';
import { useVelocity, useDefectDensityTrend, useFilteredDashboard, useAnnotations } from '../api/hooks.js';
import { PageLoader } from '../components/ui/PageLoader.jsx';
import CopyButton from '../components/ui/CopyButton.jsx';
import ChartAnnotations, { AnnotationButton, buildAnnotationLines } from '../components/ui/ChartAnnotations.jsx';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Filler,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  ChartDataLabels,
);

const GOOD = '#068443';
const BAD = '#eb3f3f';
const NEUTRAL = '#ADADAD';
const GRID = '#454545';
const TICK = '#ADADAD';

function formatDensity(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : '0.00';
}

function formatDelta(value) {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

function summarizeTeam(team) {
  if (!team) return null;
  return team.replace(/^ROOT:/, '').split('\\').filter(Boolean).pop() || team;
}

function summarizeHost(url) {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

function statusMeta(improving) {
  if (improving == null) return { color: NEUTRAL, icon: '•', text: 'Baseline', emoji: '⚪' };
  return improving
    ? { color: GOOD, icon: '↓', text: 'Improving', emoji: '🟢' }
    : { color: BAD, icon: '↑', text: 'Worsening', emoji: '🔴' };
}

function normalizeVelocityEntry(entry) {
  if (!entry) return null;
  const piEnd = entry.piEnd || entry.summary || entry;
  const sprints = Array.isArray(entry.sprints) ? entry.sprints : [];
  const doneCount = Number(piEnd.totalDone ?? piEnd.done ?? piEnd.completed ?? entry.totalDone ?? entry.done ?? entry.completed ?? 0);
  const totalCount = Number(piEnd.total ?? piEnd.totalCount ?? piEnd.planned ?? entry.total ?? entry.totalCount ?? entry.planned ?? 0);
  const donePoints = Number(piEnd.totalDonePoints ?? piEnd.donePoints ?? piEnd.completedSP ?? entry.totalDonePoints ?? entry.donePoints ?? entry.completedSP ?? 0);
  const deliveryRate = Number.isFinite(piEnd.deliveryRate)
    ? piEnd.deliveryRate
    : (totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : null);
  const avgSprintDone = sprints.length
    ? Math.round((sprints.reduce((sum, sprint) => sum + Number(sprint.totalDone ?? sprint.completed ?? 0), 0) / sprints.length) * 10) / 10
    : null;
  const avgSprintPoints = sprints.length
    ? Math.round((sprints.reduce((sum, sprint) => sum + Number(sprint.totalDonePoints ?? sprint.completedSP ?? sprint.points ?? 0), 0) / sprints.length) * 10) / 10
    : null;

  return {
    pi: entry.pi || entry.label,
    doneCount,
    totalCount,
    donePoints,
    deliveryRate,
    avgSprintDone,
    avgSprintPoints,
  };
}

export default function CrossPITrendSection() {
  const { availablePIs, selectedPIs, selectedTeam, tfsBaseUrl } = useStore(s => s);
  const [annPopup, setAnnPopup] = useState({ open: false, sprints: [], chartId: '' });

  const allPIs = useMemo(
    () => availablePIs.filter(pi => pi.isPast || pi.isCurrent).map(pi => pi.label),
    [availablePIs],
  );

  const { data: velocityData } = useVelocity(allPIs, null);
  const { data: densityData, isLoading: densityLoading, error: densityError } = useDefectDensityTrend(allPIs, null);
  const { data: dashData } = useFilteredDashboard(allPIs, null);
  const activePi = selectedPIs[selectedPIs.length - 1] || '';
  const { data: annData } = useAnnotations('cross-pi', activePi, selectedTeam);
  const annItems = annData?.items || [];
  const qc = useQueryClient();

  async function handleDeleteAnnotation(id) {
    await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['annotations', 'cross-pi'] });
  }

  function openAnnPopup(sprints, chartId = '') {
    setAnnPopup({ open: true, sprints, chartId });
  }

  const velocityByPI = useMemo(() => {
    const raw = velocityData?.piSummary || velocityData?.byPI || velocityData?.velocity || velocityData?.completed || [];
    const normalized = Array.isArray(raw)
      ? raw
      : Object.entries(raw || {}).map(([pi, value]) => ({ pi, ...(value || {}) }));

    return normalized
      .map(normalizeVelocityEntry)
      .filter(item => item?.pi)
      .reduce((map, item) => map.set(item.pi, item), new Map());
  }, [velocityData]);

  const rows = useMemo(() => {
    const trend = densityData?.trend || [];
    return trend.map((point, index, source) => {
      const prevDensity = index > 0 ? Number(source[index - 1]?.liveDensity ?? NaN) : null;
      const velocity = velocityByPI.get(point.pi);
      const totalFeatures = Number(velocity?.totalCount) > 0 ? Number(velocity.totalCount) : Number(point.liveFeatures ?? 0);
      const doneCount = Number.isFinite(velocity?.doneCount) ? Number(velocity.doneCount) : null;
      const donePct = totalFeatures > 0 && doneCount != null ? Math.round((doneCount / totalFeatures) * 100) : null;
      const deltaDensity = prevDensity == null || Number.isNaN(prevDensity)
        ? null
        : prevDensity > 0
          ? ((Number(point.liveDensity ?? 0) - prevDensity) / prevDensity) * 100
          : Number(point.liveDensity ?? 0) === 0 ? 0 : null;
      const improving = prevDensity == null || Number.isNaN(prevDensity)
        ? null
        : Number(point.liveDensity ?? 0) <= prevDensity;

      return {
        pi: point.pi,
        liveDensity: Number(point.liveDensity ?? 0),
        liveDefects: Number(point.liveDefects ?? 0),
        liveFeatures: Number(point.liveFeatures ?? 0),
        totalFeatures,
        doneCount,
        donePct,
        deltaDensity,
        improving,
        donePoints: Number(velocity?.donePoints ?? 0),
        deliveryRate: Number.isFinite(velocity?.deliveryRate) ? Number(velocity.deliveryRate) : donePct,
        avgSprintDone: Number.isFinite(velocity?.avgSprintDone) ? Number(velocity.avgSprintDone) : null,
        avgSprintPoints: Number.isFinite(velocity?.avgSprintPoints) ? Number(velocity.avgSprintPoints) : null,
      };
    });
  }, [densityData, velocityByPI]);

  const selectedTeamLabel = useMemo(() => summarizeTeam(selectedTeam), [selectedTeam]);
  const sourceHost = useMemo(() => summarizeHost(tfsBaseUrl), [tfsBaseUrl]);

  const densityLineData = useMemo(() => ({
    labels: rows.map(row => row.pi),
    datasets: [{
      label: 'Defects per Feature',
      data: rows.map(row => row.liveDensity),
      borderColor: BAD,
      backgroundColor: 'rgba(235,63,63,0.12)',
      fill: true,
      borderWidth: 2.5,
      pointRadius: 5,
      pointBackgroundColor: rows.map((row, index, source) => (
        index === 0 ? NEUTRAL : row.liveDensity <= source[index - 1].liveDensity ? GOOD : BAD
      )),
      pointBorderColor: '#101010',
      pointBorderWidth: 1,
      tension: 0.3,
    }],
  }), [rows]);

  const velocityChartData = useMemo(() => ({
    labels: rows.map(row => row.pi),
    datasets: [
      {
        label: 'Avg Features Done / Sprint',
        data: rows.map(row => row.avgSprintDone),
        borderColor: '#1492ff',
        backgroundColor: 'rgba(20,146,255,0.12)',
        pointBackgroundColor: '#1492ff',
        pointRadius: 4,
        borderWidth: 2.5,
        tension: 0.3,
        yAxisID: 'y',
      },
      {
        label: 'Avg Points / Sprint',
        data: rows.map(row => row.avgSprintPoints),
        borderColor: '#F5CC00',
        backgroundColor: 'rgba(245,204,0,0.10)',
        pointBackgroundColor: '#F5CC00',
        pointRadius: 4,
        borderWidth: 2,
        tension: 0.3,
        yAxisID: 'y1',
      },
    ],
  }), [rows]);

  const defectsBarData = useMemo(() => ({
    labels: rows.map(row => row.pi),
    datasets: [{
      label: 'Live Defects',
      data: rows.map(row => row.liveDefects),
      backgroundColor: '#eb3f3f88',
      borderColor: BAD,
      borderWidth: 1,
      borderRadius: 0,
    }, {
      label: 'Features',
      data: rows.map(row => row.liveFeatures),
      backgroundColor: '#1492ff44',
      borderColor: '#1492ff',
      borderWidth: 1,
      borderRadius: 0,
    }],
  }), [rows]);

  const aggregateFeatures = Number.isFinite(Number(dashData?.features?.total))
    ? Number(dashData.features.total)
    : rows.reduce((sum, row) => sum + row.liveFeatures, 0);
  const aggregateDefects = Number.isFinite(Number(dashData?.defects?.total))
    ? Number(dashData.defects.total)
    : rows.reduce((sum, row) => sum + row.liveDefects, 0);

  const portfolioMixData = useMemo(() => ({
    labels: ['Features', 'Defects'],
    datasets: [{
      data: [aggregateFeatures, aggregateDefects],
      backgroundColor: ['rgba(20,146,255,0.72)', 'rgba(235,63,63,0.72)'],
      borderColor: ['#1492ff', BAD],
      borderWidth: 1,
      hoverOffset: 0,
    }],
  }), [aggregateFeatures, aggregateDefects]);

  const lineOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: TICK } },
      tooltip: { enabled: true },
      datalabels: { display: false },
      annotation: {
        annotations: buildAnnotationLines(annItems, rows.map(row => row.pi), handleDeleteAnnotation, 'crosspi-density'),
      },
    },
    scales: {
      x: {
        ticks: { color: TICK },
        grid: { color: GRID },
      },
      y: {
        beginAtZero: true,
        ticks: { color: TICK },
        grid: { color: GRID },
      },
    },
  }), [annItems, rows]);

  const velocityOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: TICK } },
      tooltip: { enabled: true },
      datalabels: { display: false },
      annotation: {
        annotations: buildAnnotationLines(annItems, rows.map(row => row.pi), handleDeleteAnnotation, 'crosspi-velocity'),
      },
    },
    scales: {
      x: {
        ticks: { color: TICK },
        grid: { color: GRID },
      },
      y: {
        beginAtZero: true,
        ticks: { color: TICK },
        grid: { color: GRID },
        title: { display: true, text: 'Features / Sprint', color: TICK },
      },
      y1: {
        beginAtZero: true,
        position: 'right',
        ticks: { color: TICK },
        grid: { color: GRID, drawOnChartArea: false },
        title: { display: true, text: 'Points / Sprint', color: TICK },
      },
    },
  }), [annItems, rows]);

  const barOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: TICK } },
      tooltip: { enabled: true },
      datalabels: {
        color: TICK,
        anchor: 'end',
        align: 'end',
        offset: 2,
        formatter: value => value,
      },
      annotation: {
        annotations: buildAnnotationLines(annItems, rows.map(row => row.pi), handleDeleteAnnotation, 'crosspi-live-defects'),
      },
    },
    scales: {
      x: {
        ticks: { color: TICK },
        grid: { color: GRID },
      },
      y: {
        beginAtZero: true,
        ticks: { color: TICK },
        grid: { color: GRID },
      },
    },
  }), [annItems, rows]);

  const doughnutOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: TICK },
      },
      tooltip: { enabled: true },
      datalabels: {
        color: '#ffffff',
        font: { weight: '700' },
        formatter: (value, context) => {
          const total = context.dataset.data.reduce((sum, current) => sum + Number(current || 0), 0);
          if (!total) return value;
          return `${Math.round((value / total) * 100)}%`;
        },
      },
    },
  }), []);

  const hasVelocityTrend = useMemo(
    () => rows.some(row => Number.isFinite(row.avgSprintDone) || Number.isFinite(row.avgSprintPoints)),
    [rows],
  );

  if (densityLoading) {
    return <PageLoader label="Loading cross-PI trends…" />;
  }

  if (densityError) {
    return (
      <div>
        <div className="card" style={{ padding: 20, borderRadius: 0 }}>
          <div style={{ color: BAD, fontWeight: 700 }}>Failed to load cross-PI data.</div>
          <div style={{ color: 'var(--muted)', marginTop: 8 }}>{densityError.message}</div>
        </div>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div>
        <div className="card" style={{ padding: 20, borderRadius: 0 }}>
          <div className="section-title">📈 Cross-PI Trends</div>
          <div style={{ color: 'var(--muted)', marginTop: 10 }}>
            No cross-PI data available. Select multiple PIs and ensure snapshot data exists.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div className="section-header" style={{ marginBottom: 0 }}>
        <div>
          <div className="section-title">📈 Cross-PI Trends</div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
            Longitudinal programme view across {rows.length} PI{rows.length === 1 ? '' : 's'}
            {selectedTeamLabel ? ` · ${selectedTeamLabel} team filter is ignored here` : ' · all teams'}
            {sourceHost ? ` · source ${sourceHost}` : ''}
          </div>
        </div>
      </div>

      <div className="kpi-strip">
        {rows.map(row => {
          const meta = statusMeta(row.improving);
          return (
            <div
              key={row.pi}
              className={`kpi-card ${row.improving == null ? 'muted' : row.improving ? 'green' : 'red'}`}
              style={{ borderRadius: 0, borderTop: `3px solid ${meta.color}`, textAlign: 'left', minWidth: 170 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div className="kpi-lbl">[{row.pi}]</div>
                <div style={{ color: meta.color, fontSize: 16, fontWeight: 800 }}>{meta.icon}</div>
              </div>
              <div className="kpi-val" style={{ marginTop: 8, fontSize: 26 }}>
                {row.donePct == null ? '—' : `${row.donePct}%`}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
                Features: <span style={{ color: 'var(--text)', fontWeight: 700 }}>{row.doneCount == null ? '—' : row.doneCount} / {row.totalFeatures || row.liveFeatures}</span>
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
                Density: <span style={{ color: meta.color, fontWeight: 700 }}>{formatDensity(row.liveDensity)} {meta.icon}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="charts-grid-2">
        <div className="card" style={{ borderRadius: 0 }}>
          <div className="card-header" style={{ padding: '14px 18px 0 18px' }}>
            <div><div style={{ color: 'var(--text)', fontSize: 16, fontWeight: 700 }}>Defect Density Trend</div><div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>Lower is better. Marker colour shows change versus the previous PI.</div></div>
            <div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(rows.map(row => row.pi), 'crosspi-density')} /><CopyButton type="chart" /></div>
          </div>
          <div style={{ height: 320, padding: 16 }}>
            <Line data={densityLineData} options={lineOptions} />
          </div>
        </div>

        <div className="card" style={{ borderRadius: 0 }}>
          <div className="card-header" style={{ padding: '14px 18px 0 18px' }}>
            <div><div style={{ color: 'var(--text)', fontSize: 16, fontWeight: 700 }}>Velocity Trend</div><div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>Average sprint throughput within each PI from velocity rollups.</div></div>
            <div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(rows.map(row => row.pi), 'crosspi-velocity')} /><CopyButton type="chart" /></div>
          </div>
          <div style={{ height: 320, padding: 16 }}>
            {hasVelocityTrend ? (
              <Line data={velocityChartData} options={velocityOptions} />
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', textAlign: 'center', padding: 16 }}>
                Velocity data groups by sprint — select specific PI for sprint breakdown.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="charts-grid-2">
        <div className="card" style={{ borderRadius: 0 }}>
          <div className="card-header" style={{ padding: '14px 18px 0 18px' }}>
            <div><div style={{ color: 'var(--text)', fontSize: 16, fontWeight: 700 }}>Live Defects per PI</div><div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>Side-by-side live defects and live features across the PI history.</div></div>
            <div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(rows.map(row => row.pi), 'crosspi-live-defects')} /><CopyButton type="chart" /></div>
          </div>
          <div style={{ height: 320, padding: 16 }}>
            <Bar data={defectsBarData} options={barOptions} />
          </div>
        </div>

        <div className="card" style={{ borderRadius: 0 }}>
          <div className="card-header" style={{ padding: '14px 18px 0 18px' }}>
            <div><div style={{ color: 'var(--text)', fontSize: 16, fontWeight: 700 }}>Portfolio Mix</div><div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>Aggregate dashboard counts across the same PI set.</div></div>
            <div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(['Features', 'Defects'], 'crosspi-portfolio-mix')} /><CopyButton type="chart" /></div>
          </div>
          <div style={{ height: 320, padding: 16 }}>
            <Doughnut data={portfolioMixData} options={doughnutOptions} />
          </div>
        </div>
      </div>

      <div className="card" style={{ borderRadius: 0 }}>
        <div style={{ padding: '16px 18px 0 18px' }}>
          <div style={{ color: 'var(--text)', fontSize: 16, fontWeight: 700 }}>Cross-PI Summary</div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>Density deltas are compared with the previous PI in sequence.</div>
        </div>
        <div style={{ padding: 16, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['PI', 'Features', 'Defects', 'Density', 'Δ Density', 'Status'].map(col => (
                  <th key={col} style={{ textAlign: 'left', padding: '12px 10px', color: 'var(--muted)', fontSize: 12, fontWeight: 700, borderRadius: 0 }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const meta = statusMeta(row.improving);
                return (
                  <tr key={row.pi} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 10px', color: 'var(--text)', fontWeight: 700 }}>{row.pi}</td>
                    <td style={{ padding: '12px 10px', color: 'var(--text)' }}>{row.liveFeatures}</td>
                    <td style={{ padding: '12px 10px', color: 'var(--text)' }}>{row.liveDefects}</td>
                    <td style={{ padding: '12px 10px', color: 'var(--text)' }}>{formatDensity(row.liveDensity)}</td>
                    <td style={{ padding: '12px 10px', color: row.deltaDensity == null ? 'var(--muted)' : meta.color }}>{formatDelta(row.deltaDensity)}</td>
                    <td style={{ padding: '12px 10px', color: meta.color, fontWeight: 700 }}>{`${meta.emoji} ${meta.text}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <ChartAnnotations
        section="cross-pi"
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
