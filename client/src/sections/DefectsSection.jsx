import { useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Filler, Title, Tooltip, Legend,
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar, Doughnut, Line, Chart } from 'react-chartjs-2';
import useStore from '../store/useStore.js';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/apiClient.js';
import { useFilteredDashboard, useDefectFieldStats, useDefectDensityTrend, useDefectVersionStats, usePredictability, useSprintTrend, useAnnotations, useConfig } from '../api/hooks.js';
import { COLORS, DEFECT_STATES } from '../constants.js';
import { extractTeamFromPath, shortIter, formatDate, sprintSortKey } from '../utils.js';
import { getTeamAreaPath, buildSectionTFSUrl, buildTFSQueryUrl, openChartTFS } from '../tfsLinks.js';
import TableModal from '../components/ui/TableModal.jsx';
import SlideshowPager from '../components/ui/SlideshowPager.jsx';
import CopyButton from '../components/ui/CopyButton.jsx';
import ChartAnnotations, { AnnotationButton, buildAnnotationLines } from '../components/ui/ChartAnnotations.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { SkeletonSection } from '../components/ui/SkeletonCard.jsx';
import { DataAge } from '../hooks/useDataAge.jsx';
import { usePolicies } from '../hooks/usePolicies.js';
import { TFSLink, TFSItemLink as ItemLink } from '../components/ui/TFSLink';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Filler, Title, Tooltip, Legend, ChartDataLabels,
);

function quarterToDateRange(label) {
  const [year, q] = label.split('-Q');
  const qNum = parseInt(q);
  const startMonth = (qNum - 1) * 3 + 1;
  const endMonth   = qNum * 3;
  const pad = n => String(n).padStart(2, '0');
  const start = `${year}-${pad(startMonth)}-01T00:00:00.000Z`;
  const endDate = new Date(parseInt(year), endMonth, 0);
  const end = `${year}-${pad(endMonth)}-${pad(endDate.getDate())}T23:59:59.999Z`;
  return { start, end };
}

const DONUT_COLORS = [
  '#0072db','#21837c','#F5CC00','#fa7000','#eb3f3f',
  '#858FFF','#068443','#ff7f0f','#1492ff','#6B7280',
];

const AGING_COLORS = ['#068443', '#21837c', '#F5CC00', '#ff7f0f', '#eb3f3f'];

const tabStyle = (active) => ({
  padding: '6px 16px', borderRadius: 0, border: '1px solid',
  borderColor: active ? 'var(--primary)' : 'var(--border)',
  background: active ? 'var(--primary)' : 'transparent',
  color: active ? '#fff' : 'var(--muted2)',
  cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400,
});

function sevColor(sev) {
  if (!sev) return 'var(--muted)';
  const s = String(sev).toLowerCase();
  if (s.includes('1') || s.includes('critical')) return 'var(--danger)';
  if (s.includes('2') || s.includes('high'))     return 'var(--warning)';
  if (s.includes('3') || s.includes('medium'))   return 'var(--caution)';
  return 'var(--muted)';
}

