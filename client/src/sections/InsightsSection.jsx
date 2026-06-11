import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  ArcElement, Filler, Title, Tooltip, Legend, ScatterController,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar, Doughnut, Line, Scatter } from 'react-chartjs-2';
import useStore from '../store/useStore.js';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/apiClient.js';
import { useConfig, useDependencyMatrix, useFilteredDashboard, useInsightsFlow, useVelocity, useAnnotations } from '../api/hooks.js';
import { PageLoader } from '../components/ui/PageLoader.jsx';
import { usePolicies } from '../hooks/usePolicies.js';
import CopyButton from '../components/ui/CopyButton.jsx';
import ChartAnnotations, { AnnotationButton } from '../components/ui/ChartAnnotations.jsx';
import DownloadCSVButton from '../components/ui/DownloadCSVButton.jsx';
import { TFSItemLink } from '../components/ui/TFSLink';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  ArcElement, Filler, Title, Tooltip, Legend, ChartDataLabels, ScatterController
);

const darkOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#ADADAD', boxWidth: 10 } },
    datalabels: { display: false },
  },
  scales: {
    x: { ticks: { color: '#ADADAD' }, grid: { display: false } },
    y: { ticks: { color: '#ADADAD' }, grid: { color: '#454545' }, beginAtZero: true },
  },
};

const TIER_STYLES = {
  Elite: { label: '🟣 Elite', color: '#a855f7' },
  High: { label: '🟢 High', color: '#068443' },
  Medium: { label: '🟡 Medium', color: '#F5CC00' },
  Low: { label: '🔴 Low', color: '#eb3f3f' },
};

function buildHistogram(results) {
  const counts = {};
  results.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  const labels = Object.keys(counts).sort((a, b) => a - b).map(Number);
  return { labels: labels.map(l => `${l} sprints`), data: labels.map(l => counts[l]) };
}

function runMonteCarlo(throughputHistory, remainingItems, simulations = 3000) {
  if (!throughputHistory.length || remainingItems <= 0 || !throughputHistory.some(v => v > 0)) return null;
  const n = throughputHistory.length;
  const results = [];
  for (let i = 0; i < simulations; i++) {
    let rem = remainingItems;
    let periods = 0;
    while (rem > 0 && periods < 20) {
      rem -= throughputHistory[Math.floor(Math.random() * n)];
      periods++;
    }
    results.push(periods);
  }
  results.sort((a, b) => a - b);
  return {
    p50: results[Math.floor(simulations * 0.50)],
    p85: results[Math.floor(simulations * 0.85)],
    p95: results[Math.floor(simulations * 0.95)],
    histogram: buildHistogram(results),
  };
}

function rollingAvgSigma(sortedDays) {
  const w = Math.max(3, Math.floor(sortedDays.length * 0.20));
  const avg = [];
  const upper = [];
  const lower = [];
  for (let i = 0; i < sortedDays.length; i++) {
    const slice = sortedDays.slice(Math.max(0, i - w), i + 1);
    const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
    const sigma = Math.sqrt(slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / slice.length);
    avg.push(mean);
    upper.push(mean + sigma);
    lower.push(Math.max(0, mean - sigma));
  }
  return { avg, upper, lower };
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

function round(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return null;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function formatDateTime(value) {
  if (!value) return '–';
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function getOpenDefectCount(stateCounts) {
  return Object.entries(stateCounts || {})
    .filter(([state]) => !['Resolved', 'Closed', 'Removed'].includes(state))
    .reduce((sum, [, count]) => sum + count, 0);
}

function getTier(metric, value) {
  if (value == null || Number.isNaN(value)) return TIER_STYLES.Low;
  switch (metric) {
    case 'deployment':
      if (value > 4) return TIER_STYLES.Elite;
      if (value > 2) return TIER_STYLES.High;
      if (value > 1) return TIER_STYLES.Medium;
      return TIER_STYLES.Low;
    case 'leadTime':
      if (value < 7) return TIER_STYLES.Elite;
      if (value < 14) return TIER_STYLES.High;
      if (value < 30) return TIER_STYLES.Medium;
      return TIER_STYLES.Low;
    case 'failureRate':
      if (value < 5) return TIER_STYLES.Elite;
      if (value < 15) return TIER_STYLES.High;
      if (value < 45) return TIER_STYLES.Medium;
      return TIER_STYLES.Low;
    case 'recovery':
      if (value < 1) return TIER_STYLES.Elite;
      if (value < 7) return TIER_STYLES.High;
      if (value < 30) return TIER_STYLES.Medium;
      return TIER_STYLES.Low;
    default:
      return TIER_STYLES.Low;
  }
}


function getIterationSegments(value) {
  return (value || '').replace(/\//g, '\\').split('\\').filter(Boolean);
}

function getPiFromIterationPath(iterationPath, pis) {
  const normalized = (iterationPath || '').replace(/\//g, '\\');
  return pis.find(pi => normalized.includes(pi)) || null;
}

function getSprintLabel(iterationPath) {
  const parts = getIterationSegments(iterationPath);
  return parts[parts.length - 1] || 'Unknown Sprint';
}

function isEnablerItem(item) {
  const title = (item?.title || '').trim();
  const workItemType = (item?.workItemType || '').trim().toLowerCase();
  return workItemType === 'enabler' || /^\[(e|enabler)\]/i.test(title) || /enabler/i.test(title);
}

function isPriorityInterruption(priority) {
  const value = String(priority || '').toUpperCase();
  return value.includes('P1') || value.includes('P2') || /(^|[^0-9])1([^0-9]|$)/.test(value) || /(^|[^0-9])2([^0-9]|$)/.test(value);
}

function getWipColor(count) {
  if (count <= 1) return '#068443';
  if (count === 2) return '#F5CC00';
  return '#eb3f3f';
}

function getTrafficColor(value, goodThreshold, warnThreshold) {
  if (value == null || Number.isNaN(value)) return 'var(--text-primary)';
  if (value <= goodThreshold) return '#068443';
  if (value <= warnThreshold) return '#F5CC00';
  return '#eb3f3f';
}

function getAchievementColor(value) {
  if (value == null || Number.isNaN(value)) return 'var(--text-primary)';
  if (value >= 80) return '#068443';
  if (value >= 50) return '#F5CC00';
  return '#eb3f3f';
}

function getDependencyHeatColor(count) {
  if (count > 5) return '#eb3f3f44';
  if (count >= 3) return '#ff7f0f44';
  if (count >= 1) return '#F5CC0033';
  return 'transparent';
}

const TEAM_COLOR_PALETTE = ['#1492ff', '#068443', '#eb3f3f', '#F5CC00', '#858FFF', '#fa7000', '#21837c', '#ff7f0f'];

function buildQueryString(pis, teamPath) {
  const params = new URLSearchParams();
  pis.forEach(pi => params.append('pis[]', pi));
  if (teamPath) params.append('teamPath', teamPath);
  return params.toString();
}

function MetricBox({ label, value, color }) {
  return (
    <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 14 }}>
      <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>{label}</div>
      <div style={{ color, fontSize: 26, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function DoraPanel({ title, value, tier, benchmark }) {
  return (
    <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 16, minHeight: 128 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 12, alignItems: 'flex-start' }}>
        <div style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{title}</div>
        <span style={{ background: `${tier.color}22`, border: `1px solid ${tier.color}55`, color: tier.color, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>
          {tier.label}
        </span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>{value}</div>
      <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12 }}>{benchmark}</div>
    </div>
  );
}

export default function InsightsSection() {
  const selectedPIs = useStore(s => s.selectedPIs);
  const availablePIs = useStore(s => s.availablePIs);
  const selectedTeam = useStore(s => s.selectedTeam);
  const tfsBaseUrl = useStore(s => s.tfsBaseUrl);
  const sprintLabels = useStore(s => s.sprintLabels);
  const { chartVisible } = usePolicies();

  const pis = selectedPIs.length
    ? selectedPIs
    : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);

  const { data: cfg } = useConfig();
  const { data: dashData, isLoading: dashLoading, error: dashError } = useFilteredDashboard(pis, selectedTeam);
  const { data: velocityData, isLoading: velocityLoading, error: velocityError } = useVelocity(pis, selectedTeam);
  const { data: insightsFlow, isLoading: flowLoading, error: flowError } = useInsightsFlow(pis, selectedTeam);
  const { data: depMatrix, isLoading: matrixLoading, error: matrixError } = useDependencyMatrix(pis, selectedTeam);

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [summary, setSummary] = useState(null);
  const [scopeAdj, setScopeAdj] = useState(0);
  const [annPopup, setAnnPopup] = useState({ open: false, sprints: [], chartId: '' });
  const [reportSprint, setReportSprint] = useState(() => {
    const labels = useStore.getState().sprintLabels;
    return labels[Math.max(0, labels.length - 2)] || labels[0] || 'S3';
  });
  const notifiedPisRef = useRef('');
  const anomalyThreshold = Number.isFinite(Number(cfg?.notifications?.anomalyThreshold)) ? Number(cfg.notifications.anomalyThreshold) : 1.5;
  const activePi = selectedPIs[selectedPIs.length - 1] || '';
  const { data: annData } = useAnnotations('insights', activePi, selectedTeam);
  const annItems = annData?.items || [];
  const qc = useQueryClient();

  async function handleDeleteAnnotation(id) {
    await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['annotations', 'insights'] });
  }

  function openAnnPopup(sprints, chartId = '') {
    setAnnPopup({ open: true, sprints, chartId });
  }

  const pisKey = pis.join(',');

  useEffect(() => {
    setSummary(null);
    setSummaryError('');
    setSummaryLoading(false);
  }, [pisKey, selectedTeam]);

  const generateSummary = useCallback(async () => {
    if (!pis.length) return;
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const data = await apiFetch(`/api/insights/summary?${buildQueryString(pis, selectedTeam)}`);
      setSummary(data.narrative || null);
    } catch (error) {
      setSummaryError(error.message || 'Unable to generate narrative.');
    } finally {
      setSummaryLoading(false);
    }
  }, [pis, selectedTeam]);

  const downloadSprintReport = useCallback(() => {
    const params = new URLSearchParams(buildQueryString(pis, selectedTeam));
    params.set('sprint', reportSprint);
    window.open(`/api/reports/sprint-close?${params.toString()}`, '_blank', 'noopener,noreferrer');
  }, [pis, reportSprint, selectedTeam]);

  const cfdData = useMemo(() => {
    const throughput = insightsFlow?.sprintThroughput || [];
    const totalsByPi = new Map((insightsFlow?.piFlow || []).map(entry => [entry.pi, entry.total || 0]));
    const seenPIs = new Set();
    let cumulativeDone = 0;
    let cumulativeTotal = 0;
    const labels = [];
    const done = [];
    const total = [];
    throughput.forEach(entry => {
      labels.push(entry.label);
      if (!seenPIs.has(entry.pi)) {
        cumulativeTotal += totalsByPi.get(entry.pi) || 0;
        seenPIs.add(entry.pi);
      }
      cumulativeDone += entry.done || 0;
      done.push(cumulativeDone);
      total.push(cumulativeTotal);
    });
    return {
      labels,
      datasets: [
        {
          label: 'Done',
          data: done,
          borderColor: '#068443',
          backgroundColor: 'rgba(6,132,67,0.22)',
          fill: true,
          tension: 0.25,
          pointRadius: 3,
        },
        {
          label: 'Total',
          data: total,
          borderColor: '#1492ff',
          backgroundColor: 'rgba(20,146,255,0.08)',
          fill: false,
          tension: 0.15,
          pointRadius: 2,
          borderWidth: 2,
        },
      ],
    };
  }, [insightsFlow]);

  const throughputHistory = useMemo(
    () => (velocityData?.velocity || []).flatMap(pi => (pi.sprints || []).map(sprint => sprint.totalDone || 0)),
    [velocityData]
  );

  const monteCarlo = useMemo(() => {
    const total = dashData?.features?.total || 0;
    const done = dashData?.features?.stateCounts?.Done || 0;
    const removed = dashData?.features?.stateCounts?.Removed || 0;
    const remainingItems = Math.max(0, total - done - removed);
    return {
      remainingItems,
      simulation: runMonteCarlo(throughputHistory, remainingItems),
    };
  }, [dashData, throughputHistory]);

  const monteCarloMeta = useMemo(() => {
    const sim = monteCarlo.simulation;
    if (!sim) return { risk: null, outcome: null };
    const risk = sim.p85 <= 2
      ? { label: '🟢 Low Risk', color: '#068443' }
      : sim.p85 <= 4
        ? { label: '🟡 Moderate Risk', color: '#F5CC00' }
        : { label: '🔴 High Risk', color: '#eb3f3f' };
    const outcome = sim.p50 <= 2 ? 'Comfortable'
      : sim.p50 <= 3 ? 'Tight'
        : sim.p50 <= 5 ? 'Risky'
          : 'Likely delay';
    return { risk, outcome };
  }, [monteCarlo]);

  const cycleChart = useMemo(() => {
    const items = [...(insightsFlow?.cycleTimes || [])]
      .filter(item => item.days != null)
      .sort((a, b) => new Date(a.completedDate || 0) - new Date(b.completedDate || 0));
    const sortedDays = items.map(item => item.days);
    const rolling = rollingAvgSigma(sortedDays);
    return {
      items,
      data: {
        datasets: [
          {
            type: 'scatter',
            label: 'Cycle time',
            data: items.map((item, index) => ({ x: index + 1, y: item.days, title: item.title, team: item.team, pi: item.pi })),
            backgroundColor: '#1492ff',
            pointRadius: 4,
            pointHoverRadius: 5,
          },
          {
            type: 'line',
            label: 'Rolling avg',
            data: rolling.avg.map((value, index) => ({ x: index + 1, y: round(value, 1) })),
            borderColor: '#F5CC00',
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            tension: 0.2,
          },
          {
            type: 'line',
            label: '+1σ',
            data: rolling.upper.map((value, index) => ({ x: index + 1, y: round(value, 1) })),
            borderColor: '#eb3f3f',
            borderDash: [6, 6],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0.2,
          },
          {
            type: 'line',
            label: '-1σ',
            data: rolling.lower.map((value, index) => ({ x: index + 1, y: round(value, 1) })),
            borderColor: '#068443',
            borderDash: [6, 6],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0.2,
          },
        ],
      },
    };
  }, [insightsFlow]);

  const dora = useMemo(() => {
    const sprintCount = throughputHistory.length;
    const doneFeatures = dashData?.features?.stateCounts?.Done || 0;
    const cycleDays = (insightsFlow?.cycleTimes || []).map(item => item.days).filter(day => day != null);
    const openDefects = getOpenDefectCount(dashData?.defects?.stateCounts);
    const deploymentFreq = sprintCount ? doneFeatures / sprintCount : null;
    const avgLeadTime = average(cycleDays);
    const changeFailureRate = doneFeatures > 0 ? (openDefects / doneFeatures) * 100 : null;
    const closedDefectAges = (dashData?.defects?.items || [])
      .filter(item => ['Resolved', 'Closed'].includes(item.state) && item.created && item.changed)
      .map(item => Math.max(0, (new Date(item.changed) - new Date(item.created)) / 86400000));
    const recoveryTime = average(closedDefectAges);

    return {
      deploymentFreq,
      avgLeadTime,
      changeFailureRate,
      recoveryTime,
      deploymentTier: getTier('deployment', deploymentFreq),
      leadTier: getTier('leadTime', avgLeadTime),
      failureTier: getTier('failureRate', changeFailureRate),
      recoveryTier: recoveryTime == null ? TIER_STYLES.Low : getTier('recovery', recoveryTime),
    };
  }, [dashData, insightsFlow, throughputHistory]);

  const investmentData = useMemo(() => {
    const features = dashData?.features?.stateCounts || {};
    const defects = dashData?.defects?.stateCounts || {};
    const featureTotal = Object.values(features).reduce((sum, value) => sum + value, 0);
    const defectTotal = Object.values(defects).reduce((sum, value) => sum + value, 0);
    const total = featureTotal + defectTotal;
    if (!total) return null;
    return {
      labels: ['Features', 'Defects'],
      datasets: [{
        data: [featureTotal, defectTotal],
        backgroundColor: ['rgba(20,146,255,0.8)', 'rgba(235,63,63,0.8)'],
        borderColor: ['#1492ff', '#eb3f3f'],
        borderWidth: 2,
      }],
      totals: { features: featureTotal, defects: defectTotal, total },
    };
  }, [dashData]);

  const throughputTrendData = useMemo(() => {
    const piVelocity = velocityData?.velocity || [];
    if (!piVelocity.length) return null;
    const sprintLabels = [];
    const teamMap = {};

    piVelocity.forEach(pi => {
      (pi.sprints || []).forEach(sprint => {
        const label = `${pi.pi} ${sprint.sprint}`;
        sprintLabels.push(label);

        Object.values(teamMap).forEach(series => {
          if (series.length < sprintLabels.length) series.push(0);
        });

        Object.entries(sprint.byTeam || {}).forEach(([team, data]) => {
          if (!teamMap[team]) teamMap[team] = Array(sprintLabels.length).fill(0);
          teamMap[team][sprintLabels.length - 1] = data.done || 0;
        });
      });
    });

    const COLORS = ['#1492ff', '#068443', '#eb3f3f', '#ff7f0f', '#858FFF', '#F5CC00', '#21837c', '#fa7000'];
    const datasets = Object.entries(teamMap).map(([team, data], index) => ({
      label: team,
      data,
      backgroundColor: COLORS[index % COLORS.length] + 'cc',
      borderColor: COLORS[index % COLORS.length],
      borderWidth: 1,
      borderRadius: 0,
    }));

    return { labels: sprintLabels, datasets };
  }, [velocityData]);

  const cycleOutliers = useMemo(() => {
    const items = (insightsFlow?.cycleTimes || []).filter(item => item.days != null);
    if (items.length < 5) return [];
    const days = items.map(item => item.days);
    const p90 = percentile(days, 0.90);
    return items.filter(item => item.days >= p90).sort((a, b) => b.days - a.days);
  }, [insightsFlow]);

  const anomalyAlerts = useMemo(() => {
    const piFlow = insightsFlow?.piFlow || [];
    if (piFlow.length < 2) return [];
    const alerts = [];
    const lastPI = piFlow[piFlow.length - 1];
    const prevPIs = piFlow.slice(0, -1);
    if (!prevPIs.length) return [];

    function checkMetric(label, values, currentVal, lowerIsBetter = false) {
      if (currentVal == null || values.length < 1) return;
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const sigma = Math.sqrt(values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length);
      if (sigma === 0) return;
      const z = (currentVal - mean) / sigma;
      const threshold = anomalyThreshold;
      if (Math.abs(z) >= threshold) {
        const worse = lowerIsBetter ? currentVal > mean : currentVal < mean;
        alerts.push({
          label,
          current: currentVal,
          mean: Math.round(mean),
          sigma: Math.round(sigma * 10) / 10,
          z: Math.round(z * 10) / 10,
          severity: Math.abs(z) >= 2 ? 'high' : 'medium',
          worse,
          pi: lastPI.pi,
        });
      }
    }

    const doneRates = prevPIs.map(pi => pi.total > 0 ? Math.round((pi.stateCounts?.Done || 0) / pi.total * 100) : 0);
    const curDoneRate = lastPI.total > 0 ? Math.round((lastPI.stateCounts?.Done || 0) / lastPI.total * 100) : 0;
    checkMetric('Feature Done Rate', doneRates, curDoneRate, false);

    const wipCounts = prevPIs.map(pi => (pi.stateCounts?.Activated || 0) + (pi.stateCounts?.Approved || 0));
    const curWip = (lastPI.stateCounts?.Activated || 0) + (lastPI.stateCounts?.Approved || 0);
    checkMetric('Active WIP Count', wipCounts, curWip, true);

    return alerts;
  }, [anomalyThreshold, insightsFlow]);

  useEffect(() => {
    if (!anomalyAlerts.length) return;
    const key = pis.join(',') + ':' + anomalyAlerts.length;
    if (notifiedPisRef.current === key) return;
    notifiedPisRef.current = key;
    apiFetch('/api/notifications/webhook/anomaly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alerts: anomalyAlerts }),
    }).catch(() => {});
  }, [anomalyAlerts, pis]);

  const dependencyTeams = depMatrix?.teams || [];
  const hasDependencyMatrix = dependencyTeams.length > 0 && Object.keys(depMatrix?.matrix || {}).length > 0;

  const reviewPack = useMemo(() => {
    const features = dashData?.features || {};
    const defects = dashData?.defects || {};
    const cycleItems = insightsFlow?.cycleTimes || [];
    const cycleDays = cycleItems.map(item => item.days).filter(day => day != null);
    const removed = features.stateCounts?.Removed || 0;
    const done = features.stateCounts?.Done || 0;
    const total = Math.max(0, (features.total || 0) - removed);
    const openDefects = getOpenDefectCount(defects.stateCounts);
    const velocityEntries = (velocityData?.velocity || []).flatMap(pi =>
      (pi.sprints || []).map(sprint => ({ label: `${pi.pi} ${sprint.sprint}`, done: sprint.totalDone || 0 }))
    );
    const bestSprint = velocityEntries.sort((a, b) => b.done - a.done)[0] || null;
    const topTeams = Object.entries(features.teamBreakdown || {})
      .map(([team, states]) => ({
        team,
        done: states.Done || 0,
        inProgress: (states.Activated || 0) + (states.Approved || 0),
      }))
      .sort((a, b) => b.done - a.done || b.inProgress - a.inProgress)
      .slice(0, 3);
    const p90 = percentile(cycleDays, 0.90);
    return {
      label: pis.length > 1 ? `${pis[0]}–${pis[pis.length - 1]}` : (pis[0] || 'Selected PI'),
      generated: formatDateTime(summary?.generated || new Date().toISOString()),
      done,
      total,
      doneRate: total > 0 ? round((done / total) * 100, 0) : 0,
      openDefects,
      escapeRatio: defects.escapeRatio || 0,
      avgSprintThroughput: round(average(throughputHistory) || 0, 1),
      bestSprint,
      p50: monteCarlo.simulation?.p50 ?? '–',
      p85: monteCarlo.simulation?.p85 ?? '–',
      riskLevel: monteCarloMeta.risk ? monteCarloMeta.risk.label.split(' ').slice(1).join(' ').replace(' Risk', '') : 'Unknown',
      cycleAvg: round(average(cycleDays) || 0, 1),
      cycleMin: cycleDays.length ? Math.min(...cycleDays) : 0,
      cycleMax: cycleDays.length ? Math.max(...cycleDays) : 0,
      outliers: p90 == null ? 0 : cycleDays.filter(day => day > p90).length,
      topTeams,
    };
  }, [dashData, insightsFlow, monteCarlo, monteCarloMeta, pis, summary, throughputHistory, velocityData]);


  const leadTimeChart = useMemo(() => {
    const items = [...(dashData?.features?.items || [])]
      .filter(item => item.state === 'Done' && item.created && item.changed)
      .map(item => {
        const leadDays = Math.max(0, (new Date(item.changed) - new Date(item.created)) / 86400000);
        return {
          ...item,
          leadDays,
          completedDate: item.changed,
          pi: getPiFromIterationPath(item.iterationPath, pis),
        };
      })
      .filter(item => Number.isFinite(item.leadDays))
      .sort((a, b) => new Date(a.completedDate || 0) - new Date(b.completedDate || 0));

    const sortedDays = items.map(item => item.leadDays);
    const rolling = rollingAvgSigma(sortedDays);
    const points = items.map((item, index) => ({
      x: index + 1,
      y: round(item.leadDays, 1),
      id: item.id,
      title: item.title,
      team: item.team || 'Unassigned team',
      pi: item.pi || '–',
      completedDate: item.completedDate,
      tfsUrl: tfsBaseUrl ? `${tfsBaseUrl}/_workitems/edit/${item.id}` : null,
      isOutlier: item.leadDays > (rolling.upper[index] ?? Number.POSITIVE_INFINITY),
    }));

    return {
      items,
      averageLead: average(sortedDays),
      outlierCount: points.filter(point => point.isOutlier).length,
      data: {
        datasets: [
          {
            type: 'scatter',
            label: 'Lead time',
            data: points,
            backgroundColor: points.map(point => point.isOutlier ? '#eb3f3f' : '#1492ff'),
            pointRadius: points.map(point => point.isOutlier ? 5 : 4),
            pointHoverRadius: points.map(point => point.isOutlier ? 6 : 5),
          },
          {
            type: 'line',
            label: 'Rolling avg',
            data: rolling.avg.map((value, index) => ({ x: index + 1, y: round(value, 1) })),
            borderColor: '#F5CC00',
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            tension: 0.2,
          },
          {
            type: 'line',
            label: '+1σ',
            data: rolling.upper.map((value, index) => ({ x: index + 1, y: round(value, 1) })),
            borderColor: '#eb3f3f',
            borderDash: [6, 6],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0.2,
          },
          {
            type: 'line',
            label: '-1σ',
            data: rolling.lower.map((value, index) => ({ x: index + 1, y: round(value, 1) })),
            borderColor: '#068443',
            borderDash: [6, 6],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0.2,
          },
        ],
      },
    };
  }, [dashData, pis, tfsBaseUrl]);

  const wipPerDeveloper = useMemo(() => {
    const activeStates = new Set(['Activated', 'In Progress', 'Approved']);
    const activeItems = (dashData?.features?.items || []).filter(item => activeStates.has(item.state));
    const developerMap = new Map();
    const teamMap = new Map();

    activeItems.forEach(item => {
      const developer = (item.assignedTo || 'Unassigned').trim() || 'Unassigned';
      const team = item.team || 'Unknown Team';
      const entry = developerMap.get(developer) || {
        name: developer,
        count: 0,
        items: [],
        teamCounts: {},
      };
      entry.count += 1;
      entry.items.push(`#${item.id} ${item.title}`);
      entry.teamCounts[team] = (entry.teamCounts[team] || 0) + 1;
      developerMap.set(developer, entry);

      const teamEntry = teamMap.get(team) || { activeItems: 0, developers: new Set() };
      teamEntry.activeItems += 1;
      teamEntry.developers.add(developer);
      teamMap.set(team, teamEntry);
    });

    const developers = Array.from(developerMap.values())
      .map(entry => {
        const sortedTeams = Object.entries(entry.teamCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        return {
          ...entry,
          team: sortedTeams[0]?.[0] || 'Unknown Team',
          teams: sortedTeams.map(([team, count]) => `${team} (${count})`),
        };
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const teamColors = developers.reduce((acc, developer) => {
      if (!acc[developer.team]) {
        acc[developer.team] = TEAM_COLOR_PALETTE[Object.keys(acc).length % TEAM_COLOR_PALETTE.length];
      }
      return acc;
    }, {});

    const teamBreakdown = Array.from(teamMap.entries())
      .map(([team, info]) => ({
        team,
        activeItems: info.activeItems,
        developers: info.developers.size,
        color: teamColors[team] || TEAM_COLOR_PALETTE[Object.keys(teamColors).length % TEAM_COLOR_PALETTE.length],
      }))
      .sort((a, b) => b.activeItems - a.activeItems || a.team.localeCompare(b.team));

    return {
      developers,
      teamBreakdown,
      totalDevelopers: developers.length,
      averageWip: developers.length ? average(developers.map(entry => entry.count)) : null,
      maxEntry: developers[0] || null,
      teamColors,
      chartData: {
        labels: developers.map(entry => entry.name),
        datasets: [{
          label: 'Active features',
          data: developers.map(entry => entry.count),
          backgroundColor: developers.map(entry => `${getWipColor(entry.count)}cc`),
          borderColor: developers.map(entry => teamColors[entry.team] || '#1492ff'),
          borderWidth: 2,
          borderRadius: 0,
        }],
      },
    };
  }, [dashData]);

  const flowDistribution = useMemo(() => {
    const featureItems = dashData?.features?.items || [];
    const defectItems = dashData?.defects?.items || [];
    const piOrder = [...new Set([...(insightsFlow?.piFlow || []).map(entry => entry.pi), ...pis])];
    const piFlowMap = new Map((insightsFlow?.piFlow || []).map(entry => [entry.pi, entry.total || 0]));
    const enablersByPi = {};
    const featuresByPi = {};
    const defectsByPi = {};

    featureItems.forEach(item => {
      const pi = getPiFromIterationPath(item.iterationPath, pis);
      if (!pi) return;
      if (isEnablerItem(item)) {
        enablersByPi[pi] = (enablersByPi[pi] || 0) + 1;
      } else {
        featuresByPi[pi] = (featuresByPi[pi] || 0) + 1;
      }
    });

    defectItems.forEach(item => {
      const pi = getPiFromIterationPath(item.iterationPath, pis);
      if (!pi) return;
      defectsByPi[pi] = (defectsByPi[pi] || 0) + 1;
    });

    const perPi = piOrder.map(pi => {
      const enablers = enablersByPi[pi] || 0;
      const featureTotal = piFlowMap.has(pi) ? Math.max(0, (piFlowMap.get(pi) || 0) - enablers) : (featuresByPi[pi] || 0);
      const defects = defectsByPi[pi] || 0;
      return { pi, features: featureTotal, defects, enablers };
    });

    const totals = perPi.reduce((acc, entry) => ({
      features: acc.features + entry.features,
      defects: acc.defects + entry.defects,
      enablers: acc.enablers + entry.enablers,
    }), { features: 0, defects: 0, enablers: 0 });
    const grandTotal = totals.features + totals.defects + totals.enablers;

    return {
      perPi,
      totals: { ...totals, grandTotal },
      doughnutData: {
        labels: ['Features', 'Defects', 'Enablers'],
        datasets: [{
          data: [totals.features, totals.defects, totals.enablers],
          backgroundColor: ['rgba(20,146,255,0.82)', 'rgba(235,63,63,0.82)', 'rgba(245,204,0,0.82)'],
          borderColor: ['#1492ff', '#eb3f3f', '#F5CC00'],
          borderWidth: 2,
        }],
      },
      piChartData: {
        labels: perPi.map(entry => entry.pi),
        datasets: [
          { label: 'Features', data: perPi.map(entry => entry.features), backgroundColor: 'rgba(20,146,255,0.82)', borderColor: '#1492ff', borderWidth: 1 },
          { label: 'Defects', data: perPi.map(entry => entry.defects), backgroundColor: 'rgba(235,63,63,0.82)', borderColor: '#eb3f3f', borderWidth: 1 },
          { label: 'Enablers', data: perPi.map(entry => entry.enablers), backgroundColor: 'rgba(245,204,0,0.82)', borderColor: '#F5CC00', borderWidth: 1 },
        ],
      },
    };
  }, [dashData, insightsFlow, pis]);

  const recentlyChanged = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return [
      ...(dashData?.features?.items || []).map(item => ({ ...item, _type: 'Feature' })),
      ...(dashData?.defects?.items  || []).map(item => ({ ...item, _type: 'Defect'  })),
    ]
      .filter(item => item.changed && new Date(item.changed).getTime() > cutoff)
      .sort((a, b) => new Date(b.changed).getTime() - new Date(a.changed).getTime())
      .slice(0, 25);
  }, [dashData]);

  const unplannedWork = useMemo(() => {
    const allItems = [
      ...(dashData?.features?.items || []),
      ...(dashData?.defects?.items || []),
    ];

    const perPi = pis.map(pi => {
      const items = allItems
        .filter(item => getPiFromIterationPath(item.iterationPath, [pi]) === pi && item.created)
        .map(item => ({ ...item, createdDate: new Date(item.created) }))
        .filter(item => !Number.isNaN(item.createdDate.getTime()))
        .sort((a, b) => a.createdDate - b.createdDate);

      if (!items.length) {
        return { pi, total: 0, planned: 0, unplanned: 0, ratio: null, baseline: null };
      }

      const baseline = items[0].createdDate;
      const cutoff = new Date(baseline);
      cutoff.setDate(cutoff.getDate() + 14);
      const planned = items.filter(item => item.createdDate <= cutoff).length;
      const unplanned = items.length - planned;

      return {
        pi,
        total: items.length,
        planned,
        unplanned,
        ratio: items.length ? (unplanned / items.length) * 100 : null,
        baseline: baseline.toISOString(),
      };
    });

    const totals = perPi.reduce((acc, entry) => ({
      total: acc.total + entry.total,
      planned: acc.planned + entry.planned,
      unplanned: acc.unplanned + entry.unplanned,
    }), { total: 0, planned: 0, unplanned: 0 });

    return {
      perPi,
      totals,
      overallRatio: totals.total ? (totals.unplanned / totals.total) * 100 : null,
      chartData: {
        labels: perPi.map(entry => entry.pi),
        datasets: [
          { label: 'Planned', data: perPi.map(entry => entry.planned), backgroundColor: 'rgba(6,132,67,0.82)', borderColor: '#068443', borderWidth: 1 },
          { label: 'Unplanned', data: perPi.map(entry => entry.unplanned), backgroundColor: 'rgba(245,204,0,0.82)', borderColor: '#F5CC00', borderWidth: 1 },
        ],
      },
    };
  }, [dashData, pis]);

  const interruptionRate = useMemo(() => {
    const sprintMap = new Map();
    const allItems = [
      ...(dashData?.features?.items || []),
      ...(dashData?.defects?.items || []),
    ];

    allItems.forEach(item => {
      const sprint = getSprintLabel(item.iterationPath);
      const pi = getPiFromIterationPath(item.iterationPath, pis);
      const label = pi ? `${pi} ${sprint}` : sprint;
      const key = `${pi || 'Unknown'}::${sprint}`;
      const createdMs = item.created ? new Date(item.created).getTime() : null;
      const entry = sprintMap.get(key) || {
        key,
        label,
        sprint,
        pi,
        totalItems: 0,
        startMs: null,
        interruptions: [],
      };
      entry.totalItems += 1;
      if (createdMs != null && !Number.isNaN(createdMs)) {
        entry.startMs = entry.startMs == null ? createdMs : Math.min(entry.startMs, createdMs);
      }
      sprintMap.set(key, entry);
    });

    (dashData?.defects?.items || []).forEach(item => {
      if (!isPriorityInterruption(item.priority)) return;
      const sprint = getSprintLabel(item.iterationPath);
      const pi = getPiFromIterationPath(item.iterationPath, pis);
      const key = `${pi || 'Unknown'}::${sprint}`;
      const entry = sprintMap.get(key);
      if (!entry) return;
      const createdMs = item.created ? new Date(item.created).getTime() : null;
      entry.interruptions.push({
        id: item.id,
        title: item.title,
        priority: item.priority,
        createdMs,
      });
    });

    const sprints = Array.from(sprintMap.values())
      .map(entry => {
        const interruptions = entry.interruptions.filter(item => {
          if (entry.startMs == null || item.createdMs == null || Number.isNaN(item.createdMs)) return true;
          return item.createdMs > entry.startMs;
        });
        const count = interruptions.length;
        return {
          ...entry,
          count,
          rate: entry.totalItems > 0 ? (count / entry.totalItems) * 100 : 0,
          interruptions,
        };
      })
      .sort((a, b) => (a.startMs || 0) - (b.startMs || 0) || a.label.localeCompare(b.label));

    const counts = sprints.map(entry => entry.count);
    const avg = average(counts) || 0;
    const sigma = counts.length
      ? Math.sqrt(counts.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / counts.length)
      : 0;
    const threshold = avg + sigma;
    const worstSprint = [...sprints].sort((a, b) => b.count - a.count || b.rate - a.rate)[0] || null;

    return {
      sprints,
      totalInterruptions: counts.reduce((sum, value) => sum + value, 0),
      averagePerSprint: average(counts),
      threshold,
      worstSprint,
      chartData: {
        labels: sprints.map(entry => entry.label),
        datasets: [
          {
            label: 'P1/P2 interruptions',
            data: sprints.map(entry => entry.count),
            borderColor: '#eb3f3f',
            backgroundColor: 'rgba(235,63,63,0.18)',
            pointBackgroundColor: '#eb3f3f',
            pointRadius: 4,
            fill: true,
            tension: 0.25,
          },
          {
            label: 'Avg + 1σ',
            data: sprints.map(() => round(threshold, 1)),
            borderColor: '#F5CC00',
            borderDash: [6, 6],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0,
          },
        ],
      },
    };
  }, [dashData, pis]);

  const sprintGoalAchievement = useMemo(() => {
    const sprints = (velocityData?.velocity || []).flatMap(piEntry =>
      (piEntry.sprints || []).map(sprint => {
        const sprintTotal = Object.values(sprint.byTeam || {}).reduce((sum, teamStats) => {
          const explicitTotal = Number(teamStats?.total);
          if (!Number.isNaN(explicitTotal) && explicitTotal > 0) return sum + explicitTotal;
          return sum + Number(teamStats?.done || 0) + Number(teamStats?.inProgress || 0);
        }, 0);
        const done = Number(sprint.totalDone || 0);
        const doneRate = sprintTotal > 0 ? (done / sprintTotal) * 100 : 0;
        return {
          label: `${piEntry.pi} ${sprint.sprint}`,
          pi: piEntry.pi,
          sprint: sprint.sprint,
          done,
          total: sprintTotal,
          doneRate,
          achieved: sprintTotal > 0 ? doneRate >= 80 : false,
        };
      })
    );

    const achievedSprints = sprints.filter(entry => entry.achieved).length;
    const totalSprints = sprints.length;
    const achievementRate = totalSprints ? (achievedSprints / totalSprints) * 100 : null;
    const missed = sprints.filter(entry => !entry.achieved).sort((a, b) => a.doneRate - b.doneRate);

    return {
      sprints,
      achievedSprints,
      totalSprints,
      achievementRate,
      missed,
      chartData: {
        labels: sprints.map(entry => entry.label),
        datasets: [
          {
            type: 'bar',
            label: 'Done %',
            data: sprints.map(entry => round(entry.doneRate, 1)),
            backgroundColor: sprints.map(entry => {
              const color = getAchievementColor(entry.doneRate);
              return color === 'var(--text-primary)' ? 'rgba(20,146,255,0.82)' : `${color}cc`;
            }),
            borderColor: sprints.map(entry => {
              const color = getAchievementColor(entry.doneRate);
              return color === 'var(--text-primary)' ? '#1492ff' : color;
            }),
            borderWidth: 1,
            borderRadius: 0,
          },
          {
            type: 'line',
            label: 'Goal threshold',
            data: sprints.map(() => 80),
            borderColor: '#1492ff',
            borderDash: [6, 6],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0,
          },
        ],
      },
    };
  }, [velocityData]);

  const leadTimeOptions = {
    ...darkOpts,
    plugins: {
      ...darkOpts.plugins,
      tooltip: {
        callbacks: {
          label: context => {
            const raw = context.raw || {};
            if (context.datasetIndex === 0) {
              return `${raw.title} • ${raw.team} • ${raw.y}d`;
            }
            return `${context.dataset.label}: ${raw.y}d`;
          },
          afterBody: items => {
            const raw = items?.[0]?.raw || {};
            if (!raw.isOutlier || !raw.tfsUrl) return [];
            return ['Outlier above +1σ', `TFS: ${raw.tfsUrl}`];
          },
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        ticks: { color: '#ADADAD', precision: 0 },
        grid: { display: false },
        title: { display: true, text: 'Completion sequence', color: '#ADADAD' },
      },
      y: {
        ...darkOpts.scales.y,
        title: { display: true, text: 'Lead time (days)', color: '#ADADAD' },
      },
    },
  };

  const wipChartOptions = {
    ...darkOpts,
    indexAxis: 'y',
    plugins: {
      ...darkOpts.plugins,
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: context => ` ${context.raw} active feature${context.raw === 1 ? '' : 's'}`,
          afterBody: items => {
            const entry = wipPerDeveloper.developers[items?.[0]?.dataIndex ?? -1];
            if (!entry) return [];
            const lines = [`Team: ${entry.teams.join(', ')}`, 'Items:'];
            const itemLines = entry.items.slice(0, 6).map(item => `• ${item}`);
            if (entry.items.length > 6) itemLines.push(`• +${entry.items.length - 6} more`);
            return [...lines, ...itemLines];
          },
        },
      },
    },
    scales: {
      x: { ...darkOpts.scales.x, beginAtZero: true, ticks: { color: '#ADADAD', precision: 0 } },
      y: { ...darkOpts.scales.y, grid: { display: false }, ticks: { color: '#ADADAD' } },
    },
  };

  const flowPiOptions = {
    ...darkOpts,
    plugins: {
      ...darkOpts.plugins,
      tooltip: {
        callbacks: {
          footer: items => {
            const index = items?.[0]?.dataIndex ?? -1;
            const pi = flowDistribution.perPi[index];
            if (!pi) return '';
            const total = pi.features + pi.defects + pi.enablers;
            return `Total: ${total}`;
          },
        },
      },
    },
    scales: {
      x: { ...darkOpts.scales.x, stacked: true },
      y: { ...darkOpts.scales.y, stacked: true, ticks: { color: '#ADADAD', precision: 0 } },
    },
  };

  const unplannedOptions = {
    ...darkOpts,
    scales: {
      x: { ...darkOpts.scales.x, stacked: true },
      y: { ...darkOpts.scales.y, stacked: true, ticks: { color: '#ADADAD', precision: 0 } },
    },
  };

  const interruptionOptions = {
    ...darkOpts,
    plugins: {
      ...darkOpts.plugins,
      tooltip: {
        callbacks: {
          afterBody: items => {
            const sprint = interruptionRate.sprints[items?.[0]?.dataIndex ?? -1];
            if (!sprint) return [];
            const lines = [`Rate: ${round(sprint.rate, 1)}%`, `Scope: ${sprint.totalItems} total items`];
            sprint.interruptions.slice(0, 5).forEach(item => lines.push(`• ${item.priority || 'Priority'} #${item.id}`));
            if (sprint.interruptions.length > 5) lines.push(`• +${sprint.interruptions.length - 5} more`);
            return lines;
          },
        },
      },
    },
    scales: {
      x: { ...darkOpts.scales.x, ticks: { color: '#ADADAD', maxRotation: 40, minRotation: 25 } },
      y: { ...darkOpts.scales.y, ticks: { color: '#ADADAD', precision: 0 } },
    },
  };

  const sprintGoalOptions = {
    ...darkOpts,
    scales: {
      x: { ...darkOpts.scales.x, ticks: { color: '#ADADAD', maxRotation: 40, minRotation: 25 } },
      y: { ...darkOpts.scales.y, max: 100, ticks: { color: '#ADADAD', callback: value => `${value}%` } },
    },
  };

  const wipAgeData = useMemo(() => {
    const now = Date.now();
    const activeItems = (dashData?.features?.items || [])
      .filter(item => ['Activated', 'In Progress', 'Approved'].includes(item.state) && item.created)
      .map(item => ({
        ...item,
        ageDays: Math.max(0, Math.round((now - new Date(item.created).getTime()) / 86400000)),
      }))
      .filter(item => Number.isFinite(item.ageDays))
      .sort((a, b) => b.ageDays - a.ageDays);

    const teamBuckets = {};
    activeItems.forEach(item => {
      const team = item.team || 'Unassigned';
      if (!teamBuckets[team]) teamBuckets[team] = [];
      teamBuckets[team].push(item);
    });

    const ageColor = ageDays => (ageDays < 14 ? '#068443' : ageDays < 30 ? '#F5CC00' : ageDays < 60 ? '#ff7f0f' : '#eb3f3f');
    const teamSummary = Object.entries(teamBuckets)
      .map(([team, items], index) => ({
        team,
        count: items.length,
        oldestAge: Math.max(...items.map(item => item.ageDays)),
        color: TEAM_COLOR_PALETTE[index % TEAM_COLOR_PALETTE.length],
      }))
      .sort((a, b) => b.count - a.count || b.oldestAge - a.oldestAge);
    const topItems = activeItems.slice(0, 20);
    const aged = activeItems.filter(item => item.ageDays >= 30).length;
    const critical = activeItems.filter(item => item.ageDays >= 60).length;

    return {
      activeItems,
      teamBuckets,
      teamSummary,
      topItems,
      aged,
      critical,
      oldest: activeItems[0] || null,
      total: activeItems.length,
      chartData: {
        labels: topItems.map(item => item.title?.length > 30 ? `${item.title.slice(0, 30)}…` : (item.title || `#${item.id}`)),
        datasets: [{
          label: 'Age (days)',
          data: topItems.map(item => item.ageDays),
          backgroundColor: topItems.map(item => ageColor(item.ageDays)),
          borderColor: topItems.map(item => ageColor(item.ageDays)),
          borderWidth: 1.5,
          borderRadius: 0,
        }],
      },
    };
  }, [dashData]);

  const wipAgeOptions= useMemo(() => ({
    ...darkOpts,
    indexAxis: 'y',
    plugins: {
      ...darkOpts.plugins,
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: items => {
            const item = wipAgeData.topItems[items?.[0]?.dataIndex ?? -1];
            return item?.title || items?.[0]?.label || 'Feature';
          },
          label: context => {
            const item = wipAgeData.topItems[context.dataIndex];
            if (!item) return ` ${context.raw} days`;
            return [` ${context.raw} days`, ` Team: ${item.team || 'Unassigned'}`, ` State: ${item.state || 'Unknown'}`];
          },
        },
      },
    },
    scales: {
      x: {
        ...darkOpts.scales.x,
        ticks: { color: '#ADADAD', precision: 0 },
        title: { display: true, text: 'Age (days)', color: '#ADADAD' },
      },
      y: {
        ticks: { color: '#ADADAD', font: { size: 11 } },
        grid: { display: false },
      },
    },
  }), [wipAgeData]);

  const bottleneckData = useMemo(() => {
    const piFlow = insightsFlow?.piFlow || [];
    if (!piFlow.length) return null;

    const ACTIVE_STATES = ['New', 'Approved', 'Activated'];
    const stateColors = { New: '#1492ff', Approved: '#ff7f0f', Activated: '#F5CC00' };
    const perPi = piFlow.map(entry => {
      const bottleneck = ACTIVE_STATES
        .map(state => ({ state, count: entry.stateCounts?.[state] || 0 }))
        .sort((a, b) => b.count - a.count)[0];
      return {
        pi: entry.pi,
        bottleneck: bottleneck?.state || 'None',
        count: bottleneck?.count || 0,
        stateCounts: entry.stateCounts || {},
      };
    });

    const stateAgg = {};
    piFlow.forEach(entry => {
      ACTIVE_STATES.forEach(state => {
        stateAgg[state] = (stateAgg[state] || 0) + (entry.stateCounts?.[state] || 0);
      });
    });

    const overallEntry = Object.entries(stateAgg).sort((a, b) => b[1] - a[1])[0];

    return {
      perPi,
      overall: overallEntry ? { state: overallEntry[0], count: overallEntry[1] } : null,
      stateAgg,
      chartData: {
        labels: perPi.map(entry => entry.pi),
        datasets: ACTIVE_STATES.map(state => ({
          label: state,
          data: perPi.map(entry => entry.stateCounts?.[state] || 0),
          backgroundColor: stateColors[state] + 'cc',
          borderColor: stateColors[state],
          borderWidth: 1,
          borderRadius: 0,
        })),
      },
    };
  }, [insightsFlow]);

  const bottleneckOptions= {
    ...darkOpts,
    plugins: {
      ...darkOpts.plugins,
      tooltip: {
        callbacks: {
          afterBody: items => {
            const entry = bottleneckData?.perPi?.[items?.[0]?.dataIndex ?? -1];
            return entry ? [`Top bottleneck: ${entry.bottleneck} (${entry.count})`] : [];
          },
        },
      },
    },
    scales: {
      x: { ...darkOpts.scales.x, stacked: true },
      y: { ...darkOpts.scales.y, stacked: true, ticks: { color: '#ADADAD', precision: 0 } },
    },
  };

  const scopeSim = useMemo(() => {
    const baseRemaining = monteCarlo.remainingItems;
    const adjusted = Math.max(0, baseRemaining + scopeAdj);
    const sim = adjusted === 0 ? { p50: 0, p85: 0, p95: 0 } : runMonteCarlo(throughputHistory, adjusted);
    return { adjusted, sim, baseRemaining };
  }, [monteCarlo.remainingItems, scopeAdj, throughputHistory]);

  const scopeSimComparison = useMemo(() => {
    const classifyRisk = sim => {
      if (!sim) return { label: '⚪ No Forecast', color: '#757575' };
      if (sim.p85 === 0) return { label: '✅ Complete', color: '#068443' };
      if (sim.p85 <= 2) return { label: '🟢 Low Risk', color: '#068443' };
      if (sim.p85 <= 4) return { label: '🟡 Moderate Risk', color: '#F5CC00' };
      return { label: '🔴 High Risk', color: '#eb3f3f' };
    };

    const baseSim = monteCarlo.remainingItems === 0 ? { p50: 0, p85: 0, p95: 0 } : monteCarlo.simulation;
    const adjustedSim = scopeSim.sim;

    return {
      baseSim,
      adjustedSim,
      baseRisk: classifyRisk(baseSim),
      adjustedRisk: classifyRisk(adjustedSim),
      p50Delta: baseSim && adjustedSim ? adjustedSim.p50 - baseSim.p50 : null,
      p85Delta: baseSim && adjustedSim ? adjustedSim.p85 - baseSim.p85 : null,
      p95Delta: baseSim && adjustedSim ? adjustedSim.p95 - baseSim.p95 : null,
    };
  }, [monteCarlo.remainingItems, monteCarlo.simulation, scopeSim]);

  const ktloData = useMemo(() => {
    const featureItems = dashData?.features?.items || [];
    const defectItems = dashData?.defects?.items || [];

    function isKtlo(item) {
      const tags = (item.tags || '').toLowerCase();
      const title = (item.title || '').toLowerCase();
      return tags.includes('ktlo') || tags.includes('maintenance') || tags.includes('support')
        || title.includes('[ktlo]') || title.includes('[support]') || title.includes('[maintenance]');
    }

    const capability = featureItems.filter(item => !isEnablerItem(item) && !isKtlo(item)).length;
    const enablers = featureItems.filter(item => isEnablerItem(item)).length;
    const ktloFeatures = featureItems.filter(item => isKtlo(item)).length;
    const ktloDefects = defectItems.length;
    const ktloTotal = ktloFeatures + ktloDefects;
    const total = capability + enablers + ktloTotal;

    return {
      capability,
      enablers,
      ktloFeatures,
      ktloDefects,
      ktloTotal,
      total,
      capPct: total ? Math.round((capability / total) * 100) : 0,
      ktloPct: total ? Math.round((ktloTotal / total) * 100) : 0,
      enablerPct: total ? Math.round((enablers / total) * 100) : 0,
      chartData: {
        labels: ['New Capability', 'Enablers', 'KTLO'],
        datasets: [{
          data: [capability, enablers, ktloTotal],
          backgroundColor: ['#1492ffcc', '#F5CC00cc', '#eb3f3fcc'],
          borderColor: ['#1492ff', '#F5CC00', '#eb3f3f'],
          borderWidth: 2,
        }],
      },
    };
  }, [dashData]);

  const ktloOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    plugins: {
      legend: { position: 'bottom', labels: { color: '#ADADAD', boxWidth: 10, font: { size: 11 } } },
      datalabels: {
        color: '#fff',
        font: { weight: 'bold', size: 11 },
        formatter: value => (ktloData.total ? `${Math.round((value / ktloData.total) * 100)}%` : ''),
      },
      tooltip: {
        callbacks: {
          label: context => {
            const total = ktloData.total || 1;
            const pct = Math.round((context.raw / total) * 100);
            return ` ${context.label}: ${context.raw} (${pct}%)`;
          },
        },
      },
    },
  };

  const ghostContributors = useMemo(() => {
    const items = dashData?.features?.items || [];
    const assigneeMap = {};

    items.forEach(item => {
      const name = (item.assignedTo || '').trim();
      if (!name) return;
      if (!assigneeMap[name]) assigneeMap[name] = { name, total: 0, done: 0, active: 0, team: item.team || 'Unknown' };
      assigneeMap[name].total += 1;
      if (item.state === 'Done') assigneeMap[name].done += 1;
      if (['Activated', 'In Progress', 'Approved'].includes(item.state)) assigneeMap[name].active += 1;
    });

    const all = Object.values(assigneeMap).map(entry => ({
      ...entry,
      completionPct: entry.total ? Math.round((entry.done / entry.total) * 100) : 0,
    }));
    const ghosts = all
      .filter(entry => entry.total >= 2 && entry.done === 0)
      .sort((a, b) => b.active - a.active || b.total - a.total || a.name.localeCompare(b.name));
    const lowActivity = all
      .filter(entry => entry.total >= 3 && entry.done / entry.total < 0.1 && !ghosts.some(ghost => ghost.name === entry.name))
      .sort((a, b) => a.completionPct - b.completionPct || b.total - a.total || a.name.localeCompare(b.name));

    return { ghosts, lowActivity, total: all.length };
  }, [dashData]);

  const printStyles = `
    @media print {
      .sidebar, .topbar, .no-print { display: none !important; }
      body, #root, .main, .section { background: #fff !important; color: #000 !important; overflow: visible !important; height: auto !important; }
      .section { padding: 0 !important; }
      .insights-review-card { display: block !important; margin: 0 !important; border: none !important; box-shadow: none !important; background: #fff !important; }
      .insights-review-pack { display: block !important; border: none !important; box-shadow: none !important; }
    }
  `;

  const cfdOptions = {
    ...darkOpts,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { ...darkOpts.scales.x, ticks: { color: '#ADADAD', maxRotation: 40, minRotation: 25 } },
      y: { ...darkOpts.scales.y },
    },
  };

  const histogramOptions = {
    ...darkOpts,
    plugins: { ...darkOpts.plugins, legend: { display: false } },
    scales: {
      x: { ...darkOpts.scales.x },
      y: { ...darkOpts.scales.y, ticks: { color: '#ADADAD', precision: 0 } },
    },
  };

  const cycleOptions = {
    ...darkOpts,
    plugins: {
      ...darkOpts.plugins,
      tooltip: {
        callbacks: {
          label: context => {
            const raw = context.raw || {};
            if (context.datasetIndex === 0) {
              return `${raw.title} • ${raw.team} • ${raw.y}d`;
            }
            return `${context.dataset.label}: ${raw.y}d`;
          },
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        ticks: { color: '#ADADAD', precision: 0 },
        grid: { display: false },
        title: { display: true, text: 'Completed feature sequence', color: '#ADADAD' },
      },
      y: {
        ...darkOpts.scales.y,
        title: { display: true, text: 'Cycle time (days)', color: '#ADADAD' },
      },
    },
  };

  if (!pis.length) {
    return <div style={{ padding: 24, color: 'var(--muted)' }}>Select at least one PI to view Insights.</div>;
  }

  if (dashLoading && velocityLoading && flowLoading) return <PageLoader label="Loading Insights…" />;

  return (
    <>
      <style>{printStyles}</style>

      <div className="section-header no-print">
        <h1 className="section-title">🔬 Insights</h1>
        <div className="pi-tag-row">
          {pis.map(pi => <span key={pi} className="pi-tag">{pi}</span>)}
        </div>
      </div>

      {anomalyAlerts.length > 0 && (
        <div className="no-print" style={{ marginBottom: 16 }}>
          {anomalyAlerts.map((alert, index) => (
            <div key={index} style={{
              background: alert.severity === 'high' ? 'rgba(235,63,63,.1)' : 'rgba(245,204,0,.08)',
              border: `1px solid ${alert.severity === 'high' ? '#eb3f3f44' : '#F5CC0044'}`,
              borderLeft: `3px solid ${alert.severity === 'high' ? '#eb3f3f' : '#F5CC00'}`,
              padding: '10px 16px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <span style={{ fontSize: 18 }}>{alert.severity === 'high' ? '🚨' : '⚠️'}</span>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 13 }}>
                  Anomaly: {alert.label} in {alert.pi}
                </div>
                <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12 }}>
                  Current: <strong style={{ color: 'var(--text-primary)' }}>{alert.current}</strong> —
                  Historical avg: {alert.mean} ± {alert.sigma} (z-score: {alert.z}) —
                  {alert.worse ? ' 📉 Below normal performance' : ' 📈 Above normal performance'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="charts-grid-2 no-print">
        {/* SAFe Flow Metrics KPI strip */}
        {chartVisible('insights', 'flow-metrics') && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <span className="card-title">⚡ SAFe Flow Metrics</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Key flow health indicators — lower Flow Time + higher Efficiency = better</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, padding: '12px 16px 16px' }}>
              {[
                {
                  title: 'Flow Time',
                  subtitle: 'Avg lead time (days)',
                  value: dora.avgLeadTime != null ? `${round(dora.avgLeadTime, 1)}d` : '–',
                  color: dora.avgLeadTime == null ? 'var(--text-muted)' : dora.avgLeadTime < 14 ? '#068443' : dora.avgLeadTime < 30 ? '#F5CC00' : '#eb3f3f',
                  icon: '⏱',
                  tip: 'Total elapsed time from work started to done. SAFe target: < 14 days',
                },
                {
                  title: 'Flow Load',
                  subtitle: 'Active WIP (features)',
                  value: (() => { const wip = (dashData?.features?.stateCounts?.Activated || 0) + (dashData?.features?.stateCounts?.Approved || 0); return wip; })(),
                  color: (() => { const wip = (dashData?.features?.stateCounts?.Activated || 0) + (dashData?.features?.stateCounts?.Approved || 0); return wip <= 10 ? '#068443' : wip <= 20 ? '#F5CC00' : '#eb3f3f'; })(),
                  icon: '📥',
                  tip: 'Number of features currently in-progress. High WIP increases cycle time.',
                },
                {
                  title: 'Flow Velocity',
                  subtitle: 'Features done / sprint',
                  value: dora.deploymentFreq != null ? `${round(dora.deploymentFreq, 1)}` : '–',
                  color: dora.deploymentFreq == null ? 'var(--text-muted)' : dora.deploymentFreq >= 4 ? '#068443' : dora.deploymentFreq >= 2 ? '#F5CC00' : '#eb3f3f',
                  icon: '🚀',
                  tip: 'Average features completed per sprint. Higher = better throughput.',
                },
                {
                  title: 'Flow Distribution',
                  subtitle: '% new capability',
                  value: flowDistribution?.totals?.grandTotal > 0
                    ? `${Math.round(flowDistribution.totals.features / flowDistribution.totals.grandTotal * 100)}%`
                    : '–',
                  color: (() => {
                    const pct = flowDistribution?.totals?.grandTotal > 0 ? Math.round(flowDistribution.totals.features / flowDistribution.totals.grandTotal * 100) : null;
                    return pct == null ? 'var(--text-muted)' : pct >= 60 ? '#068443' : pct >= 40 ? '#F5CC00' : '#eb3f3f';
                  })(),
                  icon: '📊',
                  tip: 'Percentage of work that is new value delivery (vs defects/enablers). SAFe recommends ≥ 60%.',
                },
                {
                  title: 'Flow Efficiency',
                  subtitle: 'Done / (Done + WIP)',
                  value: (() => {
                    const done = dashData?.features?.stateCounts?.Done || 0;
                    const wip  = (dashData?.features?.stateCounts?.Activated || 0) + (dashData?.features?.stateCounts?.Approved || 0);
                    return (done + wip) > 0 ? `${Math.round(done / (done + wip) * 100)}%` : '–';
                  })(),
                  color: (() => {
                    const done = dashData?.features?.stateCounts?.Done || 0;
                    const wip  = (dashData?.features?.stateCounts?.Activated || 0) + (dashData?.features?.stateCounts?.Approved || 0);
                    const pct  = (done + wip) > 0 ? Math.round(done / (done + wip) * 100) : null;
                    return pct == null ? 'var(--text-muted)' : pct >= 70 ? '#068443' : pct >= 40 ? '#F5CC00' : '#eb3f3f';
                  })(),
                  icon: '✅',
                  tip: 'Ratio of done work to total active work. Higher = more work completing vs stacking up.',
                },
                {
                  title: 'Flow Predictability',
                  subtitle: 'PI done rate',
                  value: (() => {
                    const done  = dashData?.features?.stateCounts?.Done || 0;
                    const total = Math.max(1, (dashData?.features?.total || 1) - (dashData?.features?.stateCounts?.Removed || 0));
                    return `${Math.round(done / total * 100)}%`;
                  })(),
                  color: (() => {
                    const done  = dashData?.features?.stateCounts?.Done || 0;
                    const total = Math.max(1, (dashData?.features?.total || 1) - (dashData?.features?.stateCounts?.Removed || 0));
                    const pct   = Math.round(done / total * 100);
                    return pct >= 80 ? '#068443' : pct >= 50 ? '#F5CC00' : '#eb3f3f';
                  })(),
                  icon: '🎯',
                  tip: 'Features done vs committed. SAFe target: ≥ 80%.',
                },
              ].map(m => (
                <div key={m.title} title={m.tip} style={{ background: 'var(--surface, #1a1a2e)', border: '1px solid var(--border)', padding: '12px 14px', cursor: 'help' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', gap: 5, alignItems: 'center' }}>
                    <span>{m.icon}</span><span style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>{m.title}</span>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: m.color, lineHeight: 1 }}>{m.value}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{m.subtitle}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* What's Changed Feed */}
        {chartVisible('insights', 'whats-changed') && recentlyChanged.length > 0 && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <span className="card-title">🕐 What&apos;s Changed</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last 30 days · {recentlyChanged.length} items</span>
            </div>
            <div style={{ maxHeight: 300, overflowY: 'auto', padding: '0 16px 12px' }}>
              {recentlyChanged.map(item => {
                const typeColor = item._type === 'Defect' ? '#eb3f3f' : '#1492ff';
                const stateColor = item.state === 'Done' ? '#068443' : item.state === 'Activated' || item.state === 'In Progress' ? '#F5CC00' : '#ADADAD';
                const changedMs = new Date(item.changed).getTime();
                const ageH = Math.round((Date.now() - changedMs) / 3600000);
                const ageLabel = ageH < 1 ? 'just now' : ageH < 24 ? `${ageH}h ago` : `${Math.round(ageH / 24)}d ago`;
                const tfsUrl = tfsBaseUrl ? `${tfsBaseUrl}/_workitems/edit/${item.id}` : null;
                return (
                  <div key={`${item._type}-${item.id}`} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'7px 0', borderBottom:'1px solid var(--border)' }}>
                    <span style={{ fontSize:9, fontWeight:700, color:typeColor, background:typeColor+'22', border:`1px solid ${typeColor}55`, padding:'2px 5px', marginTop:2, flexShrink:0 }}>
                      {item._type === 'Defect' ? '🐛' : '📋'} {item._type}
                    </span>
                    <span style={{ flexShrink: 0 }}><TFSItemLink id={item.id} tfsBaseUrl={tfsBaseUrl} /></span>
                    <span style={{ flex:1, fontSize:12, color:'var(--text-primary)' }}>{item.title}</span>
                    <span style={{ fontSize:10, fontWeight:700, color:stateColor, flexShrink:0 }}>{item.state}</span>
                    <span style={{ fontSize:10, color:'var(--text-muted)', flexShrink:0 }}>{ageLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {chartVisible('insights', 'cfd') && (
          <div className="card">
            <div className="card-header"><div>
                <span className="card-title">📈 Flow: Cumulative Throughput</span>
                <div className="card-sub">Cumulative features completed per sprint vs total in-flight</div>
              </div><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels || [], 'insights-cfd')} /><CopyButton type="chart" /></div></div>
            <div className="chart-wrap" style={{ height: 280 }}>
              {flowLoading ? null
                : flowError ? <div style={{ color: 'var(--danger)', padding: 16 }}>❌ {flowError.message}</div>
                  : !cfdData.labels.length ? <div style={{ color: 'var(--muted)', padding: 16 }}>No cumulative flow data available.</div>
                    : <Line data={cfdData} options={cfdOptions} />}
            </div>
          </div>
        )}

        {chartVisible('insights', 'monte-carlo') && (
          <div className="card">
            <div className="card-header"><div>
                <span className="card-title">🎲 Monte Carlo PI Forecast</span>
                <div className="card-sub">Forecast completion risk from historical sprint throughput</div>
              </div><div className="card-actions">{monteCarloMeta.risk && <span style={{
      background: `${monteCarloMeta.risk.color}22`,
      border: `1px solid ${monteCarloMeta.risk.color}55`,
      color: monteCarloMeta.risk.color,
      padding: '2px 8px',
      fontSize: 10,
      fontWeight: 700
    }}>
                  {monteCarloMeta.risk.label}
                </span>}<AnnotationButton onClick={() => openAnnPopup(sprintLabels || [], 'insights-monte-carlo')} /><CopyButton type="chart" /></div></div>
            <div style={{ padding: 16 }}>
              {dashLoading || velocityLoading ? null
                : dashError || velocityError ? <div style={{ color: 'var(--danger)' }}>❌ {(dashError || velocityError).message}</div>
                  : !monteCarlo.simulation ? (
                    <div style={{ color: 'var(--muted)' }}>
                      {monteCarlo.remainingItems <= 0 ? 'No remaining work — forecast not required.' : 'Insufficient throughput history for simulation.'}
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
                        <MetricBox label="P50" value={`${monteCarlo.simulation.p50} sprints`} color="#1492ff" />
                        <MetricBox label="P85" value={`${monteCarlo.simulation.p85} sprints`} color="#F5CC00" />
                        <MetricBox label="P95" value={`${monteCarlo.simulation.p95} sprints`} color="#eb3f3f" />
                      </div>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 10 }}>
                        Outcome: <span style={{ color: 'var(--accent-blue)' }}>{monteCarloMeta.outcome}</span>
                      </div>
                      <div className="chart-wrap" style={{ height: 160, padding: 0 }}>
                        <Bar
                          data={{
                            labels: monteCarlo.simulation.histogram.labels,
                            datasets: [{ data: monteCarlo.simulation.histogram.data, backgroundColor: 'rgba(20,146,255,0.72)', borderColor: '#1492ff', borderWidth: 1 }],
                          }}
                          options={histogramOptions}
                        />
                      </div>
                    </>
                  )}
            </div>
          </div>
        )}
      </div>

      <div className="charts-grid-2 no-print mt-16">
        {chartVisible('insights', 'cycle-control') && (
          <div className="card">
            <div className="card-header"><div>
                <span className="card-title">⏱ Cycle Time Control Chart</span>
                <div className="card-sub">Days from Created to Done per feature. Lines: 20% rolling avg ±1σ</div>
              </div><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels || [], 'insights-cycle-control')} /><CopyButton type="chart" /></div></div>
            <div className="chart-wrap" style={{ height: 280 }}>
              {flowLoading ? null
                : flowError ? <div style={{ color: 'var(--danger)', padding: 16 }}>❌ {flowError.message}</div>
                  : !cycleChart.items.length ? <div style={{ color: 'var(--muted)', padding: 16 }}>No completed feature cycle times available.</div>
                    : <Scatter data={cycleChart.data} options={cycleOptions} />}
            </div>
          </div>
        )}

        {chartVisible('insights', 'dora') && (
          <div className="card">
            <div className="card-header">
              <div>
                <span className="card-title">🚀 DORA Metrics (Approximate)</span>
                <div className="card-sub">Approximated from work item flow and defect signals</div>
              </div>
            </div>
            <div style={{ padding: 16 }}>
              {dashLoading || flowLoading || velocityLoading ? null
                : dashError || flowError || velocityError ? <div style={{ color: 'var(--danger)' }}>❌ {(dashError || flowError || velocityError).message}</div>
                  : (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                        <DoraPanel
                          title="Deployment Frequency"
                          value={dora.deploymentFreq == null ? 'N/A' : `${round(dora.deploymentFreq, 1)} features/sprint`}
                          tier={dora.deploymentTier}
                          benchmark="Benchmark: >2/sprint = High"
                        />
                        <DoraPanel
                          title="Lead Time"
                          value={dora.avgLeadTime == null ? 'N/A' : `${round(dora.avgLeadTime, 1)} days`}
                          tier={dora.leadTier}
                          benchmark="Benchmark: <14d = High"
                        />
                        <DoraPanel
                          title="Change Failure Rate"
                          value={dora.changeFailureRate == null ? 'N/A' : `${round(dora.changeFailureRate, 1)}%`}
                          tier={dora.failureTier}
                          benchmark="Benchmark: <15% = High"
                        />
                        <DoraPanel
                          title="Recovery Time"
                          value={dora.recoveryTime == null ? 'N/A' : `${round(dora.recoveryTime, 1)} days`}
                          tier={dora.recoveryTier}
                          benchmark="Benchmark: <7d = High"
                        />
                      </div>
                      <div style={{ marginTop: 14, color: 'var(--text-muted, var(--muted))', fontSize: 12 }}>
                        ⚠️ Approximate values from work items. Connect Azure Pipelines for precise DORA metrics.
                      </div>
                    </>
                  )}
            </div>
          </div>
        )}
      </div>

      {cycleOutliers.length > 0 && chartVisible('insights', 'outliers') && (
        <div className="card no-print mt-16">
          <div className="card-header"><div>
              <span className="card-title">🔴 Cycle Time Outliers (90th+ Percentile)</span>
              <div className="card-sub">{cycleOutliers.length} features with longest cycle times — investigate for blockers</div>
            </div><div className="card-actions"><CopyButton type="table" /><DownloadCSVButton filename="cycle-time-outliers.csv" /></div></div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Feature', 'Team', 'PI', 'Cycle Time', 'Completed'].map(header => (
                    <th key={header} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted, var(--muted))', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 600 }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cycleOutliers.map((item, index) => (
                  <tr key={item.id || index} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px', color: 'var(--text-primary)', fontWeight: 500, fontSize: 12 }}>
                      <TFSItemLink id={item.id} tfsBaseUrl={tfsBaseUrl} /> {item.title}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-muted, var(--muted))', fontSize: 12 }}>{item.team}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-muted, var(--muted))', fontSize: 12 }}>{item.pi}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 700, color: '#eb3f3f', fontSize: 13 }}>{item.days}d</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-muted, var(--muted))', fontSize: 12 }}>{item.completedDate || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {chartVisible('insights', 'investment') && (
        <div className="card no-print mt-16">
          <div className="card-header"><div>
              <span className="card-title">💼 Work Investment Distribution</span>
              <div className="card-sub">Breakdown of engineering investment by work item type</div>
            </div><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels || [], 'insights-investment')} /><CopyButton type="chart" /></div></div>
          <div style={{ display: 'flex', gap: 24, padding: 16, alignItems: 'center' }}>
            {!investmentData
              ? <div style={{ color: 'var(--muted)' }}>No data available.</div>
              : <>
                  <div style={{ width: 200, height: 200, flexShrink: 0 }}>
                    <Doughnut
                      data={investmentData}
                      options={{
                        responsive: true, maintainAspectRatio: false, cutout: '60%',
                        plugins: {
                          legend: { position: 'bottom', labels: { color: '#ADADAD', boxWidth: 10 } },
                          datalabels: {
                            display: true,
                            formatter: value => {
                              const total = investmentData.totals.total;
                              return total > 0 ? `${Math.round(value / total * 100)}%` : '';
                            },
                            color: '#fff', font: { weight: 'bold', size: 12 },
                          },
                        },
                      }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    {[
                      { label: 'Features', count: investmentData.totals.features, color: '#1492ff' },
                      { label: 'Defects', count: investmentData.totals.defects, color: '#eb3f3f' },
                    ].map(({ label, count, color }) => {
                      const pct = Math.round(count / investmentData.totals.total * 100);
                      return (
                        <div key={label} style={{ marginBottom: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{label}</span>
                            <span style={{ color, fontWeight: 700 }}>{count} ({pct}%)</span>
                          </div>
                          <div style={{ height: 6, background: 'var(--border)', borderRadius: 0, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 0 }} />
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ marginTop: 16, padding: '10px 12px', background: 'var(--bg-card2)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-muted, var(--muted))' }}>
                      💡 Healthy teams invest 70%+ in features. High defect % signals quality debt.
                    </div>
                  </div>
                </>
            }
          </div>
        </div>
      )}

      {chartVisible('insights', 'throughput-trend') && (
        <div className="card no-print mt-16">
          <div className="card-header"><div>
              <span className="card-title">📊 Throughput Trend by Team</span>
              <div className="card-sub">Features completed per sprint, broken down by team</div>
            </div><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels || [], 'insights-throughput-trend')} /><CopyButton type="chart" /></div></div>
          <div className="chart-wrap" style={{ height: 260 }}>
            {velocityLoading
              ? null
              : !throughputTrendData
                ? <div style={{ color: 'var(--muted)', padding: 16 }}>No throughput data available.</div>
                : <Bar
                    data={throughputTrendData}
                    options={{
                      ...darkOpts,
                      plugins: {
                        ...darkOpts.plugins,
                        legend: { position: 'top', labels: { color: '#ADADAD', boxWidth: 10, font: { size: 11 } } },
                      },
                    }}
                  />
            }
          </div>
        </div>
      )}

      {chartVisible('insights', 'narrative') && (
        <div className="card no-print mt-16">
          <div className="card-header"><div>
              <span className="card-title">🤖 Programme Narrative</span>
              <div className="card-sub">Generate a rule-based PI review narrative</div>
            </div><div className="card-actions"><button className="btn btn-primary btn-sm" onClick={generateSummary} disabled={summaryLoading}>
              {summary ? 'Regenerate' : 'Generate'}
            </button></div></div>
          <div style={{ padding: 16 }}>
            {summaryLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="loading-spinner" style={{ width: 24, height: 24, borderWidth: 2 }} />
                <div style={{ color: 'var(--muted)' }}>Generating narrative…</div>
              </div>
            )}
            {!summaryLoading && summaryError && (
              <div style={{ color: 'var(--danger)' }}>
                ❌ {summaryError}
                <div style={{ marginTop: 12 }}>
                  <button className="btn btn-ghost btn-sm" onClick={generateSummary}>Retry</button>
                </div>
              </div>
            )}
            {!summaryLoading && !summaryError && !summary && (
              <div style={{ color: 'var(--muted)' }}>Generate a narrative summary for the currently selected PI scope.</div>
            )}
            {!summaryLoading && summary && (
              <div>
                <div style={{ color: 'var(--accent-blue)', fontSize: 22, fontWeight: 700, marginBottom: 16 }}>{summary.headline}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                  <div>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 700, marginBottom: 10 }}>Highlights</div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {summary.bullets?.map((bullet, index) => (
                        <li key={index} style={{ display: 'flex', gap: 10, marginBottom: 10, color: 'var(--text-primary)' }}>
                          <span style={{ color: '#068443' }}>●</span>
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 700, marginBottom: 10 }}>Risks</div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {summary.risks?.map((risk, index) => (
                        <li key={index} style={{ display: 'flex', gap: 10, marginBottom: 10, color: 'var(--text-primary)' }}>
                          <span style={{ color: '#F5CC00' }}>▲</span>
                          <span>{risk}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div style={{ marginTop: 16, color: 'var(--text-muted, var(--muted))', fontSize: 12 }}>
                  Generated: {formatDateTime(summary.generated)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {chartVisible('insights', 'review-pack') && (
        <div className="card insights-review-card mt-16">
          <div className="card-header no-print"><div>
              <span className="card-title">📄 PI Review Pack</span>
              <div className="card-sub">Printable executive-ready delivery pack</div>
            </div><div className="card-actions"><button className="btn btn-primary" onClick={() => window.print()}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:5}}><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Print / Export PDF
            </button></div></div>
          <div style={{ padding: 16 }}>
            {dashLoading || velocityLoading || flowLoading ? null
              : dashError || velocityError || flowError ? <div style={{ color: 'var(--danger)' }}>❌ {(dashError || velocityError || flowError).message}</div>
                : (
                  <div className="insights-review-pack" style={{ background: '#fff', color: '#111827', border: '1px solid #d1d5db', padding: 24, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
                    <div style={{ fontSize: 26, fontWeight: 800, color: '#111827', marginBottom: 4 }}>{reviewPack.label} REVIEW PACK</div>
                    <div style={{ color: '#4b5563', marginBottom: 24 }}>Generated: {reviewPack.generated}</div>

                    <div style={{ marginBottom: 22 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#111827', marginBottom: 10 }}>DELIVERY SUMMARY</div>
                      <div style={{ lineHeight: 1.8 }}>
                        <div>- Features Done: {reviewPack.done} of {reviewPack.total} ({reviewPack.doneRate}%)</div>
                        <div>- Defects Open: {reviewPack.openDefects}</div>
                        <div>- Escape Ratio: {reviewPack.escapeRatio}%</div>
                      </div>
                    </div>

                    <div style={{ marginBottom: 22 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#111827', marginBottom: 10 }}>VELOCITY</div>
                      <div style={{ lineHeight: 1.8 }}>
                        <div>- Avg sprint throughput: {reviewPack.avgSprintThroughput} features/sprint</div>
                        <div>- Best sprint: {reviewPack.bestSprint ? `${reviewPack.bestSprint.done} (${reviewPack.bestSprint.label})` : 'N/A'}</div>
                      </div>
                    </div>

                    <div style={{ marginBottom: 22 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#111827', marginBottom: 10 }}>FORECAST (Monte Carlo)</div>
                      <div style={{ lineHeight: 1.8 }}>
                        <div>- P50: {reviewPack.p50} sprints to complete remaining work</div>
                        <div>- P85 (safe commitment): {reviewPack.p85} sprints</div>
                        <div>- Risk level: {reviewPack.riskLevel}</div>
                      </div>
                    </div>

                    <div style={{ marginBottom: 22 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#111827', marginBottom: 10 }}>CYCLE TIME</div>
                      <div style={{ lineHeight: 1.8 }}>
                        <div>- Avg: {reviewPack.cycleAvg} days | Min: {reviewPack.cycleMin} | Max: {reviewPack.cycleMax}</div>
                        <div>- Outliers (&gt;90th pct): {reviewPack.outliers} features</div>
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#111827', marginBottom: 10 }}>TOP TEAMS</div>
                      <div style={{ lineHeight: 1.8 }}>
                        {reviewPack.topTeams.length
                          ? reviewPack.topTeams.map(team => (
                            <div key={team.team}>- {team.team}: {team.done} done, {team.inProgress} in progress</div>
                          ))
                          : <div>- No team data available</div>}
                      </div>
                    </div>
                  </div>
                )}
          </div>
        </div>
      )}

      <div className="no-print" style={{ marginTop: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, marginTop: 24, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
          Team Health & Flow Metrics
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(280px, .9fr)', gap: 16, marginBottom: 16 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>🔗 Dependency Matrix</div>
            {matrixLoading
              ? null
              : matrixError
                ? <div style={{ color: 'var(--danger)' }}>❌ {matrixError.message}</div>
                : !hasDependencyMatrix
                  ? <div style={{ color: 'var(--muted)' }}>No cross-team dependencies found.</div>
                  : <>
                      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: `minmax(140px, auto) repeat(${dependencyTeams.length}, minmax(58px, 1fr))`, gap: 6, minWidth: `${Math.max(420, dependencyTeams.length * 74 + 160)}px` }}>
                          <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', alignSelf: 'end' }}>From \ To</div>
                          {dependencyTeams.map(team => (
                            <div key={`col-${team}`} style={{ color: 'var(--text-muted, var(--muted))', fontSize: 11, fontWeight: 700, textAlign: 'center', textTransform: 'uppercase', paddingBottom: 4 }}>{team}</div>
                          ))}
                          {dependencyTeams.map(fromTeam => (
                            <div key={`row-${fromTeam}`} style={{ display: 'contents' }}>
                              <div style={{ display: 'flex', alignItems: 'center', fontWeight: 600, color: 'var(--text-primary)', paddingRight: 8 }}>{fromTeam}</div>
                              {dependencyTeams.map(toTeam => {
                                const count = depMatrix?.matrix?.[fromTeam]?.[toTeam] || 0;
                                return (
                                  <div
                                    key={`${fromTeam}-${toTeam}`}
                                    style={{
                                      minHeight: 42,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      border: '1px solid var(--border)',
                                      background: getDependencyHeatColor(count),
                                      color: count > 0 ? 'var(--text-primary)' : 'var(--text-muted, var(--muted))',
                                      fontWeight: count > 0 ? 700 : 500,
                                    }}
                                  >
                                    {count}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12, marginBottom: 12 }}>
                        Heat scale: 1–2 amber, 3–5 orange, 6+ red. Max cell value: {depMatrix?.maxValue || 0}
                      </div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {(depMatrix?.hotspots || []).length
                          ? depMatrix.hotspots.map(item => (
                              <div key={`${item.from}-${item.to}`} style={{ color: '#fbbf24', fontSize: 13, fontWeight: 600 }}>
                                ⚠️ {item.from} → {item.to}: {item.count} dependencies
                              </div>
                            ))
                          : <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12 }}>No hotspots at the current threshold.</div>}
                      </div>
                    </>}
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>📋 Sprint Close Report</div>
            <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12, marginBottom: 14 }}>
              Downloads a self-contained HTML sprint close report.
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              <label className="form-label" style={{ margin: 0 }}>
                Sprint
                <select className="form-input" value={reportSprint} onChange={event => setReportSprint(event.target.value)}>
                  {sprintLabels.map(sprint => (
                    <option key={sprint} value={sprint}>{sprint}</option>
                  ))}
                </select>
              </label>
              <button className="btn btn-primary" onClick={downloadSprintReport}>Download Report</button>
              <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12 }}>
                Scope: {pis.length ? (pis.length === 1 ? pis[0] : `${pis[0]}–${pis[pis.length - 1]}`) : 'Selected PI'}{selectedTeam ? ` · ${selectedTeam}` : ''}
              </div>
            </div>
          </div>
        </div>

        {chartVisible('insights', 'lead-time') && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: 20, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>⏱ Lead Time Control Chart</div>
            {dashLoading
              ? null
              : dashError
                ? <div style={{ color: 'var(--danger)' }}>❌ {dashError.message}</div>
                : !leadTimeChart.items.length
                  ? <div style={{ color: 'var(--muted)' }}>No completed feature lead times available.</div>
                  : <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) 1fr', gap: 16, marginBottom: 16, alignItems: 'center' }}>
                        <MetricBox
                          label="Avg lead time"
                          value={leadTimeChart.averageLead != null ? `${round(leadTimeChart.averageLead, 1)}d` : '–'}
                          color="#1492ff"
                        />
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(120px, 1fr))', gap: 12 }}>
                          <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 14 }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{leadTimeChart.items.length}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6 }}>Completed features</div>
                          </div>
                          <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 14 }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: '#eb3f3f' }}>{leadTimeChart.outlierCount}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6 }}>Outliers above +1σ</div>
                          </div>
                        </div>
                      </div>
                      <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12, marginBottom: 12 }}>Created → Done lead time, shown separately from Cycle Time (Activated → Done).</div>
                      <div style={{ height: 260 }}><Scatter data={leadTimeChart.data} options={leadTimeOptions} /></div>
                    </>}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>👤 WIP per Developer</div>
            {dashLoading
              ? null
              : dashError
                ? <div style={{ color: 'var(--danger)' }}>❌ {dashError.message}</div>
                : !wipPerDeveloper.developers.length
                  ? <div style={{ color: 'var(--muted)' }}>No active feature assignments found.</div>
                  : <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
                        <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 14 }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{wipPerDeveloper.totalDevelopers}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6 }}>Active developers</div>
                        </div>
                        <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 14 }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: '#1492ff' }}>{wipPerDeveloper.averageWip != null ? round(wipPerDeveloper.averageWip, 1) : '–'}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6 }}>Avg WIP / developer</div>
                        </div>
                        <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 14 }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: wipPerDeveloper.maxEntry ? getWipColor(wipPerDeveloper.maxEntry.count) : 'var(--text-primary)' }}>{wipPerDeveloper.maxEntry ? wipPerDeveloper.maxEntry.count : '–'}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6 }}>Max WIP{wipPerDeveloper.maxEntry?.count > 3 ? ` • ${wipPerDeveloper.maxEntry.name}` : ''}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                        {wipPerDeveloper.teamBreakdown.map(team => (
                          <div key={team.team} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-card2)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-primary)' }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: team.color, display: 'inline-block' }} />
                            <span>{team.team}</span>
                            <span style={{ color: 'var(--text-muted, var(--muted))' }}>{team.activeItems} items / {team.developers} devs</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12, marginBottom: 12 }}>Bar fill shows WIP pressure: ≤1 green, 2 amber, ≥3 red. Border color shows team.</div>
                      <div style={{ height: 260 }}><Bar data={wipPerDeveloper.chartData} options={wipChartOptions} /></div>
                    </>}
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>📊 Flow Distribution</div>
            {dashLoading || flowLoading
              ? null
              : dashError || flowError
                ? <div style={{ color: 'var(--danger)' }}>❌ {(dashError || flowError).message}</div>
                : !flowDistribution.totals.grandTotal
                  ? <div style={{ color: 'var(--muted)' }}>No flow distribution data available.</div>
                  : <>
                      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16, alignItems: 'center', marginBottom: 16 }}>
                        <div style={{ height: 180 }}>
                          <Doughnut
                            data={flowDistribution.doughnutData}
                            options={{
                              responsive: true,
                              maintainAspectRatio: false,
                              cutout: '62%',
                              plugins: {
                                legend: { position: 'bottom', labels: { color: '#ADADAD', boxWidth: 10 } },
                                datalabels: {
                                  formatter: value => flowDistribution.totals.grandTotal ? `${Math.round((value / flowDistribution.totals.grandTotal) * 100)}%` : '',
                                  color: '#fff',
                                  font: { weight: 'bold', size: 11 },
                                },
                              },
                            }}
                          />
                        </div>
                        <div>
                          {[
                            { label: 'Features', value: flowDistribution.totals.features, color: '#1492ff' },
                            { label: 'Defects', value: flowDistribution.totals.defects, color: '#eb3f3f' },
                            { label: 'Enablers', value: flowDistribution.totals.enablers, color: '#F5CC00' },
                          ].map(item => {
                            const percent = flowDistribution.totals.grandTotal ? Math.round((item.value / flowDistribution.totals.grandTotal) * 100) : 0;
                            return (
                              <div key={item.label} style={{ marginBottom: 10 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{item.label}</span>
                                  <span style={{ color: item.color, fontWeight: 700 }}>{item.value} ({percent}%)</span>
                                </div>
                                <div style={{ height: 6, background: 'var(--border)', borderRadius: 0, overflow: 'hidden' }}>
                                  <div style={{ width: `${percent}%`, height: '100%', background: item.color }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <div style={{ height: 220 }}><Bar data={flowDistribution.piChartData} options={flowPiOptions} /></div>
                    </>}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>📥 Unplanned Work Ratio</div>
            {dashLoading
              ? null
              : dashError
                ? <div style={{ color: 'var(--danger)' }}>❌ {dashError.message}</div>
                : !unplannedWork.totals.total
                  ? <div style={{ color: 'var(--muted)' }}>No PI creation timing data available.</div>
                  : <>
                      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, marginBottom: 12, alignItems: 'center' }}>
                        <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 16 }}>
                          <div style={{ fontSize: 30, fontWeight: 800, color: getTrafficColor(unplannedWork.overallRatio, 10, 20) }}>{unplannedWork.overallRatio != null ? `${round(unplannedWork.overallRatio, 1)}%` : '–'}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6 }}>Overall unplanned ratio</div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                          <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 14 }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: '#068443' }}>{unplannedWork.totals.planned}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6 }}>Planned items</div>
                          </div>
                          <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 14 }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: '#F5CC00' }}>{unplannedWork.totals.unplanned}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6 }}>Unplanned items</div>
                          </div>
                        </div>
                      </div>
                      <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12, marginBottom: 12 }}>Approximation: work created in the first 14 days from each PI’s earliest item is treated as planned.</div>
                      <div style={{ height: 220 }}><Bar data={unplannedWork.chartData} options={unplannedOptions} /></div>
                    </>}
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>🚨 Interruption Rate (P1/P2)</div>
            {dashLoading
              ? null
              : dashError
                ? <div style={{ color: 'var(--danger)' }}>❌ {dashError.message}</div>
                : !interruptionRate.sprints.length
                  ? <div style={{ color: 'var(--muted)' }}>No sprint interruption data available.</div>
                  : <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
                        <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 14 }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: '#eb3f3f' }}>{interruptionRate.totalInterruptions}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6 }}>Total interruptions</div>
                        </div>
                        <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 14 }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: '#1492ff' }}>{interruptionRate.averagePerSprint != null ? round(interruptionRate.averagePerSprint, 1) : '–'}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6 }}>Avg / sprint</div>
                        </div>
                        <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 14 }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: '#F5CC00' }}>{interruptionRate.worstSprint ? interruptionRate.worstSprint.count : '–'}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6 }}>Worst sprint{interruptionRate.worstSprint ? ` • ${interruptionRate.worstSprint.label}` : ''}</div>
                        </div>
                      </div>
                      <div style={{ height: 220 }}><Line data={interruptionRate.chartData} options={interruptionOptions} /></div>
                    </>}
          </div>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: 20, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>🎯 Sprint Goal Achievement</div>
          {velocityLoading
            ? null
            : velocityError
              ? <div style={{ color: 'var(--danger)' }}>❌ {velocityError.message}</div>
              : !sprintGoalAchievement.totalSprints
                ? <div style={{ color: 'var(--muted)' }}>No sprint goal data available.</div>
                : <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' }}>
                    <div>
                      <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 18, marginBottom: 12 }}>
                        <div style={{ fontSize: 34, fontWeight: 800, color: getAchievementColor(sprintGoalAchievement.achievementRate) }}>{sprintGoalAchievement.achievementRate != null ? `${round(sprintGoalAchievement.achievementRate, 1)}%` : '–'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Sprints achieved goal</div>
                        <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{sprintGoalAchievement.achievedSprints} of {sprintGoalAchievement.totalSprints} sprints met the ≥80% done threshold.</div>
                      </div>
                      <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12, marginBottom: 12 }}>⚠ Approximation: based on 80% done threshold — connect sprint goals in TFS for precise tracking.</div>
                      <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 14 }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Missed sprints</div>
                        {sprintGoalAchievement.missed.length
                          ? <div style={{ display: 'grid', gap: 8 }}>
                              {sprintGoalAchievement.missed.slice(0, 8).map(entry => (
                                <div key={entry.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                                  <span style={{ color: 'var(--text-primary)' }}>{entry.label}</span>
                                  <span style={{ color: getAchievementColor(entry.doneRate), fontWeight: 700 }}>{round(entry.doneRate, 1)}%</span>
                                </div>
                              ))}
                            </div>
                          : <div style={{ color: 'var(--muted)', fontSize: 12 }}>All measured sprints met the threshold.</div>}
                      </div>
                    </div>
                    <div style={{ height: 260 }}><Bar data={sprintGoalAchievement.chartData} options={sprintGoalOptions} /></div>
                  </div>}
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, marginTop: 24, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
          Predictive & Workforce Analytics
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {chartVisible('insights', 'wip-age') && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>⏳ WIP Age Chart</div>
              {dashLoading
                ? null
                : dashError
                  ? <div style={{ color: 'var(--danger)' }}>❌ {dashError.message}</div>
                  : !wipAgeData.total
                    ? <div style={{ color: 'var(--muted)' }}>No active feature items found for the selected scope.</div>
                    : <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
                          <MetricBox label="Active items" value={wipAgeData.total} color="#1492ff" />
                          <MetricBox label="Aged ≥30d" value={wipAgeData.aged} color={wipAgeData.aged ? '#ff7f0f' : '#068443'} />
                          <MetricBox label="Critical ≥60d" value={wipAgeData.critical} color={wipAgeData.critical ? '#eb3f3f' : '#068443'} />
                        </div>
                        {wipAgeData.oldest && (
                          <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 12, marginBottom: 12, color: 'var(--text-primary)', fontSize: 12 }}>
                            Oldest active item: <span style={{ color: '#eb3f3f', fontWeight: 700 }}>{wipAgeData.oldest.ageDays}d</span> — {wipAgeData.oldest.title}
                          </div>
                        )}
                        {wipAgeData.teamSummary.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                            {wipAgeData.teamSummary.map(team => (
                              <div key={team.team} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg-card2)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-primary)' }}>
                                <span style={{ width: 10, height: 10, background: team.color, display: 'inline-block' }} />
                                <span>{team.team}</span>
                                <span style={{ color: 'var(--text-muted, var(--muted))' }}>{team.count} active • oldest {team.oldestAge}d</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ height: 360 }}>
                          <Bar data={wipAgeData.chartData} options={wipAgeOptions} />
                        </div>
                      </>}
            </div>
          )}

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>🚧 Bottleneck Detector</div>
            {flowLoading
              ? null
              : flowError
                ? <div style={{ color: 'var(--danger)' }}>❌ {flowError.message}</div>
                : !bottleneckData?.perPi?.length
                  ? <div style={{ color: 'var(--muted)' }}>No PI flow stage data available.</div>
                  : <>
                      {bottleneckData.overall?.count > 5 && (
                        <div style={{ background: 'rgba(235,63,63,0.12)', border: '1px solid rgba(235,63,63,0.35)', color: '#eb3f3f', padding: '10px 12px', marginBottom: 12, fontWeight: 700 }}>
                          ⚠️ Bottleneck detected: {bottleneckData.overall.state} has {bottleneckData.overall.count} items stalled
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
                        <MetricBox label="Top bottleneck" value={bottleneckData.overall?.state || '–'} color="#ff7f0f" />
                        <MetricBox label="Items stalled" value={bottleneckData.overall?.count ?? 0} color={(bottleneckData.overall?.count || 0) > 5 ? '#eb3f3f' : '#068443'} />
                        <MetricBox label="PIs assessed" value={bottleneckData.perPi.length} color="#1492ff" />
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                        {bottleneckData.perPi.map(entry => (
                          <div key={entry.pi} style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)' }}>
                            <span style={{ fontWeight: 700 }}>{entry.pi}</span> • {entry.bottleneck} ({entry.count})
                          </div>
                        ))}
                      </div>
                      <div style={{ height: 280 }}>
                        <Bar data={bottleneckData.chartData} options={bottleneckOptions} />
                      </div>
                    </>}
          </div>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: 20, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>🎛 Scope Change Simulator</div>
          {dashLoading || velocityLoading
            ? null
            : dashError || velocityError
              ? <div style={{ color: 'var(--danger)' }}>❌ {(dashError || velocityError).message}</div>
              : !scopeSimComparison.baseSim || !scopeSimComparison.adjustedSim
                ? <div style={{ color: 'var(--muted)' }}>Not enough throughput history to simulate remaining scope.</div>
                : <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'start' }}>
                    <div>
                      <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 18, marginBottom: 12 }}>
                        <div style={{ fontSize: 34, fontWeight: 800, color: scopeAdj > 0 ? '#eb3f3f' : scopeAdj < 0 ? '#068443' : '#1492ff' }}>{scopeAdj > 0 ? `+${scopeAdj}` : scopeAdj}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Scope Adjustment</div>
                        <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>Base remaining {scopeSim.baseRemaining} → adjusted {scopeSim.adjusted} items</div>
                      </div>
                      <input type="range" min="-20" max="20" step="1" value={scopeAdj} onChange={event => setScopeAdj(Number(event.target.value))} style={{ width: '100%', accentColor: '#1492ff' }} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted, var(--muted))', fontSize: 12, marginTop: 6, marginBottom: 12 }}>
                        <span>-20 items</span>
                        <span>+20 items</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                        <MetricBox label="Base remaining" value={scopeSim.baseRemaining} color="#1492ff" />
                        <MetricBox label="Adjusted remaining" value={scopeSim.adjusted} color={scopeAdj > 0 ? '#eb3f3f' : scopeAdj < 0 ? '#068443' : '#1492ff'} />
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
                        {[
                          { label: 'Base Forecast', sim: scopeSimComparison.baseSim, risk: scopeSimComparison.baseRisk },
                          { label: 'Adjusted Forecast', sim: scopeSimComparison.adjustedSim, risk: scopeSimComparison.adjustedRisk },
                        ].map(card => (
                          <div key={card.label} style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 16 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 12, alignItems: 'center' }}>
                              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{card.label}</div>
                              <span style={{ background: `${card.risk.color}22`, border: `1px solid ${card.risk.color}55`, color: card.risk.color, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>
                                {card.risk.label}
                              </span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                              {[
                                { label: 'P50', value: card.sim?.p50 },
                                { label: 'P85', value: card.sim?.p85 },
                                { label: 'P95', value: card.sim?.p95 },
                              ].map(metric => (
                                <div key={metric.label}>
                                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{metric.value ?? '–'}</div>
                                  <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6 }}>{metric.label} sprints</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
                        {[
                          { label: 'P50 Δ', delta: scopeSimComparison.p50Delta },
                          { label: 'P85 Δ', delta: scopeSimComparison.p85Delta },
                          { label: 'P95 Δ', delta: scopeSimComparison.p95Delta },
                        ].map(metric => {
                          const deltaColor = metric.delta == null ? '#757575' : metric.delta > 0 ? '#eb3f3f' : metric.delta < 0 ? '#068443' : '#F5CC00';
                          const deltaLabel = metric.delta == null
                            ? '–'
                            : metric.delta > 0
                              ? `▲ +${metric.delta} sprints`
                              : metric.delta < 0
                                ? `▼ ${Math.abs(metric.delta)} sprints`
                                : '→ 0 sprints';
                          return (
                            <div key={metric.label} style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 14 }}>
                              <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>{metric.label}</div>
                              <div style={{ fontSize: 20, fontWeight: 700, color: deltaColor }}>{deltaLabel}</div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12 }}>⚠️ Simulation only — adjust scope in TFS to update actuals</div>
                    </div>
                  </div>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>🔧 KTLO % Distribution</div>
            {dashLoading
              ? null
              : dashError
                ? <div style={{ color: 'var(--danger)' }}>❌ {dashError.message}</div>
                : !ktloData.total
                  ? <div style={{ color: 'var(--muted)' }}>No feature or defect data available for work type analysis.</div>
                  : <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, alignItems: 'center' }}>
                      <div style={{ height: 260 }}>
                        <Doughnut data={ktloData.chartData} options={ktloOptions} />
                      </div>
                      <div>
                        <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', padding: 18, marginBottom: 12 }}>
                          <div style={{ fontSize: 34, fontWeight: 800, color: ktloData.ktloPct <= 30 ? '#068443' : ktloData.ktloPct <= 50 ? '#F5CC00' : '#eb3f3f' }}>{ktloData.ktloPct}%</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted, var(--muted))', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>KTLO share of total work</div>
                          <div style={{ color: 'var(--text-primary)', fontSize: 13 }}>{ktloData.ktloTotal} KTLO items across {ktloData.total} total items.</div>
                        </div>
                        <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
                          {[
                            { label: 'New Capability', value: ktloData.capability, pct: ktloData.capPct, color: '#1492ff' },
                            { label: 'Enablers', value: ktloData.enablers, pct: ktloData.enablerPct, color: '#F5CC00' },
                            { label: 'KTLO', value: ktloData.ktloTotal, pct: ktloData.ktloPct, color: '#eb3f3f', detail: `${ktloData.ktloFeatures} tagged features + ${ktloData.ktloDefects} defects` },
                          ].map(item => (
                            <div key={item.label}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{item.label}</span>
                                <span style={{ color: item.color, fontWeight: 700 }}>{item.value} ({item.pct}%)</span>
                              </div>
                              {item.detail && <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 11, marginBottom: 4 }}>{item.detail}</div>}
                              <div style={{ height: 6, background: 'var(--border)', borderRadius: 0, overflow: 'hidden' }}>
                                <div style={{ width: `${item.pct}%`, height: '100%', background: item.color }} />
                              </div>
                            </div>
                          ))}
                        </div>
                        <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12, marginBottom: 8 }}>Industry target: KTLO ≤30% of total effort — higher signals technical debt accumulation</div>
                        <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12 }}>Tag-based detection uses ktlo / maintenance / support markers plus all defects as reactive work.</div>
                      </div>
                    </div>}
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 12 }}>👻 Ghost Contributor Detection</div>
            {dashLoading
              ? null
              : dashError
                ? <div style={{ color: 'var(--danger)' }}>❌ {dashError.message}</div>
                : !ghostContributors.total
                  ? <div style={{ color: 'var(--muted)' }}>No assigned feature data available.</div>
                  : <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
                        <MetricBox label="Contributors tracked" value={ghostContributors.total} color="#1492ff" />
                        <MetricBox label="Ghost contributors" value={ghostContributors.ghosts.length} color={ghostContributors.ghosts.length ? '#eb3f3f' : '#068443'} />
                        <MetricBox label="Low activity" value={ghostContributors.lowActivity.length} color={ghostContributors.lowActivity.length ? '#F5CC00' : '#068443'} />
                      </div>
                      <div style={{ color: 'var(--text-muted, var(--muted))', fontSize: 12, marginBottom: 12 }}>⚠️ This reflects TFS assignment data only — cross-reference with team capacity before action</div>

                      <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Ghost contributors</div>
                      {ghostContributors.ghosts.length > 0
                        ? <div className="table-wrap" style={{ marginBottom: 16 }}>
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>Name</th>
                                  <th>Team</th>
                                  <th style={{ textAlign: 'center' }}>Assigned</th>
                                  <th style={{ textAlign: 'center' }}>Active</th>
                                  <th style={{ textAlign: 'center' }}>Done</th>
                                  <th style={{ textAlign: 'center' }}>Completion %</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ghostContributors.ghosts.map(person => (
                                  <tr key={person.name}>
                                    <td>{person.name}</td>
                                    <td>{person.team}</td>
                                    <td style={{ textAlign: 'center' }}>{person.total}</td>
                                    <td style={{ textAlign: 'center' }}>{person.active}</td>
                                    <td style={{ textAlign: 'center', color: '#eb3f3f', fontWeight: 700 }}>{person.done}</td>
                                    <td style={{ textAlign: 'center', color: '#eb3f3f', fontWeight: 700 }}>{person.completionPct}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        : <div style={{ color: 'var(--muted)', marginBottom: 16 }}>No ghost contributors detected.</div>}

                      <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Low activity contributors (&lt;10% completion)</div>
                      {ghostContributors.lowActivity.length > 0
                        ? <div className="table-wrap">
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>Name</th>
                                  <th>Team</th>
                                  <th style={{ textAlign: 'center' }}>Assigned</th>
                                  <th style={{ textAlign: 'center' }}>Active</th>
                                  <th style={{ textAlign: 'center' }}>Done</th>
                                  <th style={{ textAlign: 'center' }}>Completion %</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ghostContributors.lowActivity.map(person => (
                                  <tr key={person.name}>
                                    <td>{person.name}</td>
                                    <td>{person.team}</td>
                                    <td style={{ textAlign: 'center' }}>{person.total}</td>
                                    <td style={{ textAlign: 'center' }}>{person.active}</td>
                                    <td style={{ textAlign: 'center' }}>{person.done}</td>
                                    <td style={{ textAlign: 'center', color: getAchievementColor(person.completionPct), fontWeight: 700 }}>{person.completionPct}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        : <div style={{ color: 'var(--muted)' }}>No low activity contributors detected.</div>}
                    </>}
          </div>
        </div>
      </div>

      <ChartAnnotations
        section="insights"
        chartId={annPopup.chartId || ''}
        pi={activePi}
        team={selectedTeam}
        sprints={annPopup.sprints}
        open={annPopup.open}
        setOpen={open => setAnnPopup(v => ({ ...v, open }))}
        items={annItems}
        onDelete={handleDeleteAnnotation}
      />
    </>
  );
}