export default function DefectsSection() {
  const store        = useStore(s => s);
  const { selectedPIs, availablePIs, selectedTeam, tfsBaseUrl, currentPI } = store;
  const pis = selectedPIs.length
    ? selectedPIs
    : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);

  const pi = selectedPIs[0] || currentPI || '';

  const activeSnapshotId    = store.activeSnapshotId;
  const activeSnapshotLabel = store.activeSnapshotLabel;
  const teamPath            = getTeamAreaPath(store);
  const { data: cfg } = useConfig();
  const _classFld = cfg?.fieldMappings?.fields?.defectClassificationField || '';
  const _enhVal   = cfg?.fieldMappings?.stateValues?.defectEnhancementValue || 'Enhancement';
  const _projFld  = cfg?.fieldMappings?.fields?.defectProjectField || '';
  const _whereFld = cfg?.fieldMappings?.fields?.whereFoundField || '';

  const [tab,    setTab]    = useState('overview');
  const { tabVisible, chartVisible } = usePolicies();
  const [search, setSearch] = useState('');
  const [stateF, setStateF] = useState('');
  const [teamF,  setTeamF]  = useState('');
  const [howF,   setHowF]   = useState('');
  const [whereF, setWhereF] = useState('');
  const [sevF,   setSevF]   = useState('');
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [annPopup, setAnnPopup] = useState({ open: false, sprints: [], chartId: '' });
  const { data: dashData, isLoading, error, dataUpdatedAt } = useFilteredDashboard(pis, selectedTeam);
  const { data: fieldStats }  = useDefectFieldStats(pis, selectedTeam);
  const { data: densityData } = useDefectDensityTrend(pis, selectedTeam);
  const { data: predData }    = usePredictability(activeSnapshotId, teamPath);
  const { data: trendData, isLoading: trendLoading, error: trendError } = useSprintTrend(pi, selectedTeam);
  const { data: annData } = useAnnotations('defects', selectedPIs[selectedPIs.length - 1] || '', selectedTeam);
  const annItems = annData?.items || [];
  const qc = useQueryClient();

  async function handleDeleteAnnotation(id) {
    await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['annotations', 'defects'] });
  }

  function openAnnPopup(sprints, chartId = '') {
    setAnnPopup({ open: true, sprints, chartId });
  }
  const { data: verData,   isLoading: verLoading,  error: verError }   = useDefectVersionStats(teamPath);
  const TABS = [['overview', 'Overview'], ['trend', '📊 Defect Trend'], ['defects', 'Defects'], ['analysis', 'Analysis'], ['versions', '📦 Versions']]
    .filter(([id]) => tabVisible('defects', id));
  const firstTab = TABS[0]?.[0];

  useEffect(() => {
    if (TABS.length && !TABS.find(([id]) => id === tab)) setTab(firstTab);
  }, [TABS, tab, firstTab]);

  if (isLoading) return <SkeletonSection />;
  if (error)     return <div style={{ padding: 24, color: 'var(--danger)' }}>❌ {error.message}</div>;

  const d = dashData?.defects;
  if (!d?.items?.length) {
    return (
      <EmptyState
        title="No Defects Found"
        message="No defects match the current PI and team filters."
        icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16h.01" /></svg>}
      />
    );
  }


  // ── Defect Trend combo chart ───────────────────────────────────────────────
  const sprints      = trendData?.sprints || [];
  const sprintLabels = sprints.map(s => s.sprint || s.label || '');

  const defectTrendChartData = {
    labels: sprintLabels,
    datasets: [
      {
        type: 'bar',
        label: 'Defects Raised',
        data: sprints.map(s => s.defectTotal),
        backgroundColor: 'rgba(249,115,22,0.55)',
        borderColor: '#f97316',
        borderWidth: 1,
        borderRadius: 0,
        yAxisID: 'y',
        order: 2,
      },
      {
        type: 'bar',
        label: 'Defects Resolved',
        data: sprints.map(s => s.defectResolved),
        backgroundColor: 'rgba(6,132,67,0.7)',
        borderColor: '#068443',
        borderWidth: 1,
        borderRadius: 0,
        yAxisID: 'y',
        order: 2,
      },
      {
        type: 'line',
        label: 'Resolve Rate %',
        data: sprints.map(s => s.resolveRate ?? null),
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
        label: 'Escape Ratio %',
        data: sprints.map(s => s.escapeRatio),
        borderColor: '#f87171',
        backgroundColor: 'rgba(248,113,113,0.08)',
        borderWidth: 2,
        borderDash: [5, 4],
        pointRadius: 5,
        pointBackgroundColor: '#f87171',
        tension: 0.3,
        yAxisID: 'y1',
        order: 1,
        datalabels: { display: false },
      },
    ],
  };

  const defectTrendChartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#ADADAD', boxWidth: 12, padding: 14 } },
      datalabels: { display: false },
      annotation: {
        annotations: buildAnnotationLines(annItems, sprintLabels, handleDeleteAnnotation, 'defects-trend-overview'),
      },
      tooltip: {
        callbacks: {
          label: ctx => {
            const v = ctx.parsed.y;
            const isRate = ['Resolve Rate %', 'Escape Ratio %'].includes(ctx.dataset.label);
            return ` ${ctx.dataset.label}: ${v != null ? v + (isRate ? '%' : '') : '–'}`;
          },
        },
      },
    },
    scales: {
      x: { ticks: { color: '#ADADAD', maxRotation: 0 }, grid: { display: false } },
      y: {
        type: 'linear', position: 'left', beginAtZero: true,
        ticks: { color: '#ADADAD', stepSize: 1, precision: 0 },
        grid: { color: '#454545' },
        title: { display: true, text: 'Defect Count', color: '#ADADAD', font: { size: 11 } },
      },
      y1: {
        type: 'linear', position: 'right', beginAtZero: true, max: 100,
        ticks: { color: '#ADADAD', callback: v => v + '%' },
        grid: { display: false },
        title: { display: true, text: 'Rate %', color: '#ADADAD', font: { size: 11 } },
      },
    },
  };

  // ── Overview chart data ────────────────────────────────────────────────────

  const stateDonutData = {
    labels: DEFECT_STATES,
    datasets: [{
      data: DEFECT_STATES.map(s => d.stateCounts?.[s] ?? 0),
      backgroundColor: DEFECT_STATES.map(s => COLORS.defect[s] + 'cc'),
      borderColor: DEFECT_STATES.map(s => COLORS.defect[s]),
      borderWidth: 2,
    }],
  };

  const teams = Object.keys(d.teamBreakdown || {});
  const teamBarData = {
    labels: teams,
    datasets: DEFECT_STATES.map(s => ({
      label: s,
      data: teams.map(t => d.teamBreakdown[t]?.[s] ?? 0),
      backgroundColor: COLORS.defect[s] + '99',
      borderColor: COLORS.defect[s],
      borderWidth: 1,
      borderRadius: 0,
    })),
  };

  const mkSmallDonut = (breakdown) => {
    const entries = Object.entries(breakdown || {}).filter(([, v]) => v > 0);
    return {
      entries,
      chartData: {
        labels: entries.map(([k]) => k),
        datasets: [{
          data: entries.map(([, v]) => v),
          backgroundColor: DONUT_COLORS.slice(0, entries.length),
          borderColor: '#242424',
          borderWidth: 1,
        }],
      },
    };
  };

  const howFound   = mkSmallDonut(d.howFoundBreakdown);
  const whereFound = mkSmallDonut(d.whereFoundBreakdown);
  const sevDonut   = mkSmallDonut(d.severityBreakdown);

  const injEntries = Object.entries(d.injectionByIteration || {}).sort((a, b) => sprintSortKey(a[0]).localeCompare(sprintSortKey(b[0])));
  const injChartData = {
    labels: injEntries.map(([k]) => k.split('\\').pop() || k),
    datasets: [
      { label: 'Total', data: injEntries.map(([, v]) => v.total), backgroundColor: '#1492ff99', borderColor: '#1492ff', borderWidth: 1 },
      { label: 'Open',  data: injEntries.map(([, v]) => v.open),  backgroundColor: '#eb3f3f99', borderColor: '#eb3f3f', borderWidth: 1 },
    ],
  };

  const foundInEntries = Object.entries(d.foundInBreakdown || {}).filter(([, v]) => v > 0);
  const foundInData = {
    labels: foundInEntries.map(([k]) => k),
    datasets: [{
      data: foundInEntries.map(([, v]) => v),
      backgroundColor: DONUT_COLORS.slice(0, foundInEntries.length),
      borderColor: '#242424',
      borderWidth: 1,
    }],
  };

  const agingLabels = ['0–7 days', '8–14 days', '15–30 days', '31–60 days', '60+ days'];
  const agingChartData = {
    labels: agingLabels,
    datasets: [{
      label: 'Open Defects',
      data: agingLabels.map(l => d.agingBuckets?.[l] ?? 0),
      backgroundColor: AGING_COLORS.map(c => c + '99'),
      borderColor: AGING_COLORS,
      borderWidth: 2,
    }],
  };

  const critDefects = (d.items || [])
    .filter(i => (i.priority === 1 || i.priority === 2) && i.state !== 'Resolved' && i.state !== 'Removed')
    .sort((a, b) => {
      if ((a.priority || 9) !== (b.priority || 9)) return (a.priority || 9) - (b.priority || 9);
      return (a.changed ? new Date(a.changed) : 0) - (b.changed ? new Date(b.changed) : 0);
    });

  // ── Defects table data ─────────────────────────────────────────────────────

  const filtered = (d.items || []).filter(item => {
    const team = extractTeamFromPath(item.area);
    if (stateF && item.state !== stateF) return false;
    if (teamF  && team !== teamF) return false;
    if (howF   && (item.howFound   || 'Unknown') !== howF) return false;
    if (whereF && (item.whereFound || 'Unknown') !== whereF) return false;
    if (sevF   && (item.severity   || 'Unknown') !== sevF) return false;
    if (search && !item.title?.toLowerCase().includes(search.toLowerCase()) && !String(item.id).includes(search)) return false;
    return true;
  });

  const sortedFiltered = useMemo(() => {
    const rows = [...filtered];
    if (!sortKey) return rows;

    rows.sort((a, b) => {
      const valuesA = {
        id: Number(a.id) || 0,
        title: a.title || '',
        state: a.state || '',
        team: extractTeamFromPath(a.area),
        severity: a.severity || '',
        priority: Number(a.priority) || 0,
        rank: Number(a.rank) || 0,
        howFound: a.howFound || '',
        whereFound: a.whereFound || '',
        sprint: shortIter(a.iter),
        changed: a.changed ? new Date(a.changed).getTime() : 0,
      };
      const valuesB = {
        id: Number(b.id) || 0,
        title: b.title || '',
        state: b.state || '',
        team: extractTeamFromPath(b.area),
        severity: b.severity || '',
        priority: Number(b.priority) || 0,
        rank: Number(b.rank) || 0,
        howFound: b.howFound || '',
        whereFound: b.whereFound || '',
        sprint: shortIter(b.iter),
        changed: b.changed ? new Date(b.changed).getTime() : 0,
      };

      if (['id', 'priority', 'rank'].includes(sortKey)) return valuesA[sortKey] - valuesB[sortKey];
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

  const raised  = fieldStats?.byQuarter?.raised || {};
  const closed  = fieldStats?.byQuarter?.closed || {};
  const qLabels = [...new Set([...Object.keys(raised), ...Object.keys(closed)])].sort();
  const netDelta = qLabels.map(k => (raised[k] || 0) - (closed[k] || 0));
  const qChartData = {
    labels: qLabels,
    datasets: [
      { label: 'Raised', data: qLabels.map(k => raised[k] || 0), backgroundColor: '#eb3f3fbb', borderColor: '#eb3f3f', borderWidth: 1, borderRadius: 0 },
      { label: 'Closed', data: qLabels.map(k => closed[k] || 0), backgroundColor: '#06844380', borderColor: '#068443', borderWidth: 1, borderRadius: 0 },
      { label: 'Net (Raised−Closed)', type: 'line', data: netDelta,
        borderColor: '#f4a261', backgroundColor: '#f4a26133',
        borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#f4a261',
        tension: 0.3, fill: false, yAxisID: 'yNet' },
    ],
  };

  const burnLabels = (trendData?.sprints || []).map(s => s.sprint || s.label || '');
  let running = 0;
  const burnData = (trendData?.sprints || []).map(s => {
    running += (s.defectTotal || 0) - (s.defectResolved || 0);
    return running;
  });
  const burnChartData = {
    labels: burnLabels,
    datasets: [{
      label: 'Net Open Defects (cumulative)',
      data: burnData,
      borderColor: burnData[burnData.length - 1] > 0 ? '#eb3f3f' : '#068443',
      backgroundColor: burnData[burnData.length - 1] > 0 ? '#eb3f3f22' : '#06844322',
      borderWidth: 2.5,
      fill: true,
      pointBackgroundColor: burnData.map(v => v > 0 ? '#eb3f3f' : '#068443'),
      pointRadius: 4,
      tension: 0.3,
    }],
  };

  // TFS links for field stats charts
  const _area     = (getTeamAreaPath(store) || store.areaPath || '');
  const _iterBase = store.iterationPath;
  const quarterTfsUrl = (() => {
    if (!store.tfsBaseUrl || !_area) return null;
    const year = new Date().getFullYear();
    let wiql = `SELECT [System.Id],[System.Title],[System.State],[System.CreatedDate],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='Defect' AND [System.State]<>'Removed' ${_classFld ? `AND [${_classFld}]<>'${_enhVal}' ` : ''}AND [System.CreatedDate]>='${year}-01-01T00:00:00.000Z' AND [System.AreaPath] UNDER '${_area}' ORDER BY [System.CreatedDate]`;
    return buildTFSQueryUrl(store.tfsBaseUrl, wiql);
  })();
  const fieldDefectsTfsUrl = (() => {
    if (!store.tfsBaseUrl || !_area) return null;
    const projField = _projFld || 'System.Id';
    let wiql = `SELECT [System.Id],[System.Title],[System.State],[${projField}],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='Defect' AND [System.State]<>'Removed' ${_classFld ? `AND [${_classFld}]<>'${_enhVal}' ` : ''}AND [Microsoft.VSTS.CMMI.HowFound]='Found In Field' AND [System.AreaPath] UNDER '${_area}'`;
    if (pis?.length && _iterBase) {
      const piParts = pis.map(pi => `[System.IterationPath] UNDER '${_iterBase}\\${pi}'`);
      wiql += ` AND (${piParts.join(' OR ')})`;
    }
    wiql += ` ORDER BY [${projField}]`;
    return buildTFSQueryUrl(store.tfsBaseUrl, wiql);
  })();

  const byP = fieldStats?.byProject || {};
  const projLabels = Object.keys(byP).sort((a, b) => byP[b] - byP[a]);
  const projChartData = {
    labels: projLabels,
    datasets: [{
      label: 'Field Defects',
      data: projLabels.map(k => byP[k]),
      backgroundColor: '#eb3f3fbb',
      borderColor: '#eb3f3f',
      borderWidth: 1,
      borderRadius: 0,
    }],
  };

  // ── Analysis data ──────────────────────────────────────────────────────────

  const trend = densityData?.trend || [];
  const densityLineData = {
    labels: trend.map(pt => pt.pi || ''),
    datasets: [
      {
        label: 'Live Density',
        data: trend.map(pt => pt.liveDensity),
        borderColor: '#1492ff',
        backgroundColor: '#1492ff22',
        borderWidth: 2,
        pointBackgroundColor: '#1492ff',
        pointRadius: 4,
        tension: 0.3,
        fill: true,
      },
      ...(trend.some(pt => pt.baselineDensity != null) ? [{
        label: 'Baseline Density',
        data: trend.map(pt => pt.baselineDensity),
        borderColor: '#ff7f0f',
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [4, 4],
        pointBackgroundColor: '#ff7f0f',
        pointRadius: 3,
        tension: 0.3,
        fill: false,
      }] : []),
    ],
  };

  const slaBreaches = d.slaBreaches || [];

  // ── Resolve-By (Generic04) chart data ────────────────────────────────────
  const resolveByRaw = d.resolveByBreakdown || {};
  const notSetCount  = resolveByRaw['Not Set'] || 0;
  const resolveByEntries = Object.entries(resolveByRaw)
    .filter(([k]) => k !== 'Not Set')          // exclude from chart; shown separately
    .sort(([a], [b]) => a.localeCompare(b));
  const totalOpenDefects = Object.values(resolveByRaw).reduce((s, v) => s + v, 0);
  const resolveByChartData = {
    labels: resolveByEntries.map(([k]) => k),
    datasets: [{
      label: 'Open Defects',
      data: resolveByEntries.map(([, v]) => v),
      backgroundColor: '#f9731699',
      borderColor: '#f97316',
      borderWidth: 1,
      borderRadius: 2,
    }],
  };
  const resolveByChartOpts = {
    indexAxis: 'y',
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      datalabels: {
        anchor: 'end', align: 'end',
        color: '#ADADAD', font: { size: 11 },
        formatter: v => v,
      },
      tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x} open defect${ctx.parsed.x !== 1 ? 's' : ''}` } },
    },
    scales: {
      x: { beginAtZero: true, ticks: { color: '#ADADAD', precision: 0 }, grid: { color: '#454545' } },
      y: { ticks: { color: '#ADADAD', font: { size: 11 } }, grid: { display: false } },
    },
  };

  // Items for resolve-by drilldown (open, not closed/removed)
  const isOpenDefect = i => !['Resolved','Closed'].includes(i.state) && i.state !== 'Removed';
  const resolveByItems = (d.items || []).filter(isOpenDefect).sort((a, b) => {
    const ra = a.resolveBy || '', rb = b.resolveBy || '';
    if (!ra && rb)  return 1;
    if (ra  && !rb) return -1;
    if (ra !== rb)  return ra.localeCompare(rb);
    return (a.priority || 9) - (b.priority || 9);
  });
  const notSetItems = resolveByItems.filter(i => !i.resolveBy);

  // ── Shared chart options ───────────────────────────────────────────────────

  const commonDonutOpts = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: {
      legend: { position: 'right', labels: { color: '#ADADAD', boxWidth: 10, padding: 8, font: { size: 11 } } },
      datalabels: { display: false },
      tooltip: {
        callbacks: {
          label: ctx => {
            const tot = ctx.dataset.data.reduce((a, b) => a + b, 0);
            return ` ${ctx.label}: ${ctx.raw} (${tot > 0 ? Math.round(ctx.raw / tot * 100) : 0}%)`;
          },
        },
      },
    },
  };

  const stackedBarOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { boxWidth: 10, padding: 8, color: '#ADADAD' } },
      datalabels: { display: false },
    },
    scales: {
      x: { stacked: true, ticks: { color: '#ADADAD' }, grid: { display: false } },
      y: { stacked: true, ticks: { color: '#ADADAD' }, grid: { color: '#454545' }, beginAtZero: true },
    },
  };

  const agingClauses = {
    '0\u20137 days':   [`[System.CreatedDate] >= @Today-7`,  `[System.State] NOT IN ('Resolved','Closed','Removed')`],
    '8\u201314 days':  [`[System.CreatedDate] >= @Today-14`, `[System.CreatedDate] < @Today-7`,  `[System.State] NOT IN ('Resolved','Closed','Removed')`],
    '15\u201330 days': [`[System.CreatedDate] >= @Today-30`, `[System.CreatedDate] < @Today-15`, `[System.State] NOT IN ('Resolved','Closed','Removed')`],
    '31\u201360 days': [`[System.CreatedDate] >= @Today-60`, `[System.CreatedDate] < @Today-31`, `[System.State] NOT IN ('Resolved','Closed','Removed')`],
    '60+ days':        [`[System.CreatedDate] < @Today-60`,  `[System.State] NOT IN ('Resolved','Closed','Removed')`],
  };

  const stateDonutOpts = {
    ...commonDonutOpts,
    onClick: (evt, elements) => {
      if (!elements.length) return;
      const state = stateDonutData.labels[elements[0].index];
      openChartTFS(store, pis, 'Defect', [`[System.State]='${state}'`]);
    },
    onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
  };

  const teamBarOpts = {
    ...stackedBarOpts,
    plugins: {
      ...stackedBarOpts.plugins,
      annotation: {
        annotations: buildAnnotationLines(annItems, teams, handleDeleteAnnotation, 'defects-by-team'),
      },
    },
    onClick: (evt, elements) => {
      if (!elements.length) return;
      const teamName = teamBarData.labels[elements[0].index];
      const state    = teamBarData.datasets[elements[0].datasetIndex].label;
      const allItems = d.items || [];
      const teamItem = allItems.find(i => {
        const seg = (i.area || '').replace(/\//g, '\\').split('\\').pop();
        return seg === teamName;
      });
      let teamArea = null;
      if (teamItem) {
        const area  = (teamItem.area || '').replace(/\//g, '\\');
        const roots = Array.isArray(store.teamRootPath) ? store.teamRootPath : store.teamRootPath ? [store.teamRootPath] : [];
        for (const root of roots) {
          const base = root.replace(/\\$/, '');
          if (area.startsWith(base)) {
            teamArea = `${base}\\${area.slice(base.length + 1).split('\\')[0]}`;
            break;
          }
        }
      }
      openChartTFS(store, pis, 'Defect', [`[System.State]='${state}'`], teamArea);
    },
    onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
  };

  const smallDonutOpts = {
    'How Found': {
      ...commonDonutOpts,
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const val = howFound.chartData.labels[elements[0].index];
        openChartTFS(store, pis, 'Defect', [`[System.State]<>'Removed'`, `[Microsoft.VSTS.CMMI.HowFound]='${val}'`]);
      },
      onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
    },
    'Where Found': {
      ...commonDonutOpts,
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const val = whereFound.chartData.labels[elements[0].index];
        const clauses = [`[System.State]<>'Removed'`];
        if (_whereFld) clauses.push(`[${_whereFld}]='${val}'`);
        openChartTFS(store, pis, 'Defect', clauses);
      },
      onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
    },
    'Severity': {
      ...commonDonutOpts,
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const val = sevDonut.chartData.labels[elements[0].index];
        openChartTFS(store, pis, 'Defect', [`[System.State]<>'Removed'`, `[Microsoft.VSTS.Common.Severity]='${val}'`]);
      },
      onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
    },
  };

  const injBarOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { boxWidth: 10, padding: 8, color: '#ADADAD' } },
      datalabels: { display: false },
      annotation: {
        annotations: buildAnnotationLines(annItems, injChartData.labels, handleDeleteAnnotation, 'defects-injection'),
      },
    },
    scales: {
      x: { ticks: { color: '#ADADAD', maxRotation: 45, minRotation: 30 }, grid: { display: false } },
      y: { ticks: { color: '#ADADAD' }, grid: { color: '#454545' }, beginAtZero: true },
    },
    onClick: (evt, elements) => {
      if (!elements.length) return;
      // Use the full iteration path key to avoid missing PI intermediate directory bug
      const fullIterPath = injEntries[elements[0].index]?.[0];
      if (!fullIterPath) return;
      openChartTFS(store, pis, 'Defect', [`[System.IterationPath] UNDER '${fullIterPath}'`]);
    },
    onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
  };

  const foundInDonutOpts = {
    ...commonDonutOpts,
    onClick: (evt, elements) => {
      if (!elements.length) return;
      const val = foundInData.labels[elements[0].index];
      openChartTFS(store, pis, 'Defect', [`[System.State]<>'Removed'`, ...(_classFld ? [`[${_classFld}]<>'${_enhVal}'`] : []), `[Microsoft.VSTS.Build.FoundIn]='${val}'`]);
    },
    onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
  };

  const agingBarOpts = {
    indexAxis: 'y',
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      datalabels: { anchor: 'end', align: 'right', color: '#ADADAD', font: { size: 10, weight: '700' } },
      tooltip: { callbacks: { label: ctx => ` ${ctx.raw} defects` } },
    },
    scales: {
      x: { ticks: { color: '#ADADAD' }, grid: { color: '#454545' }, beginAtZero: true },
      y: { ticks: { color: '#ADADAD', font: { weight: 'bold' } }, grid: { display: false } },
    },
    layout: { padding: { right: 36 } },
    onClick: (evt, elements) => {
      if (!elements.length) return;
      const label   = agingChartData.labels[elements[0].index];
      const clauses = agingClauses[label];
      if (!clauses) return;
      openChartTFS(store, pis, 'Defect', clauses);
    },
    onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
  };

  const qChartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#ADADAD', boxWidth: 12 } },
      datalabels: { display: false },
      annotation: {
        annotations: buildAnnotationLines(annItems, qLabels, handleDeleteAnnotation, 'defects-quarterly'),
      },
      tooltip: { mode: 'index' },
    },
    scales: {
      x: { ticks: { color: '#ADADAD' }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: '#ADADAD', precision: 0 }, grid: { color: '#454545' } },
      yNet: { display: false, beginAtZero: true },
    },
    onClick: (evt, elements) => {
      if (!elements.length) return;
      const label  = qChartData.labels[elements[0].index];
      const dsIdx  = elements[0].datasetIndex;
      if (dsIdx === 2) return;
      const range  = quarterToDateRange(label);
      const area   = getTeamAreaPath(store) || store.areaPath || '';
      if (!store.tfsBaseUrl || !area) return;
      let wiql;
      if (dsIdx === 0) {
        wiql = `SELECT [System.Id],[System.Title],[System.State],[System.CreatedDate] FROM WorkItems WHERE [System.WorkItemType]='Defect' AND [System.State]<>'Removed' ${_classFld ? `AND [${_classFld}]<>'${_enhVal}' ` : ''}AND [System.AreaPath] UNDER '${area}' AND [System.CreatedDate]>='${range.start}' AND [System.CreatedDate]<='${range.end}' ORDER BY [System.CreatedDate]`;
      } else {
        wiql = `SELECT [System.Id],[System.Title],[System.State],[Microsoft.VSTS.Common.ClosedDate] FROM WorkItems WHERE [System.WorkItemType]='Defect' AND [System.AreaPath] UNDER '${area}' AND ([System.State]='Closed' OR [System.State]='Resolved') AND [Microsoft.VSTS.Common.ClosedDate]>='${range.start}' AND [Microsoft.VSTS.Common.ClosedDate]<='${range.end}' ORDER BY [Microsoft.VSTS.Common.ClosedDate]`;
      }
      const url = buildTFSQueryUrl(store.tfsBaseUrl, wiql);
      if (url) window.open(url, '_blank', 'noopener');
    },
    onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
  };

  const projBarOpts = {
    indexAxis: 'y',
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      datalabels: { anchor: 'end', align: 'right', color: '#ADADAD', font: { size: 10, weight: '700' } },
      tooltip: { callbacks: { label: ctx => ` ${ctx.raw} defect${ctx.raw !== 1 ? 's' : ''}` } },
    },
    scales: {
      x: { ticks: { color: '#aaa', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true },
      y: { ticks: { color: '#ccc', font: { size: 10 } } },
    },
    layout: { padding: { right: 36 } },
    onClick: (evt, elements) => {
      if (!elements.length) return;
      const project  = projChartData.labels[elements[0].index];
      const area     = getTeamAreaPath(store) || store.areaPath || '';
      if (!store.tfsBaseUrl || !area) return;
      const iterBase = store.iterationPath;
      const projField = _projFld || 'System.Id';
      let wiql = `SELECT [System.Id],[System.Title],[System.State],[${projField}] FROM WorkItems WHERE [System.WorkItemType]='Defect' AND [System.State]<>'Removed' `;
      if (_classFld) wiql += `AND [${_classFld}]<>'${_enhVal}' `;
      wiql += `AND [Microsoft.VSTS.CMMI.HowFound]='Found In Field' AND [System.AreaPath] UNDER '${area}' `;
      if (_projFld) wiql += `AND [${_projFld}]='${project}' `;
      if (pis?.length && iterBase) {
        wiql += ` AND (${pis.map(pi => `[System.IterationPath] UNDER '${iterBase}\\${pi}'`).join(' OR ')})`;
      }
      wiql += ` ORDER BY [${projField}]`;
      const url = buildTFSQueryUrl(store.tfsBaseUrl, wiql);
      if (url) window.open(url, '_blank', 'noopener');
    },
    onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
  };

  // Slideshow mode — 4 pages
  if (store.slideshowRunning) {
    const defTfsUrl = buildSectionTFSUrl(store, 'Defect', pis);
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="section-header" style={{ flexShrink: 0 }}>
          <h1 className="section-title">🛡 Defects</h1><div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {pis.map(pi => <span key={pi} className="pi-tag">{pi}</span>)}
            {defTfsUrl && <TFSLink href={defTfsUrl} label="Open in TFS" />}
          </div>
        </div>
        <SlideshowPager label="🛡 Defects" pages={[
          /* Page 0: Defect Trend combo chart */
          <div style={{ height: '100%', overflowY: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
              {[
                { label: 'Total Sprints',        value: sprints.length,                                                                                              color: '#60a5fa' },
                { label: 'Defects Raised',        value: sprints.reduce((a, s) => a + (s.defectTotal    || 0), 0),                                                   color: '#f97316' },
                { label: 'Defects Resolved',      value: sprints.reduce((a, s) => a + (s.defectResolved || 0), 0),                                                   color: '#4ade80' },
                { label: 'Avg Resolve Rate',      value: sprints.length ? Math.round(sprints.reduce((a, s) => a + (s.resolveRate  || 0), 0) / sprints.length) + '%' : '–', color: '#39ff14' },
                { label: 'Avg Escape Ratio',      value: sprints.length ? Math.round(sprints.reduce((a, s) => a + (s.escapeRatio  || 0), 0) / sprints.length) + '%' : '–', color: '#f87171' },
              ].map(k => (
                <div key={k.label} className="card" style={{ padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</div>
                </div>
              ))}
            </div>
            
            {trendData && sprints.length > 0 ? (
              <div className="card">
                <div className="card-header"><span className="card-title">📊 Defect Trend Overview</span><span style={{
    fontSize: 11,
    color: 'var(--muted)',
    marginLeft: 10
  }}>Bars = counts (left) · Lines = rates % (right)</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels, 'defects-trend-overview')} /><CopyButton type="chart" /></div></div>
                <div className="chart-wrap" style={{ height: 280 }}>
                  <Chart type="bar" data={defectTrendChartData} options={defectTrendChartOpts} />
                </div>
              </div>
            ) : !trendLoading && (
              <div style={{ color: 'var(--muted)', padding: 24, textAlign: 'center' }}>Select a PI to view defect trend.</div>
            )}
          </div>,

          /* Page 1: KPI strip + Defect Distribution + Escape Ratio */
          <div style={{ height: '100%', overflowY: 'hidden' }}>
            <div className="kpi-strip">
              <div className="kpi-card red">   <div className="kpi-val">{d.total ?? '–'}</div>               <div className="kpi-lbl">Total Defects</div></div>
              <div className="kpi-card red">   <div className="kpi-val">{d.stateCounts?.New ?? '–'}</div>    <div className="kpi-lbl">New</div></div>
              <div className="kpi-card orange"><div className="kpi-val">{d.stateCounts?.Accepted ?? '–'}</div><div className="kpi-lbl">Accepted</div></div>
              <div className="kpi-card teal">  <div className="kpi-val">{d.stateCounts?.Resolved ?? '–'}</div><div className="kpi-lbl">Resolved</div></div>
              <div className="kpi-card green"> <div className="kpi-val">{d.stateCounts?.Closed ?? '–'}</div> <div className="kpi-lbl">Closed</div></div>
              <div className="kpi-card orange"><div className="kpi-val">{d.escapeRatio != null ? d.escapeRatio + '%' : '–'}</div><div className="kpi-lbl">Escape Ratio</div></div>
              <div className="kpi-card red">   <div className="kpi-val">{d.p1p2Count ?? '–'}</div>           <div className="kpi-lbl">P1/P2</div></div>
            </div>
            <div className="charts-grid-2">
              <div className="card">
                <div className="card-header"><span className="card-title">🐛 Defect Distribution</span><span className="card-sub">By state</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels, 'defects-distribution')} /><CopyButton type="chart" /></div></div>
                <div style={{ height: 240 }}><Doughnut data={stateDonutData} options={stateDonutOpts} /></div>
              </div>
              {teams.length > 0 && (
                <div className="card">
                  <div className="card-header"><span className="card-title">Defects by Team</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(teams, 'defects-by-team')} /><CopyButton type="chart" /></div></div>
                  <div style={{ height: 240 }}><Bar data={teamBarData} options={teamBarOpts} /></div>
                </div>
              )}
            </div>
            <div className="charts-grid-2 mt-16">
              <div className="card">
                <div className="card-header"><span className="card-title">📉 Defect Escape Ratio</span><span className="card-sub">In Field vs In House</span></div>
                <div style={{ height: 220 }}>
                  <Doughnut
                    data={{ labels: ['In Field', 'In House'], datasets: [{ data: [d.escaped ?? 0, d.caught ?? 0], backgroundColor: ['#eb3f3f99', '#06844399'], borderColor: ['#eb3f3f', '#068443'], borderWidth: 2, hoverOffset: 6 }] }}
                    options={{ responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, color: '#ADADAD' } }, datalabels: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}` } } } }}
                  />
                </div>
              </div>
            </div>
          </div>,

          /* Page 2: How Found + Where Found + Severity + Injection by Sprint */
          <div style={{ height: '100%', overflowY: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 8 }}>
              {[
                { title: 'How Found',   cd: howFound },
                { title: 'Where Found', cd: whereFound },
                { title: 'Severity',    cd: sevDonut },
              ].map(({ title, cd }) => (
                <div key={title} className="card">
                  <div className="card-header"><span className="card-title">{title}</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels, title === 'How Found' ? 'defects-how-found' : title === 'Where Found' ? 'defects-where-found' : 'defects-severity')} /><CopyButton type="chart" /></div></div>
                  <div style={{ height: 200 }}>
                    {cd.entries.length > 0
                      ? <Doughnut data={cd.chartData} options={smallDonutOpts[title] ?? commonDonutOpts} />
                      : <div style={{ color: 'var(--muted)', padding: 16, textAlign: 'center' }}>No data</div>}
                  </div>
                </div>
              ))}
            </div>
            <div className="card mt-16">
              <div className="card-header"><span className="card-title">Defect Injection by Sprint</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels, 'defects-injection')} /><CopyButton type="chart" /></div></div>
              <div style={{ height: 240 }}>
                {injEntries.length > 0
                  ? <Bar data={injChartData} options={injBarOpts} />
                  : <div style={{ color: 'var(--muted)', padding: 16 }}>No injection data</div>}
              </div>
            </div>
          </div>,

          /* Page 3: Found-In + Aging + Critical Defects */
          <div style={{ height: '100%', overflowY: 'hidden' }}>
            <div className="charts-grid-2">
              <div className="card">
                <div className="card-header"><span className="card-title">Found-In Breakdown</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels, 'defects-found-in')} /><CopyButton type="chart" /></div></div>
                <div style={{ height: 240 }}>
                  {foundInEntries.length > 0
                    ? <Doughnut data={foundInData} options={foundInDonutOpts} />
                    : <div style={{ color: 'var(--muted)', padding: 16, textAlign: 'center' }}>No data</div>}
                </div>
              </div>
              <div className="card">
                <div className="card-header"><span className="card-title">Defect Aging</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels, 'defects-aging')} /><CopyButton type="chart" /></div></div>
                <div style={{ height: 240 }}>
                  <Bar data={agingChartData} options={agingBarOpts} />
                </div>
              </div>
            </div>
            <div className="card mt-16">
              <div className="card-header"><span className="card-title">Critical Defects (P1/P2)</span><div className="card-actions"><TableModal label="Critical Defects" title="Critical Defects (P1/P2)" badge={critDefects.length}>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr><th>ID</th><th>Title</th><th>Priority</th><th>State</th><th>Team</th><th>Sprint</th><th>Changed</th></tr></thead>
                      <tbody>
                        {critDefects.length === 0 ? <tr><td colSpan="7" style={{
                textAlign: 'center',
                color: 'var(--success)',
                padding: 24
              }}>✅ No P1/P2 open defects</td></tr> : critDefects.map(item => {
              const prioColor = item.priority === 1 ? 'var(--danger)' : 'var(--warning)';
              return <tr key={item.id}>
                                  <td className="id-cell"><ItemLink id={item.id} tfsBaseUrl={tfsBaseUrl} /></td>
                                  <td className="title-cell" title={item.title || ''}>{item.title || '–'}</td>
                                  <td style={{
                  fontWeight: 700,
                  color: prioColor,
                  textAlign: 'center'
                }}>P{item.priority}</td>
                                  <td><span className={`state-badge state-${item.state}`}>{item.state}</span></td>
                                  <td>{extractTeamFromPath(item.area)}</td>
                                  <td style={{
                  fontSize: 11,
                  color: 'var(--muted2)'
                }}>{shortIter(item.iter)}</td>
                                  <td style={{
                  fontSize: 11,
                  color: 'var(--muted2)'
                }}>{formatDate(item.changed)}</td>
                                </tr>;
            })}
                      </tbody>
                    </table>
                  </div>
                </TableModal></div></div>
            </div>
          </div>,

          /* Page 4: Quarterly / Field stats + Density Trend */
          <div style={{ height: '100%', overflowY: 'hidden' }}>
            {qLabels.length > 0 && (
              <div className="card">
                <div className="card-header"><span className="card-title">Quarterly Raised vs Closed</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(qLabels, 'defects-quarterly')} /><CopyButton type="chart" /></div></div>
                <div style={{ height: 260 }}>
                  <Bar data={qChartData} options={qChartOpts} />
                </div>
              </div>
            )}
            {projLabels.length > 0 && (
              <div className="card mt-16">
                <div className="card-header"><span className="card-title">Field Defects by Project</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels, 'defects-field-project')} /><CopyButton type="chart" /></div></div>
                <div style={{ height: Math.max(200, projLabels.length * 28 + 40) }}>
                  <Bar data={projChartData} options={projBarOpts} />
                </div>
              </div>
            )}
            <div className="card mt-16">
              <div className="card-header"><span className="card-title">Defect Density Trend</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(densityLineData.labels, 'defects-density-trend')} /><CopyButton type="chart" /></div></div>
              <div style={{ height: 280 }}>
                {trend.length > 0
                  ? <Line data={densityLineData} options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: {
                        legend: { labels: { color: '#cfd8e3', font: { size: 12 } } },
                        datalabels: { display: false },
                        annotation: {
                          annotations: buildAnnotationLines(annItems, densityLineData.labels, handleDeleteAnnotation, 'defects-density-trend'),
                        },
                      },
                      scales: {
                        x: { ticks: { color: '#ADADAD' }, grid: { color: '#454545' } },
                        y: { beginAtZero: true, title: { display: true, text: 'Defects per Feature', color: '#8aa3be' }, ticks: { color: '#ADADAD' }, grid: { color: '#454545' } },
                      },
                    }} />
                  : <div style={{ color: 'var(--muted)', padding: 24, textAlign: 'center' }}>No density trend data available for selected PIs.</div>}
              </div>
            </div>
          </div>,
        ]} />
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">🛡 Defects</h1>
        <DataAge updatedAt={dataUpdatedAt} />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {pis.map(pi => <span key={pi} className="pi-tag">{pi}</span>)}
          {(() => {
            const url = buildSectionTFSUrl(store, 'Defect', pis);
            return url ? <TFSLink href={url} label="Open in TFS" /> : null;
          })()}
        </div>
      </div>

      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {TABS.map(([id, label]) => (
          <button key={id} style={tabStyle(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {/* ── OVERVIEW ────────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <>
          <div className="kpi-strip">
            <div className="kpi-card red">   <div className="kpi-val">{d.total ?? '–'}</div>               <div className="kpi-lbl">Total Defects</div></div>
            <div className="kpi-card red">   <div className="kpi-val">{d.stateCounts?.New ?? '–'}</div>    <div className="kpi-lbl">New</div></div>
            <div className="kpi-card orange"><div className="kpi-val">{d.stateCounts?.Accepted ?? '–'}</div><div className="kpi-lbl">Accepted</div></div>
            <div className="kpi-card teal">  <div className="kpi-val">{d.stateCounts?.Resolved ?? '–'}</div><div className="kpi-lbl">Resolved</div></div>
            <div className="kpi-card green"> <div className="kpi-val">{d.stateCounts?.Closed ?? '–'}</div> <div className="kpi-lbl">Closed</div></div>
            <div className="kpi-card orange"><div className="kpi-val">{d.escapeRatio != null ? d.escapeRatio + '%' : '–'}</div><div className="kpi-lbl">Escape Ratio</div></div>
            <div className="kpi-card red">   <div className="kpi-val">{d.p1p2Count ?? '–'}</div>           <div className="kpi-lbl">P1/P2</div></div>
          </div>

          {/* State donut + Team bar */}
          <div className="charts-grid-2">
            {chartVisible('defects', 'distribution') && (
              <div className="card">
                <div className="card-header"><span className="card-title">🐛 Defect Distribution</span><span className="card-sub">By state</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels, 'defects-distribution')} /><CopyButton type="chart" /></div></div>
                <div style={{ height: 240 }}>
                  <Doughnut data={stateDonutData} options={stateDonutOpts} />
                </div>
              </div>
            )}
            {teams.length > 0 && chartVisible('defects', 'by-team') && (
              <div className="card">
                <div className="card-header"><span className="card-title">Defects by Team</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(teams, 'defects-by-team')} /><CopyButton type="chart" /></div></div>
                <div style={{ height: 240 }}>
                  <Bar data={teamBarData} options={teamBarOpts} />
                </div>
              </div>
            )}
          </div>

          {/* Escape Ratio doughnut */}
          <div className="charts-grid-2 mt-16">
            {chartVisible('defects', 'escape-ratio') && (
              <div className="card">
                <div className="card-header">
                  <span className="card-title">📉 Defect Escape Ratio</span>
                  <span className="card-sub">In Field vs In House</span>
                </div>
                <div style={{ height: 220 }}>
                  <Doughnut
                    data={{
                      labels: ['In Field', 'In House'],
                      datasets: [{
                        data: [d.escaped ?? 0, d.caught ?? 0],
                        backgroundColor: ['#eb3f3f99', '#06844399'],
                        borderColor:     ['#eb3f3f',   '#068443'],
                        borderWidth: 2,
                        hoverOffset: 6,
                      }],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      cutout: '60%',
                      plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12, color: '#ADADAD' } },
                        datalabels: { display: false },
                        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}` } },
                      },
                    }}
                  />
                </div>
                <div style={{ padding: '4px 16px 12px', fontSize: 11, color: 'var(--muted2)' }}>
                  In Field ({d.escaped ?? 0}) ÷ In House ({d.caught ?? 0}) × 100 = {d.escapeRatio ?? '–'}%
                </div>
              </div>
            )}
		  {/* Defect Aging */}
          {chartVisible('defects', 'aging') && (
            <div className="card mt-16">
              <div className="card-header"><span className="card-title">Defect Aging</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels, 'defects-aging')} /><CopyButton type="chart" /></div></div>
              <div style={{ height: 220 }}>
                <Bar data={agingChartData} options={agingBarOpts} />
              </div>
            </div>
          )}
          </div>

          {/* Injection by Sprint + Found-In */}
          <div className="charts-grid-2 mt-16">
            {chartVisible('defects', 'injection') && (
              <div className="card">
                <div className="card-header"><span className="card-title">Defect Injection by Sprint</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels, 'defects-injection')} /><CopyButton type="chart" /></div></div>
                <div style={{ height: 240 }}>
                  {injEntries.length > 0
                    ? <Bar data={injChartData} options={injBarOpts} />
                    : <div style={{ color: 'var(--muted)', padding: 16 }}>No injection data</div>}
                </div>
              </div>
            )}
            {chartVisible('defects', 'found-in') && (
              <div className="card">
                <div className="card-header"><span className="card-title">Found-In Breakdown</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels, 'defects-found-in')} /><CopyButton type="chart" /></div></div>
                <div style={{ height: 240 }}>
                  {foundInEntries.length > 0
                    ? <Doughnut data={foundInData} options={foundInDonutOpts} />
                    : <div style={{ color: 'var(--muted)', padding: 16, textAlign: 'center' }}>No data</div>}
                </div>
              </div>
            )}
          </div>

          {/* How Found / Where Found / Severity donuts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginTop: 16 }}>
            {[
              { title: 'How Found',   d: howFound },
              { title: 'Where Found', d: whereFound },
              { title: 'Severity',    d: sevDonut },
            ].map(({ title, d: cd }) => (
              <div key={title} className="card">
                <div className="card-header"><span className="card-title">{title}</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(sprintLabels, title === 'How Found' ? 'defects-how-found' : title === 'Where Found' ? 'defects-where-found' : 'defects-severity')} /><CopyButton type="chart" /></div></div>
                <div style={{ height: 200 }}>
                  {cd.entries.length > 0
                    ? <Doughnut data={cd.chartData} options={smallDonutOpts[title] ?? commonDonutOpts} />
                    : <div style={{ color: 'var(--muted)', padding: 16, textAlign: 'center' }}>No data</div>}
                </div>
              </div>
            ))}
          </div>
          {/* Critical Defects */}
          {chartVisible('defects', 'critical') && (
            <div className="card mt-16">
              <div className="card-header"><span className="card-title">Critical Defects (P1/P2)</span><div className="card-actions"><TableModal label="Critical Defects" title="Critical Defects (P1/P2)" badge={critDefects.length}>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr><th>ID</th><th>Title</th><th>Priority</th><th>State</th><th>Team</th><th>Sprint</th><th>Changed</th></tr>
                      </thead>
                      <tbody>
                        {critDefects.length === 0 ? <tr><td colSpan="7" style={{
                textAlign: 'center',
                color: 'var(--success)',
                padding: 24
              }}>✅ No P1/P2 open defects</td></tr> : critDefects.map(item => {
              const prioColor = item.priority === 1 ? 'var(--danger)' : 'var(--warning)';
              return <tr key={item.id}>
                                  <td className="id-cell"><ItemLink id={item.id} tfsBaseUrl={tfsBaseUrl} /></td>
                                  <td className="title-cell" title={item.title || ''}>{item.title || '–'}</td>
                                  <td style={{
                  fontWeight: 700,
                  color: prioColor,
                  textAlign: 'center'
                }}>P{item.priority}</td>
                                  <td><span className={`state-badge state-${item.state}`}>{item.state}</span></td>
                                  <td>{extractTeamFromPath(item.area)}</td>
                                  <td style={{
                  fontSize: 11,
                  color: 'var(--muted2)'
                }}>{shortIter(item.iter)}</td>
                                  <td style={{
                  fontSize: 11,
                  color: 'var(--muted2)'
                }}>{formatDate(item.changed)}</td>
                                </tr>;
            })}
                      </tbody>
                    </table>
                  </div>
                </TableModal></div></div>
            </div>
          )}
        </>
      )}

      {/* ── DEFECT TREND TAB ────────────────────────────────────────────────── */}
      {tab === 'trend' && (
        <div>
          
          {trendError   && <div style={{ color: 'var(--danger)', padding: 16 }}>❌ {trendError.message}</div>}
          {!trendLoading && !trendError && !trendData && (
            <div style={{ color: 'var(--muted)', padding: 24 }}>Select a PI to view defect trend data.</div>
          )}
          {trendData && (
            <>
              {/* KPI summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Total Sprints',       value: sprints.length,                                                                                              color: '#60a5fa' },
                  { label: 'Total Defects Raised', value: sprints.reduce((a, s) => a + (s.defectTotal    || 0), 0),                                                   color: '#f97316' },
                  { label: 'Total Resolved',       value: sprints.reduce((a, s) => a + (s.defectResolved || 0), 0),                                                   color: '#4ade80' },
                  { label: 'Avg Resolve Rate',     value: sprints.length ? Math.round(sprints.reduce((a, s) => a + (s.resolveRate  || 0), 0) / sprints.length) + '%' : '–', color: '#39ff14' },
                  { label: 'Avg Escape Ratio',     value: sprints.length ? Math.round(sprints.reduce((a, s) => a + (s.escapeRatio  || 0), 0) / sprints.length) + '%' : '–', color: '#f87171' },
                ].map(k => (
                  <div key={k.label} className="card" style={{ padding: '12px 14px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</div>
                  </div>
                ))}
              </div>

              {/* Combo chart */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Defect Trend Overview</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 10 }}>
                    Bars = Defect counts (left axis) &nbsp;·&nbsp; Lines = Rates % (right axis)
                  </span>
                </div>
                <div className="chart-wrap" style={{ height: 300 }}>
                  <Chart type="bar" data={defectTrendChartData} options={defectTrendChartOpts} />
                </div>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', padding: '8px 4px 0', fontSize: 12, color: 'var(--muted)' }}>
                  {[
                    { color: '#f97316', label: 'Defects Raised',   type: 'bar' },
                    { color: '#068443', label: 'Defects Resolved',  type: 'bar' },
                    { color: '#39ff14', label: 'Resolve Rate %',    type: 'line' },
                    { color: '#f87171', label: 'Escape Ratio %',    type: 'line', dashed: true },
                  ].map(l => (
                    <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      {l.type === 'bar'
                        ? <span style={{ width: 12, height: 12, background: l.color, display: 'inline-block', flexShrink: 0 }} />
                        : <span style={{ width: 20, height: 0, borderTop: `2.5px ${l.dashed ? 'dashed' : 'solid'} ${l.color}`, display: 'inline-block', flexShrink: 0 }} />
                      }
                      {l.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Sprint-level defect summary table */}
              <div className="card mt-16">
                <div className="card-header"><span className="card-title">Sprint Defect Summary</span></div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Sprint</th>
                        <th>Defects Raised</th>
                        <th>Defects Resolved</th>
                        <th>Open</th>
                        <th>Resolve Rate %</th>
                        <th>Escape Ratio %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sprints.length === 0
                        ? <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted2)', padding: 24 }}>No sprint data found</td></tr>
                        : sprints.map(s => {
                            const open = (s.defectTotal || 0) - (s.defectResolved || 0);
                            const resolveGood = (s.resolveRate || 0) >= 70;
                            const escapeBad   = (s.escapeRatio || 0) >= 20;
                            const sprintName  = s.sprint || s.label || '';
                            return (
                              <tr key={sprintName}>
                                <td style={{ fontWeight: 700, color: 'var(--primary-light)' }}>{sprintName}</td>
                                <td style={{ color: '#f97316' }}>{s.defectTotal ?? '–'}</td>
                                <td style={{ color: '#4ade80' }}>{s.defectResolved ?? '–'}</td>
                                <td style={{ color: open > 0 ? '#f97316' : 'var(--muted)' }}>{open}</td>
                                <td style={{ color: resolveGood ? '#39ff14' : '#f87171', fontWeight: 600 }}>{s.resolveRate != null ? s.resolveRate + '%' : '–'}</td>
                                <td style={{ color: escapeBad   ? '#f87171' : '#4ade80', fontWeight: 600 }}>{s.escapeRatio != null ? s.escapeRatio + '%' : '–'}</td>
                              </tr>
                            );
                          })}
                    </tbody>
                  </table>
                </div>
              </div>

              {chartVisible('defects', 'quarterly') && (
                <div className="card mt-16">
                  <div className="card-header">
                    <span className="card-title">📅 Quarterly Raised vs Closed</span>
                    <span className="card-sub">Current year · all defects excl. Removed</span>
                  </div>
                  <div style={{ height: 260 }}>
                    {qLabels.length > 0
                      ? <Chart type="bar" data={qChartData} options={qChartOpts} />
                      : <div style={{ color: 'var(--muted)', padding: 24, textAlign: 'center' }}>No quarterly data available</div>}
                  </div>
                </div>
              )}

              {chartVisible('defects', 'burn-rate') && trendData && burnLabels.length > 0 && (
                <div className="card mt-16">
                  <div className="card-header">
                    <span className="card-title">📉 Net Defect Burn Rate</span>
                    <span className="card-sub">Cumulative (Raised − Resolved) per sprint. Negative = improving</span>
                  </div>
                  <div style={{ height: 240 }}>
                    <Line data={burnChartData} options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: { legend: { labels: { color: '#ADADAD' } }, datalabels: { display: false } },
                      scales: {
                        x: { ticks: { color: '#ADADAD' }, grid: { display: false } },
                        y: {
                          ticks: { color: '#ADADAD' },
                          grid: { color: '#454545' },
                          title: { display: true, text: 'Net Open Defects', color: '#ADADAD' },
                        },
                      },
                    }} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── DEFECTS TABLE ───────────────────────────────────────────────────── */}
      {tab === 'defects' && (
        <>
          <div className="card-header" style={{
  marginTop: 0
}}><span className="card-title">Defect List</span><div className="card-actions"><TableModal label="Defects" title="Defect List" badge={filtered.length}>
              <div className="table-controls">
                <input className="search-input" placeholder="Search ID or title…" value={search} onChange={e => setSearch(e.target.value)} />
                <select className="filter-select" value={stateF} onChange={e => setStateF(e.target.value)}>
                  <option value="">All States</option>
                  {DEFECT_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="filter-select" value={teamF} onChange={e => setTeamF(e.target.value)}>
                  <option value="">All Teams</option>
                  {Object.keys(d.teamBreakdown || {}).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select className="filter-select" value={howF} onChange={e => setHowF(e.target.value)}>
                  <option value="">How Found</option>
                  {Object.keys(d.howFoundBreakdown || {}).map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <select className="filter-select" value={whereF} onChange={e => setWhereF(e.target.value)}>
                  <option value="">Where Found</option>
                  {Object.keys(d.whereFoundBreakdown || {}).map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <select className="filter-select" value={sevF} onChange={e => setSevF(e.target.value)}>
                  <option value="">Severity</option>
                  {Object.keys(d.severityBreakdown || {}).map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('id')}>ID{sortIndicator('id')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('title')}>Title{sortIndicator('title')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('state')}>State{sortIndicator('state')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('team')}>Team{sortIndicator('team')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('severity')}>Severity{sortIndicator('severity')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('priority')}>Priority{sortIndicator('priority')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('rank')}>Rank{sortIndicator('rank')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('howFound')}>How Found{sortIndicator('howFound')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('whereFound')}>Where Found{sortIndicator('whereFound')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('sprint')}>Sprint{sortIndicator('sprint')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('changed')}>Changed{sortIndicator('changed')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFiltered.length === 0 ? <tr><td colSpan="11" style={{
                textAlign: 'center',
                color: 'var(--muted2)',
                padding: 24
              }}>No defects found</td></tr> : sortedFiltered.map(item => <tr key={item.id}>
                            <td className="id-cell"><ItemLink id={item.id} tfsBaseUrl={tfsBaseUrl} /></td>
                            <td className="title-cell" title={item.title || ''}>{item.title || '–'}</td>
                            <td><span className={`state-badge state-${item.state}`}>{item.state}</span></td>
                            <td>{extractTeamFromPath(item.area)}</td>
                            <td style={{
                fontSize: 11,
                fontWeight: 600,
                color: sevColor(item.severity)
              }}>{item.severity || '–'}</td>
                            <td style={{
                fontSize: 11,
                textAlign: 'center'
              }}>{item.priority ?? '–'}</td>
                            <td style={{
                fontSize: 11,
                textAlign: 'center',
                color: 'var(--muted2)'
              }}>{item.rank != null ? Math.round(item.rank) : '–'}</td>
                            <td style={{
                fontSize: 11,
                color: 'var(--muted2)'
              }}>{item.howFound || '–'}</td>
                            <td style={{
                fontSize: 11,
                color: 'var(--muted2)'
              }}>{item.whereFound || '–'}</td>
                            <td style={{
                fontSize: 11,
                color: 'var(--muted2)'
              }}>{shortIter(item.iter)}</td>
                            <td style={{
                fontSize: 11,
                color: 'var(--muted2)'
              }}>{formatDate(item.changed)}</td>
                          </tr>)}
                  </tbody>
                </table>
              </div>
            </TableModal></div></div>

          {qLabels.length > 0 && chartVisible('defects', 'quarterly') && (
            <div className="card mt-16">
              <div className="card-header"><span className="card-title">Quarterly Raised vs Closed</span><div className="card-actions">{quarterTfsUrl && <TFSLink href={quarterTfsUrl} label="Open in TFS" />}</div></div>
              <div style={{ height: 260 }}>
                <Bar data={qChartData} options={qChartOpts} />
              </div>
            </div>
          )}

          {projLabels.length > 0 && chartVisible('defects', 'field-defects') && (
            <div className="card mt-16">
              <div className="card-header"><span className="card-title">Field Defects by Project</span><div className="card-actions">{fieldDefectsTfsUrl && <TFSLink href={fieldDefectsTfsUrl} label="Open in TFS" />}</div></div>
              <div style={{ height: Math.max(200, projLabels.length * 28 + 40) }}>
                <Bar data={projChartData} options={projBarOpts} />
              </div>
            </div>
          )}
        </>
      )}

      {/* ── ANALYSIS ────────────────────────────────────────────────────────── */}
      {tab === 'analysis' && (
        <>
          {chartVisible('defects', 'density-trend') && (
            <div className="card">
              <div className="card-header"><span className="card-title">Defect Density Trend</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(densityLineData.labels, 'defects-density-trend')} /><CopyButton type="chart" /></div></div>
              <div style={{ height: 280 }}>
                {trend.length > 0
                  ? <Line data={densityLineData} options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: {
                        legend: { labels: { color: '#cfd8e3', font: { size: 12 } } },
                        datalabels: { display: false },
                        annotation: {
                          annotations: buildAnnotationLines(annItems, densityLineData.labels, handleDeleteAnnotation, 'defects-density-trend'),
                        },
                      },
                      scales: {
                        x: { ticks: { color: '#ADADAD' }, grid: { color: '#454545' } },
                        y: {
                          beginAtZero: true,
                          title: { display: true, text: 'Defects per Feature', color: '#8aa3be' },
                          ticks: { color: '#ADADAD' },
                          grid: { color: '#454545' },
                        },
                      },
                    }} />
                  : <div style={{ color: 'var(--muted)', padding: 24, textAlign: 'center' }}>
                      No density trend data available for selected PIs.
                    </div>}
              </div>
              {trend.length > 1 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '8px 16px 12px', borderTop: '1px solid var(--border-sub)', marginTop: 4 }}>
                  {trend.map(pt => (
                    <div key={pt.pi} style={{ background: 'var(--bg)', padding: '5px 12px', minWidth: 90, textAlign: 'center', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>{pt.pi}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: (pt.liveDensity || 0) > 0.5 ? 'var(--danger)' : (pt.liveDensity || 0) > 0.2 ? 'var(--warning)' : 'var(--success)' }}>
                        {pt.liveDensity?.toFixed(2) ?? '–'}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted2)' }}>defects/feat</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {chartVisible('defects', 'field-defects') && projLabels.length > 0 && (
            <div className="card mt-16">
              <div className="card-header">
                <span className="card-title">🏭 Field Defects by Project/Version</span>
                <span className="card-sub">HowFound = 'Found In Field' · grouped by project field</span>
                <div className="card-actions">
                  {fieldDefectsTfsUrl && <a href={fieldDefectsTfsUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" title="Open in TFS">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:4}}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    TFS
                  </a>}
                  <AnnotationButton onClick={() => openAnnPopup(sprintLabels, 'defects-field-project-version')} /><CopyButton type="chart" />
                </div>
              </div>
              <div style={{ height: Math.max(180, projLabels.length * 36 + 60) }}>
                <Bar data={projChartData} options={{
                  indexAxis: 'y',
                  responsive: true, maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    datalabels: { anchor: 'end', align: 'end', color: '#ADADAD', font: { size: 11 }, formatter: v => v },
                  },
                  scales: {
                    x: { beginAtZero: true, ticks: { color: '#ADADAD', precision: 0 }, grid: { color: '#454545' } },
                    y: { ticks: { color: '#ADADAD' }, grid: { display: false } },
                  },
                  onClick: () => { if (fieldDefectsTfsUrl) window.open(fieldDefectsTfsUrl, '_blank'); },
                  onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                }} />
              </div>
              <div style={{ padding: '4px 16px 12px', fontSize: 11, color: 'var(--muted2)' }}>
                Total field defects: <strong style={{ color: 'var(--danger)' }}>{fieldStats?.totalFieldDefects ?? 0}</strong>
              </div>
            </div>
          )}

          {chartVisible('defects', 'team-priority-heatmap') && (() => {
            const items = d.items || [];
            const prioLevels = [1, 2, 3, 4];
            const teamMap = {};
            items.forEach(i => {
              const team = (i.area || '').replace(/\//g, '\\').split('\\').pop() || 'Unknown';
              if (!teamMap[team]) teamMap[team] = { 1: 0, 2: 0, 3: 0, 4: 0, total: 0 };
              const p = Math.min(4, Math.max(1, i.priority || 4));
              teamMap[team][p]++;
              teamMap[team].total++;
            });
            const teamRows = Object.entries(teamMap).sort((a, b) => b[1].total - a[1].total);
            if (!teamRows.length) return null;
            const maxVal = Math.max(...teamRows.flatMap(([, v]) => prioLevels.map(p => v[p])));
            function heatColor(val) {
              if (!val) return 'transparent';
              const ratio = val / maxVal;
              if (ratio > 0.7) return '#eb3f3fcc';
              if (ratio > 0.4) return '#f97316aa';
              if (ratio > 0.2) return '#F5CC0088';
              return '#068443aa';
            }
            return (
              <div className="card mt-16">
                <div className="card-header">
                  <span className="card-title">🔥 Team × Priority Heatmap</span>
                  <span className="card-sub">Defect count per team per priority · darker = more defects</span>
                </div>
                <div className="table-wrap" style={{ padding: '8px 0 12px' }}>
                  <table className="data-table" style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr>
                        <th style={{ width: 160 }}>Team</th>
                        {prioLevels.map(p => (
                          <th key={p} style={{ textAlign: 'center', color: p === 1 ? 'var(--danger)' : p === 2 ? 'var(--warning)' : 'var(--muted)' }}>
                            P{p}
                          </th>
                        ))}
                        <th style={{ textAlign: 'center' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamRows.map(([team, counts]) => (
                        <tr key={team}>
                          <td style={{ fontWeight: 600, fontSize: 12 }}>{team}</td>
                          {prioLevels.map(p => (
                            <td key={p} style={{ textAlign: 'center', background: heatColor(counts[p]), fontWeight: counts[p] ? 700 : 400, color: counts[p] ? '#fff' : 'var(--muted)' }}>
                              {counts[p] || '–'}
                            </td>
                          ))}
                          <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--primary-light)' }}>{counts.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {chartVisible('defects', 'team-priority-open') && (() => {
            const items = d.items || [];
            const activeStates = ['New', 'Accepted', 'Investigated', 'Planned'];
            const teamPrioMap = {};
            items.filter(i => activeStates.includes(i.state)).forEach(i => {
              const team = (i.area || '').replace(/\//g, '\\').split('\\').pop() || 'Unknown';
              if (!teamPrioMap[team]) teamPrioMap[team] = {};
              const label = `P${Math.min(4, Math.max(1, i.priority || 4))}`;
              teamPrioMap[team][label] = (teamPrioMap[team][label] || 0) + 1;
            });
            const teamNames = Object.keys(teamPrioMap).sort((a, b) => {
              const ta = Object.values(teamPrioMap[a]).reduce((s, v) => s + v, 0);
              const tb = Object.values(teamPrioMap[b]).reduce((s, v) => s + v, 0);
              return tb - ta;
            });
            if (!teamNames.length) return null;
            const prioColors = { P1: '#eb3f3f', P2: '#ff7f0f', P3: '#F5CC00', P4: '#ADADAD' };
            const prioBarData = {
              labels: teamNames,
              datasets: ['P1', 'P2', 'P3', 'P4'].map(p => ({
                label: p,
                data: teamNames.map(t => teamPrioMap[t]?.[p] || 0),
                backgroundColor: prioColors[p] + '99',
                borderColor: prioColors[p],
                borderWidth: 1,
                borderRadius: 0,
              })),
            };
            return (
              <div className="card mt-16">
                <div className="card-header">
                  <span className="card-title">📊 Open Defects by Team × Priority</span>
                  <span className="card-sub">Active states only (New + Accepted + Investigated + Planned)</span>
                </div>
                <div style={{ height: Math.max(220, teamNames.length * 28 + 60) }}>
                  <Bar data={prioBarData} options={{
                    indexAxis: 'y',
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                      legend: { labels: { color: '#ADADAD', boxWidth: 10 } },
                      datalabels: { display: false },
                    },
                    scales: {
                      x: { stacked: true, beginAtZero: true, ticks: { color: '#ADADAD', precision: 0 }, grid: { color: '#454545' } },
                      y: { stacked: true, ticks: { color: '#ADADAD', font: { size: 11 } }, grid: { display: false } },
                    },
                    onClick: (evt, elements) => {
                      if (!elements.length) return;
                      const prio = parseInt(prioBarData.datasets[elements[0].datasetIndex].label.slice(1), 10);
                      openChartTFS(store, pis, 'Defect', [`[Microsoft.VSTS.Common.Priority]=${prio}`, `[System.State] NOT IN ('Resolved','Closed','Removed')`]);
                    },
                    onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                  }} />
                </div>
              </div>
            );
          })()}

          <div className="card mt-16">
            <div className="card-header"><span className="card-title">Defect Delta</span></div>
            {!activeSnapshotId ? (
              <div style={{ color:'var(--muted2)', padding:24, textAlign:'center', fontSize:13 }}>
                📋 Select PI Plan Data from topbar to compare
              </div>
            ) : !predData ? null : (() => {
              const defects       = predData.defects       || [];
              const summary       = predData.defectSummary || {};
              const delta         = summary.escapeDelta;
              const deltaDisplay  = delta != null ? (delta > 0 ? '+' : '') + delta + '%' : '–';
              const deltaClass    = delta == null ? '' : delta <= 0 ? 'green' : delta <= 10 ? 'amber' : 'red';
              const changed       = defects.filter(dd => dd.snapshotState !== dd.liveState).length;
              return (
                <>
                  <div className="kpi-strip" style={{ borderTop:'none' }}>
                    <div className="kpi-card blue">   <div className="kpi-val">{summary.snapshotTotal ?? '–'}</div><div className="kpi-lbl">Snapshot Total</div></div>
                    <div className="kpi-card blue">   <div className="kpi-val">{summary.liveTotal     ?? '–'}</div><div className="kpi-lbl">Live Total</div></div>
                    <div className="kpi-card green">  <div className="kpi-val">{summary.resolvedNow   ?? '–'}</div><div className="kpi-lbl">Resolved</div></div>
                    <div className="kpi-card orange"> <div className="kpi-val">{summary.snapEscapeRatio != null ? summary.snapEscapeRatio + '%' : '–'}</div><div className="kpi-lbl">Snapshot Escape%</div></div>
                    <div className="kpi-card orange"> <div className="kpi-val">{summary.liveEscapeRatio != null ? summary.liveEscapeRatio + '%' : '–'}</div><div className="kpi-lbl">Live Escape%</div></div>
                    <div className={`kpi-card ${deltaClass}`}><div className="kpi-val">{deltaDisplay}</div><div className="kpi-lbl">Delta%</div></div>
                  </div>
                  <div style={{ padding:'0 0 12px 16px' }}>
                    <span style={{ fontSize:11, color:'var(--muted2)' }}>
                      vs <strong style={{ color:'var(--primary-light)' }}>{activeSnapshotLabel || activeSnapshotId}</strong>
                      {' · '}{defects.length} defects · {changed} state changed
                    </span>
                  </div>
                  <TableModal label="View Defect Comparison" title="Defect vs Snapshot Comparison" badge={defects.length} btnClassName="btn btn-ghost btn-sm" >
                    <div style={{ marginLeft:16, marginBottom:8 }} />
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr><th>ID</th><th>Title</th><th>Team</th><th>Snapshot State</th><th>Live State</th><th>Change</th></tr>
                        </thead>
                        <tbody>
                          {defects.length === 0 ? (
                            <tr><td colSpan={6} style={{ textAlign:'center', color:'var(--muted2)', padding:24 }}>No defects in PI Plan Data</td></tr>
                          ) : (
                            defects.map(dd => {
                              const stateChanged = dd.snapshotState !== dd.liveState;
                              const resolved = ['Resolved','Closed'].includes(dd.liveState);
                              const escaped  = ['New','Accepted','Investigated'].includes(dd.liveState);
                              const badge = resolved
                                ? <span style={{ fontSize:11, color:'var(--success)', fontWeight:600 }}>✅ Resolved</span>
                                : escaped
                                  ? <span style={{ fontSize:11, color:'var(--danger)', fontWeight:600 }}>⚠ Escaped</span>
                                  : <span style={{ fontSize:11, color:'var(--warning)' }}>⏳ In Progress</span>;
                              return (
                                <tr key={dd.id}>
                                  <td className="id-cell">#{dd.id}</td>
                                  <td className="title-cell" title={dd.title || ''}>{dd.title || '–'}</td>
                                  <td style={{ fontSize:12 }}>{dd.team || '–'}</td>
                                  <td style={{ fontSize:12 }}>{dd.snapshotState || '–'}</td>
                                  <td style={{ fontSize:12, color: stateChanged ? 'var(--warning)' : undefined }}>{dd.liveState || '–'}</td>
                                  <td>{stateChanged ? <span style={{ color:'var(--warning)', marginRight:6 }}>↻</span> : null}{badge}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </TableModal>
                </>
              );
            })()}
          </div>

          {chartVisible('defects', 'sla-breach') && (
            <div className="card mt-16">
              <div className="card-header"><span className="card-title">SLA Breach</span><div className="card-actions">{slaBreaches.length > 0 && <>
                    <span style={{
        fontSize: 12,
        color: 'var(--danger)'
      }}>
                      {slaBreaches.length} defect{slaBreaches.length !== 1 ? 's' : ''} exceeding SLA
                    </span>
                    <TableModal label="SLA Breach" title="SLA Breach" badge={slaBreaches.length}>
                      <div className="table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr><th>ID</th><th>Title</th><th>Priority</th><th>State</th><th>Team</th><th>Age (days)</th><th>SLA Threshold</th></tr>
                          </thead>
                          <tbody>
                            {slaBreaches.map(item => {
                const prioColor = item.priority === 1 ? 'var(--danger)' : item.priority === 2 ? 'var(--warning)' : 'var(--muted)';
                const ageColor = item.ageDays > item.slaThreshold * 2 ? 'var(--danger)' : 'var(--caution)';
                return <tr key={item.id}>
                                  <td className="id-cell"><ItemLink id={item.id} tfsBaseUrl={tfsBaseUrl} /></td>
                                  <td className="title-cell" title={item.title || ''}>{item.title || '–'}</td>
                                  <td style={{
                    fontWeight: 700,
                    color: prioColor,
                    textAlign: 'center'
                  }}>{item.priority != null ? 'P' + item.priority : '–'}</td>
                                  <td><span className={`state-badge state-${item.state}`}>{item.state}</span></td>
                                  <td>{item.team || '–'}</td>
                                  <td style={{
                    fontWeight: 700,
                    color: ageColor,
                    textAlign: 'center'
                  }}>{item.ageDays}</td>
                                  <td style={{
                    textAlign: 'center',
                    color: 'var(--muted)'
                  }}>{item.slaThreshold}</td>
                                </tr>;
              })}
                          </tbody>
                        </table>
                      </div>
                    </TableModal>
                  </>}</div></div>
              {slaBreaches.length === 0 && (
                <div style={{ color: 'var(--success)', padding: 24, textAlign: 'center' }}>✅ No SLA breaches detected.</div>
              )}
            </div>
          )}

          {/* ── Resolve-By (Generic04) — chart + summary ──────────────────── */}
          <div className="card mt-16">
            <div className="card-header"><span className="card-title">📅 Open Defects by Resolve-By (Generic04)</span><span style={{
    fontSize: 12,
    color: 'var(--muted)'
  }}>{totalOpenDefects} open</span><div className="card-actions">{resolveByItems.filter(i => i.resolveBy).length > 0 && <TableModal label="View All" title="Open Defects — Resolve-By Detail" badge={resolveByItems.filter(i => i.resolveBy).length}>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr><th>ID</th><th>Title</th><th>Team</th><th>State</th><th>Priority</th><th>Severity</th><th>Resolve-By</th></tr>
                      </thead>
                      <tbody>
                        {resolveByItems.filter(i => i.resolveBy).map(item => {
              const prioColor = item.priority === 1 ? 'var(--danger)' : item.priority === 2 ? 'var(--warning)' : 'var(--muted)';
              return <tr key={item.id}>
                              <td className="id-cell"><ItemLink id={item.id} tfsBaseUrl={tfsBaseUrl} /></td>
                              <td className="title-cell" title={item.title || ''}>{item.title || '–'}</td>
                              <td style={{
                  fontSize: 12
                }}>{item.area ? item.area.split('\\').pop() : '–'}</td>
                              <td><span className={`state-badge state-${item.state}`}>{item.state}</span></td>
                              <td style={{
                  fontWeight: 700,
                  color: prioColor,
                  textAlign: 'center'
                }}>{item.priority != null ? 'P' + item.priority : '–'}</td>
                              <td style={{
                  fontSize: 12,
                  color: sevColor(item.severity)
                }}>{item.severity || '–'}</td>
                              <td style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--primary-light)'
                }}>{item.resolveBy}</td>
                            </tr>;
            })}
                      </tbody>
                    </table>
                  </div>
                </TableModal>}{notSetItems.length > 0 && <TableModal label={`⚠ Not Set: ${notSetItems.length}`} title="⚠ Generic04 Not Set — Open Defects" badge={notSetItems.length} btnClassName="btn btn-ghost btn-sm" btnStyle={{
      borderColor: 'var(--danger)',
      color: 'var(--danger)'
    }}>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr><th>ID</th><th>Title</th><th>Team</th><th>State</th><th>Priority</th><th>Severity</th><th>Created</th></tr>
                      </thead>
                      <tbody>
                        {notSetItems.map(item => {
              const prioColor = item.priority === 1 ? 'var(--danger)' : item.priority === 2 ? 'var(--warning)' : 'var(--muted)';
              return <tr key={item.id} style={{
                background: item.priority <= 2 ? '#eb3f3f0a' : undefined
              }}>
                              <td className="id-cell"><ItemLink id={item.id} tfsBaseUrl={tfsBaseUrl} /></td>
                              <td className="title-cell" title={item.title || ''}>{item.title || '–'}</td>
                              <td style={{
                  fontSize: 12
                }}>{item.area ? item.area.split('\\').pop() : '–'}</td>
                              <td><span className={`state-badge state-${item.state}`}>{item.state}</span></td>
                              <td style={{
                  fontWeight: 700,
                  color: prioColor,
                  textAlign: 'center'
                }}>{item.priority != null ? 'P' + item.priority : '–'}</td>
                              <td style={{
                  fontSize: 12,
                  color: sevColor(item.severity)
                }}>{item.severity || '–'}</td>
                              <td style={{
                  fontSize: 12,
                  color: 'var(--muted)'
                }}>{item.created ? new Date(item.created).toLocaleDateString() : '–'}</td>
                            </tr>;
            })}
                      </tbody>
                    </table>
                  </div>
                </TableModal>}<AnnotationButton onClick={() => openAnnPopup(sprintLabels, 'defects-resolve-by')} /><CopyButton type="chart" /></div></div>

            {resolveByEntries.length === 0 && notSetCount === 0 ? (
              <div style={{ color: 'var(--muted)', padding: 24, textAlign: 'center' }}>
                No Generic04 data available — field may not be populated in TFS.
              </div>
            ) : (
              <>
                {resolveByEntries.length > 0 && (
                  <>
                    {/* Bar chart — excludes "Not Set" */}
                    <div style={{ height: Math.max(200, resolveByEntries.length * 40 + 60) }}>
                      <Bar data={resolveByChartData} options={resolveByChartOpts} />
                    </div>

                    {/* Summary table — behind button */}
                    <div style={{ padding: '8px 16px 12px' }}>
                      <TableModal label="View Summary Table" title="Open Defects by Resolve-By (Generic04)" badge={resolveByEntries.length} btnClassName="btn btn-ghost btn-sm">
                        <div className="table-wrap">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Resolve-By (Generic04)</th>
                                <th style={{ textAlign: 'right' }}>Open Defects</th>
                                <th style={{ textAlign: 'right' }}>% of Open</th>
                              </tr>
                            </thead>
                            <tbody>
                              {resolveByEntries.map(([key, count]) => (
                                <tr key={key}>
                                  <td style={{ fontWeight: 600, color: 'var(--primary-light)' }}>{key}</td>
                                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#f97316' }}>{count}</td>
                                  <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                                    {totalOpenDefects > 0 ? Math.round(count / totalOpenDefects * 100) : 0}%
                                  </td>
                                </tr>
                              ))}
                              <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                                <td>Total (with value)</td>
                                <td style={{ textAlign: 'right', color: '#f97316' }}>{totalOpenDefects - notSetCount}</td>
                                <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                                  {totalOpenDefects > 0 ? Math.round((totalOpenDefects - notSetCount) / totalOpenDefects * 100) : 0}%
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </TableModal>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ── VERSIONS TAB ────────────────────────────────────────────────────── */}
      {tab === 'versions' && (
        <VersionsTab verData={verData} verLoading={verLoading} verError={verError} tfsBaseUrl={tfsBaseUrl} />
      )}
      <ChartAnnotations
        section="defects"
        chartId={annPopup.chartId || ''}
        pi={selectedPIs[selectedPIs.length - 1] || ''}
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

// ─── Versions Tab ──────────────────────────────────────────────────────────────
const VER_COLORS = [
  '#0072db','#21837c','#f5cc00','#fa7000','#eb3f3f',
  '#858fff','#068443','#ff7f0f','#1492ff','#6b7280',
];

function ragColor(rag) {
  if (rag === 'Red')   return '#eb3f3f';
  if (rag === 'Amber') return '#f5cc00';
  return '#068443';
}

function VersionsTab({ verData, verLoading, verError, tfsBaseUrl }) {
  const [sortCol, setSortCol]       = useState('age');
  const [sortDir, setSortDir]       = useState('desc');
  const [showCarry, setShowCarry]   = useState(false);

  function toggleSort(col) {
    setSortDir(d => col === sortCol ? (d === 'desc' ? 'asc' : 'desc') : 'desc');
    setSortCol(col);
  }

  if (verLoading) return <div style={{ padding: 32, color: 'var(--muted)', textAlign: 'center' }}>⏳ Loading version data…</div>;
  if (verError)   return <div style={{ padding: 16, color: 'var(--danger)' }}>❌ {verError.message}</div>;
  if (!verData)   return <div style={{ padding: 32, color: 'var(--muted)' }}>No data. Refresh to load.</div>;

  const { versions = [], versionStats = [], kpi = {}, topOldest = [], carryForwardItems = [], relReadiness = 'Green' } = verData;

  // Limit charts to top 15 versions by total count (most populated)
  const topVersionStats = [...versionStats]
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
    .sort((a, b) => a.version.localeCompare(b.version));

  // ── Count by version chart ────────────────────────────────────────────────
  const countChartData = {
    labels: topVersionStats.map(v => v.version),
    datasets: [
      {
        label: 'Active',
        data: topVersionStats.map(v => v.activeCount),
        backgroundColor: '#eb3f3f99',
        borderColor: '#eb3f3f',
        borderWidth: 1,
        borderRadius: 2,
        stack: 'a',
      },
      {
        label: 'Closed',
        data: topVersionStats.map(v => v.count - v.activeCount),
        backgroundColor: '#06844399',
        borderColor: '#068443',
        borderWidth: 1,
        borderRadius: 2,
        stack: 'a',
      },
    ],
  };

  const countChartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#ADADAD', boxWidth: 12, padding: 10 } }, datalabels: { display: false } },
    scales: {
      x: { stacked: true, ticks: { color: '#ADADAD' }, grid: { display: false } },
      y: { stacked: true, beginAtZero: true, ticks: { color: '#ADADAD', precision: 0 }, grid: { color: '#454545' },
           title: { display: true, text: 'Count', color: '#ADADAD', font: { size: 11 } } },
    },
  };

  // ── Age line chart ────────────────────────────────────────────────────────
  const ageChartData = {
    labels: topVersionStats.map(v => v.version),
    datasets: [
      { label: 'Max Age',    data: topVersionStats.map(v => v.maxAge),    borderColor: '#eb3f3f', backgroundColor: 'rgba(235,63,63,0.08)', borderWidth: 2, pointRadius: 4, tension: 0.3, datalabels: { display: false } },
      { label: 'Median Age', data: topVersionStats.map(v => v.medianAge), borderColor: '#f5cc00', backgroundColor: 'rgba(245,204,0,0.08)',  borderWidth: 2, pointRadius: 4, tension: 0.3, datalabels: { display: false } },
      { label: 'Min Age',    data: topVersionStats.map(v => v.minAge),    borderColor: '#068443', backgroundColor: 'rgba(6,132,67,0.08)',   borderWidth: 2, pointRadius: 4, tension: 0.3, datalabels: { display: false } },
    ],
  };

  const ageChartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#ADADAD', boxWidth: 12, padding: 10 } }, datalabels: { display: false } },
    scales: {
      x: { ticks: { color: '#ADADAD' }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: '#ADADAD', precision: 0 }, grid: { color: '#454545' },
           title: { display: true, text: 'Age (days)', color: '#ADADAD', font: { size: 11 } } },
    },
  };

  // ── Component stacked bar ─────────────────────────────────────────────────
  const allComps = [...new Set(topVersionStats.flatMap(v => Object.keys(v.components || {})))].sort();
  const compChartData = {
    labels: topVersionStats.map(v => v.version),
    datasets: allComps.map((comp, i) => ({
      label: comp,
      data: topVersionStats.map(v => v.components?.[comp] || 0),
      backgroundColor: VER_COLORS[i % VER_COLORS.length] + '99',
      borderColor:     VER_COLORS[i % VER_COLORS.length],
      borderWidth: 1,
      stack: 'comp',
    })),
  };

  const compChartOpts = {
    indexAxis: 'y',
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#ADADAD', boxWidth: 10, padding: 8, font: { size: 11 } } }, datalabels: { display: false } },
    scales: {
      x: { stacked: true, beginAtZero: true, ticks: { color: '#ADADAD', precision: 0 }, grid: { color: '#454545' },
           title: { display: true, text: 'Count', color: '#ADADAD', font: { size: 11 } } },
      y: { stacked: true, ticks: { color: '#ADADAD', font: { size: 11 } }, grid: { display: false } },
    },
  };

  // ── Sort top oldest ───────────────────────────────────────────────────────
  const sortedOldest = [...topOldest].sort((a, b) => {
    const va = a[sortCol] ?? 0, vb = b[sortCol] ?? 0;
    if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortDir === 'asc' ? va - vb : vb - va;
  });

  const SortIcon = ({ col }) => (
    <span style={{ marginLeft: 3, opacity: sortCol === col ? 1 : 0.35, fontSize: 10 }}>
      {sortCol === col ? (sortDir === 'desc' ? '▼' : '▲') : '⇅'}
    </span>
  );

  const kpiCards = [
    { label: 'Total Active',     value: kpi.totalActive ?? 0,         color: '#60a5fa' },
    { label: 'Median Age (days)',value: kpi.medianAge  ?? '–',         color: '#f5cc00' },
    { label: 'Max Age (days)',   value: kpi.maxAge     ?? '–',         color: '#eb3f3f' },
    { label: 'Carry Forward',   value: kpi.carryForward ?? 0,         color: '#fa7000' },
    { label: 'Without Owner',   value: kpi.withoutOwner ?? 0,         color: '#f87171' },
    { label: 'No Fix Version',  value: kpi.withoutFixVersion ?? 0,    color: '#858fff' },
  ];

  return (
    <div>
      {/* Year scope banner */}
      <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ background: 'var(--primary)', color: '#fff', borderRadius: 4, padding: '2px 8px', fontWeight: 600, fontSize: 11 }}>
          {new Date().getFullYear()}
        </span>
        Showing defects created in {new Date().getFullYear()} only
        {verData.fetchedAt && <span style={{ marginLeft: 'auto', opacity: 0.5 }}>fetched {new Date(verData.fetchedAt).toLocaleTimeString()}</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
        {kpiCards.map(k => (
          <div key={k.label} className="card" style={{ padding: '12px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k.label}</div>
          </div>
        ))}
        {/* Release Readiness RAG */}
        <div className="card" style={{ padding: '12px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: ragColor(relReadiness), lineHeight: 1 }}>● {relReadiness}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Release Readiness</div>
        </div>
      </div>

      {/* Count + Age charts side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div className="card">
          <div className="card-header"><span className="card-title">Defect Count by Version</span>
            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>Top 15 by count ({versionStats.length} total)</span>
          </div>
          <div style={{ height: 260 }}><Bar data={countChartData} options={countChartOpts} /></div>
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">Min / Median / Max Age by Version</span>
            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>Top 15 by count</span>
          </div>
          <div style={{ height: 260 }}><Line data={ageChartData} options={ageChartOpts} /></div>
        </div>
      </div>

      {/* Component stacked bar */}
      {allComps.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-header">
            <span className="card-title">Defects by Component (per Version)</span>
            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>Top 15 versions by count</span>
          </div>
          <div style={{ height: Math.max(200, topVersionStats.length * 34 + 40) }}>
            <Bar data={compChartData} options={compChartOpts} />
          </div>
        </div>
      )}

      {/* Top Oldest Defects */}
      {topOldest.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-header">
            <span className="card-title">Top {topOldest.length} Oldest Active Defects</span>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Title</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('age')}>Age (days)<SortIcon col="age" /></th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('sev')}>Severity<SortIcon col="sev" /></th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('fixedVersion')}>Fix Version<SortIcon col="fixedVersion" /></th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('comp')}>Component<SortIcon col="comp" /></th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('owner')}>Owner<SortIcon col="owner" /></th>
                </tr>
              </thead>
              <tbody>
                {sortedOldest.map(item => (
                  <tr key={item.id}>
                    <td className="id-cell">
                      <a href={`${tfsBaseUrl}/_workitems/edit/${item.id}`} target="_blank" rel="noopener noreferrer"
                         style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none', fontFamily: 'monospace', fontSize: 12 }}>
                        #{item.id}
                      </a>
                    </td>
                    <td className="title-cell" title={item.title}>{item.title || '–'}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700,
                                 color: item.age > 90 ? '#eb3f3f' : item.age > 30 ? '#f5cc00' : 'var(--muted2)' }}>
                      {item.age}
                    </td>
                    <td style={{ fontSize: 11, fontWeight: 600, color: sevColor(item.sev) }}>{item.sev || '–'}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted2)' }}>{item.fixedVersion}</td>
                    <td style={{ fontSize: 11, color: 'var(--muted2)' }}>{item.comp}</td>
                    <td style={{ fontSize: 11, color: item.owner ? 'var(--muted2)' : '#f87171' }}>{item.owner || '⚠ Unassigned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Carry Forward */}
      {carryForwardItems.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Carry Forward Defects</span>
            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>
              Open defects planned for older versions (not {versions.filter(v => v !== '(Unassigned)').at(-1) || '–'})
            </span>
            <div className="card-actions">
              <button onClick={() => setShowCarry(v => !v)} style={{ fontSize: 12, background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted2)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }}>
                {showCarry ? 'Hide' : `Show ${carryForwardItems.length}`}
              </button>
            </div>
          </div>
          {showCarry && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>ID</th><th>Title</th><th>Age (days)</th><th>Fix Version</th><th>Severity</th><th>Owner</th></tr>
                </thead>
                <tbody>
                  {carryForwardItems.map(item => (
                    <tr key={item.id}>
                      <td className="id-cell">
                        <a href={`${tfsBaseUrl}/_workitems/edit/${item.id}`} target="_blank" rel="noopener noreferrer"
                           style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none', fontFamily: 'monospace', fontSize: 12 }}>
                          #{item.id}
                        </a>
                      </td>
                      <td className="title-cell" title={item.title}>{item.title || '–'}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: item.age > 90 ? '#eb3f3f' : '#f5cc00' }}>{item.age}</td>
                      <td style={{ fontSize: 11 }}>{item.fixedVersion}</td>
                      <td style={{ fontSize: 11, fontWeight: 600, color: sevColor(item.sev) }}>{item.sev || '–'}</td>
                      <td style={{ fontSize: 11, color: item.owner ? 'var(--muted2)' : '#f87171' }}>{item.owner || '⚠ Unassigned'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


