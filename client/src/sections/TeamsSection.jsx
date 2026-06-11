import { useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  RadialLinearScale, PointElement, LineElement, Filler,
  Title, Tooltip, Legend
} from 'chart.js';
import { Bar, Radar } from 'react-chartjs-2';
import useStore from '../store/useStore.js';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/apiClient.js';
import { useFilteredDashboard, useAnnotations } from '../api/hooks.js';
import { COLORS, FEATURE_STATES, DEFECT_STATES } from '../constants.js';
import { buildSectionTFSUrl, getPIs, openChartTFS } from '../tfsLinks.js';
import SlideshowPager from '../components/ui/SlideshowPager.jsx';
import { PageLoader } from '../components/ui/PageLoader.jsx';
import CopyButton from '../components/ui/CopyButton.jsx';import { usePolicies } from '../hooks/usePolicies.js';
import ChartAnnotations, { AnnotationButton, buildAnnotationLines } from '../components/ui/ChartAnnotations.jsx';
import { TFSLink } from '../components/ui/TFSLink';

ChartJS.register(CategoryScale, LinearScale, BarElement, RadialLinearScale, PointElement, LineElement, Filler, Title, Tooltip, Legend);

const DARK_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#ADADAD', boxWidth: 10, padding: 8 } } },
  scales: {
    x: { stacked: true, grid: { display: false }, ticks: { color: '#ADADAD' } },
    y: { stacked: true, grid: { color: '#454545' }, ticks: { color: '#ADADAD' }, beginAtZero: true },
  },
};

export default function TeamsSection() {
  const store        = useStore(s => s);
  const selectedPIs  = store.selectedPIs;
  const { chartVisible } = usePolicies();
  const availablePIs = store.availablePIs;
  const selectedTeam = store.selectedTeam;
  const [annPopup, setAnnPopup] = useState({ open: false, sprints: [], chartId: '' });

  const pis = getPIs(store);
  const activePi = selectedPIs[selectedPIs.length - 1] || '';
  const { data, isLoading, error } = useFilteredDashboard(pis, selectedTeam);
  const { data: annData } = useAnnotations('teams', activePi, selectedTeam);
  const annItems = annData?.items || [];
  const qc = useQueryClient();

  async function handleDeleteAnnotation(id) {
    await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['annotations', 'teams'] });
  }

  function openAnnPopup(sprints, chartId = '') {
    setAnnPopup({ open: true, sprints, chartId });
  }

  if (isLoading) return <PageLoader label="Loading Teams data…" />;
  if (error)     return <div style={{ padding: 24, color: 'var(--danger)' }}>❌ {error.message}</div>;
  if (!data)     return <div style={{ padding: 24, color: 'var(--muted)' }}>No data available. Configure and refresh.</div>;

  const featBreakdown = data.features?.teamBreakdown || {};
  const defBreakdown  = data.defects?.teamBreakdown  || {};
  const teamSet = new Set([...Object.keys(featBreakdown), ...Object.keys(defBreakdown)]);
  // Root segments from teamRootPath (e.g. "Healthcare IT\ICAP\ISP" → "ISP")
  const rootPaths = Array.isArray(store.teamRootPath) ? store.teamRootPath : (store.teamRootPath ? [store.teamRootPath] : []);
  const rootSegments = new Set(rootPaths.map(p => p.replace(/\//g, '\\').split('\\').filter(Boolean).pop()).filter(Boolean));
  const teams = [...teamSet].filter(t => !rootSegments.has(t));

  // Radar: 6 health metrics per team, all 0-100
  const RADAR_LABELS = [
    'Feature Delivery',
    'Active Momentum',
    'Defect Resolution',
    'Defect Health',
    'Quality Index',
    'Scope Stability',
  ];
  const RADAR_COLORS = ['#1492ff','#06d6a0','#f4a261','#e63946','#8338ec','#fb5607'];
  const RADAR_META = [
    { icon: '🎯', label: 'Feature Delivery',   formula: 'Done ÷ Total Features',              note: 'Higher = more delivered' },
    { icon: '⚡', label: 'Active Momentum',    formula: 'In-Progress ÷ Total Features',       note: 'Higher = more actively worked' },
    { icon: '🔧', label: 'Defect Resolution',  formula: '(Resolved+Closed) ÷ Total Defects', note: 'Higher = defects closed faster' },
    { icon: '🛡', label: 'Defect Health',      formula: '1 − (Open ÷ Total Defects)',         note: 'Higher = fewer open defects' },
    { icon: '📊', label: 'Quality Index',      formula: '100 − (Defects÷Features × 25)',      note: 'Penalises high defect density' },
    { icon: '📌', label: 'Scope Stability',    formula: '1 − (Removed ÷ Total Features)',     note: 'Lower removals = stable scope' },
  ];

  const radarDatasets = teams.map((team, i) => {
    const fb = featBreakdown[team] || {};
    const db = defBreakdown[team]  || {};
    const totalF    = FEATURE_STATES.reduce((s, st) => s + (fb[st] || 0), 0);
    const doneF     = fb['Done'] || 0;
    const removedF  = fb['Removed'] || 0;
    const totalD    = DEFECT_STATES.reduce((s, st) => s + (db[st] || 0), 0);
    const openD     = (db['New'] || 0) + (db['Accepted'] || 0) + (db['Investigated'] || 0);
    const resolvedD = (db['Resolved'] || 0) + (db['Closed'] || 0);
    const activeF   = (fb['Activated'] || 0) + (fb['In Progress'] || 0) + (fb['Approved'] || 0);
    const ratio     = totalF > 0 ? totalD / totalF : 0;

    const color = RADAR_COLORS[i % RADAR_COLORS.length];
    return {
      label: team,
      data: [
        totalF > 0 ? Math.round(doneF / totalF * 100)                   : 0,   // Feature Delivery
        totalF > 0 ? Math.round(activeF / totalF * 100)                  : 0,   // Active Momentum
        totalD > 0 ? Math.round(resolvedD / totalD * 100)                : 100, // Defect Resolution
        totalD > 0 ? Math.round((1 - openD / totalD) * 100)              : 100, // Defect Health
        Math.max(0, Math.round(100 - ratio * 25)),                              // Quality Index
        totalF > 0 ? Math.round((1 - removedF / totalF) * 100)           : 100, // Scope Stability
      ],
      backgroundColor: color + '28',
      borderColor: color,
      borderWidth: 2,
      pointBackgroundColor: color,
      pointBorderColor: '#fff',
      pointBorderWidth: 1.5,
      pointRadius: 5,
      pointHoverRadius: 8,
      pointHoverBackgroundColor: color,
      pointHoverBorderColor: '#fff',
      pointHoverBorderWidth: 2,
    };
  });

  // Reference "healthy" ring at 75%
  const refDataset = {
    label: '◎ Target (75%)',
    data: new Array(6).fill(75),
    backgroundColor: 'transparent',
    borderColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1.5,
    borderDash: [4, 4],
    pointRadius: 0,
    pointHoverRadius: 0,
  };

  const radarData = { labels: RADAR_LABELS, datasets: [...radarDatasets, refDataset] };
  const radarOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: '#ADADAD', boxWidth: 10, padding: 14, font: { size: 11 },
          filter: item => item.text !== '◎ Target (75%)',
        },
      },
      datalabels: { display: false },
      tooltip: {
        callbacks: {
          label: ctx => {
            if (ctx.dataset.label === '◎ Target (75%)') return null;
            const val = ctx.parsed.r;
            const metric = RADAR_LABELS[ctx.dataIndex];
            return ` ${ctx.dataset.label}  ${val}%  — ${metric}`;
          },
        },
        backgroundColor: 'rgba(20,20,30,0.92)',
        borderColor: 'rgba(255,255,255,0.12)',
        borderWidth: 1,
        padding: 10,
        titleColor: '#fff',
        bodyColor: '#ccc',
        bodyFont: { size: 12 },
      },
    },
    scales: {
      r: {
        min: 0, max: 100,
        ticks: {
          color: '#888',
          backdropColor: 'transparent',
          stepSize: 25,
          font: { size: 9 },
          callback: v => v + '%',
        },
        grid:        { color: 'rgba(255,255,255,0.08)' },
        angleLines:  { color: 'rgba(255,255,255,0.12)' },
        pointLabels: {
          color: '#ddd',
          font: { size: 11, weight: '600' },
          padding: 8,
        },
      },
    },
  };

  // Feature stacked bar data
  const featChartData = {
    labels: teams,
    datasets: FEATURE_STATES.map(s => ({
      label: s,
      data: teams.map(t => featBreakdown[t]?.[s] ?? 0),
      backgroundColor: COLORS.feature[s] + '99',
      borderColor: COLORS.feature[s],
      borderWidth: 1,
    })),
  };

  // Defect stacked bar data
  const defChartData = {
    labels: teams,
    datasets: DEFECT_STATES.map(s => ({
      label: s,
      data: teams.map(t => defBreakdown[t]?.[s] ?? 0),
      backgroundColor: COLORS.defect[s] + '99',
      borderColor: COLORS.defect[s],
      borderWidth: 1,
    })),
  };

  const featUrl = buildSectionTFSUrl(store, 'Feature', pis);
  const defUrl  = buildSectionTFSUrl(store, 'Defect',  pis);

  const featBarOpts = {
    ...DARK_OPTS,
    plugins: {
      ...DARK_OPTS.plugins,
      annotation: {
        annotations: buildAnnotationLines(annItems, teams, handleDeleteAnnotation, 'teams-features'),
      },
    },
    onClick: (evt, elements) => {
      if (!elements.length) return;
      const teamName = featChartData.labels[elements[0].index];
      const state    = featChartData.datasets[elements[0].datasetIndex].label;
      const allItems = data.features?.items || [];
      const teamItem = allItems.find(i => (i.area || '').replace(/\//g, '\\').split('\\').pop() === teamName);
      let teamArea   = null;
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
      openChartTFS(store, pis, 'Feature', [`[System.State]='${state}'`], teamArea);
    },
    onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
  };

  const defBarOpts = {
    ...DARK_OPTS,
    plugins: {
      ...DARK_OPTS.plugins,
      annotation: {
        annotations: buildAnnotationLines(annItems, teams, handleDeleteAnnotation, 'teams-defects'),
      },
    },
    onClick: (evt, elements) => {
      if (!elements.length) return;
      const teamName = defChartData.labels[elements[0].index];
      const state    = defChartData.datasets[elements[0].datasetIndex].label;
      const allItems = data.defects?.items || [];
      const teamItem = allItems.find(i => (i.area || '').replace(/\//g, '\\').split('\\').pop() === teamName);
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

  if (store.slideshowRunning) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="section-header" style={{ flexShrink: 0 }}>
          <h1 className="section-title">👥 Teams</h1>
          {pis.map(pi => <span key={pi} className="pi-tag">{pi}</span>)}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {featUrl && <TFSLink href={featUrl} label="Features" />}
            {defUrl  && <TFSLink href={defUrl} label="Defects" />}
          </span>
        </div>
        <SlideshowPager label="👥 Teams" pages={[
          /* Page 0: stacked bar charts */
          <div style={{ height: '100%', overflowY: 'hidden' }}>
            {teams.length > 0 && chartVisible('teams', 'health-radar') && (
              <div className="card mb-16">
                <div className="card-header"><span className="card-title">🕸 Team Health Radar</span><span className="card-sub">6-dimension health comparison</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(teams, 'teams-radar')} /><CopyButton type="chart" /></div></div>
                <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', padding: '0 8px 8px' }}>
                  <div className="chart-wrap" style={{ height: 380, flex: '1 1 0', minWidth: 0 }}>
                    <Radar data={radarData} options={radarOpts} />
                  </div>
                  <div style={{ width: 268, flexShrink: 0, paddingTop: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>How it's calculated</div>
                    {RADAR_META.map((m, i) => (
                      <div key={m.label} style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 14, lineHeight: 1, marginTop: 2 }}>{m.icon}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: RADAR_COLORS[i], flexShrink: 0 }} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#e0e0e0' }}>{m.label}</span>
                          </div>
                          <div style={{ fontSize: 11, color: '#7eb3ff', fontFamily: 'monospace', marginBottom: 2 }}>{m.formula}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{m.note}</div>
                        </div>
                      </div>
                    ))}
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeDasharray="4 3"/></svg>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Dashed ring = 75% target</span>
                      </div>
                      <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>All axes 0–100. Higher is healthier.</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="charts-grid-2">
              {teams.length > 0 && chartVisible('teams', 'features-by-team') && (
                <div className="card">
                  <div className="card-header"><span className="card-title">Features by Team</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(teams, 'teams-features')} /><CopyButton type="chart" /></div></div>
                  <div className="chart-wrap" style={{ height: 260 }}>
                    <Bar data={featChartData} options={featBarOpts} />
                  </div>
                </div>
              )}
              {teams.length > 0 && chartVisible('teams', 'defects-by-team') && (
                <div className="card">
                  <div className="card-header"><span className="card-title">Defects by Team</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(teams, 'teams-defects')} /><CopyButton type="chart" /></div></div>
                  <div className="chart-wrap" style={{ height: 260 }}>
                    <Bar data={defChartData} options={defBarOpts} />
                  </div>
                </div>
              )}
            </div>
          </div>,
          /* Page 1: team cards grid */
          <div style={{ height: '100%', overflowY: 'hidden' }}>
            <div className="teams-grid mt-16">
              {teams.map(team => {
                const fb = featBreakdown[team] || {};
                const db = defBreakdown[team]  || {};
                const totalF    = FEATURE_STATES.reduce((s, st) => s + (fb[st] || 0), 0);
                const doneF     = fb['Done'] || 0;
                const totalD    = DEFECT_STATES.reduce((s, st) => s + (db[st] || 0), 0);
                const openD     = (db['New'] || 0) + (db['Accepted'] || 0);
                const resolvedD = db['Resolved'] || 0;
                return (
                  <div key={team} className="team-card">
                    <div className="team-card-name">👥 {team}</div>
                    <div className="team-stat-row"><span className="team-stat-label">Total Features</span><span className="team-stat-val">{totalF}</span></div>
                    <div className="team-stat-row"><span className="team-stat-label">Features Done</span><span className="team-stat-val" style={{ color: 'var(--success)' }}>{doneF}</span></div>
                    <div className="team-stat-row"><span className="team-stat-label">Total Defects</span><span className="team-stat-val">{totalD}</span></div>
                    <div className="team-stat-row"><span className="team-stat-label">Open Defects</span><span className="team-stat-val" style={{ color: 'var(--danger)' }}>{openD}</span></div>
                    <div className="team-stat-row"><span className="team-stat-label">Resolved Defects</span><span className="team-stat-val" style={{ color: 'var(--teal, #21837c)' }}>{resolvedD}</span></div>
                  </div>
                );
              })}
              {teams.length === 0 && <p style={{ color: 'var(--muted)' }}>No team data available.</p>}
            </div>
          </div>,
        ]} />
        <ChartAnnotations
          section="teams"
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
        <h1 className="section-title">👥 Teams</h1>
        {pis.map(pi => <span key={pi} className="pi-tag">{pi}</span>)}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {featUrl && <TFSLink href={featUrl} label="Features" />}
          {defUrl  && <TFSLink href={defUrl} label="Defects" />}
        </span>
      </div>

      {/* Charts row */}
      {teams.length > 0 && chartVisible('teams', 'health-radar') && (
        <div className="card mb-16">
          <div className="card-header"><span className="card-title">🕸 Team Health Radar</span><span className="card-sub">6-dimension health comparison</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(teams, 'teams-radar')} /><CopyButton type="chart" /></div></div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', padding: '0 8px 8px' }}>
            <div className="chart-wrap" style={{ height: 380, flex: '1 1 0', minWidth: 0 }}>
              <Radar data={radarData} options={radarOpts} />
            </div>
            <div style={{ width: 268, flexShrink: 0, paddingTop: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>How it's calculated</div>
              {RADAR_META.map((m, i) => (
                <div key={m.label} style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 14, lineHeight: 1, marginTop: 2 }}>{m.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: RADAR_COLORS[i], flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#e0e0e0' }}>{m.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#7eb3ff', fontFamily: 'monospace', marginBottom: 2 }}>{m.formula}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>{m.note}</div>
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeDasharray="4 3"/></svg>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Dashed ring = 75% target</span>
                </div>
                <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>All axes 0–100. Higher is healthier.</div>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="charts-grid-2">
        {teams.length > 0 && chartVisible('teams', 'features-by-team') && (
          <div className="card">
            <div className="card-header"><span className="card-title">Features by Team</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(teams, 'teams-features')} /><CopyButton type="chart" /></div></div>
            <div className="chart-wrap" style={{ height: 260 }}>
              <Bar data={featChartData} options={featBarOpts} />
            </div>
          </div>
        )}
        {teams.length > 0 && chartVisible('teams', 'defects-by-team') && (
          <div className="card">
            <div className="card-header"><span className="card-title">Defects by Team</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(teams, 'teams-defects')} /><CopyButton type="chart" /></div></div>
            <div className="chart-wrap" style={{ height: 260 }}>
              <Bar data={defChartData} options={defBarOpts} />
            </div>
          </div>
        )}
      </div>

      {/* Team cards grid */}
      <div className="teams-grid mt-16">
        {teams.map(team => {
          const fb = featBreakdown[team] || {};
          const db = defBreakdown[team]  || {};
          const totalF    = FEATURE_STATES.reduce((s, st) => s + (fb[st] || 0), 0);
          const doneF     = fb['Done'] || 0;
          const totalD    = DEFECT_STATES.reduce((s, st) => s + (db[st] || 0), 0);
          const openD     = (db['New'] || 0) + (db['Accepted'] || 0);
          const resolvedD = db['Resolved'] || 0;

          // Build per-team TFS links by filtering items to find the area path
          const allItems = [...(data.features?.items || []), ...(data.defects?.items || [])];
          const teamItem = allItems.find(i => {
            const seg = (i.area || '').replace(/\//g, '\\').split('\\').pop();
            return seg === team;
          });
          let teamFeatUrl = null;
          let teamDefUrl  = null;
          if (teamItem && store.tfsBaseUrl) {
            const area = (teamItem.area || '').replace(/\//g, '\\');
            // Find teamName segment in path and return path up to and including it
            const segs = area.split('\\').filter(Boolean);
            const idx  = segs.lastIndexOf(team);
            const teamAreaPath = idx !== -1 ? segs.slice(0, idx + 1).join('\\') : null;
            if (teamAreaPath) {
              const iterBase  = store.iterationPath;
              const buildTeamWiql = (wiType) => {
                let wiql = `SELECT [System.Id],[System.Title],[System.State],[System.IterationPath],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${wiType}' AND [System.AreaPath] UNDER '${teamAreaPath}'`;
                if (pis?.length && iterBase) {
                  const piParts = pis.map(pi => `[System.IterationPath] UNDER '${iterBase}\\${pi}'`);
                  wiql += ` AND (${piParts.join(' OR ')})`;
                }
                wiql += ' ORDER BY [System.Id]';
                return `${store.tfsBaseUrl}/_workitems?_a=query&wiql=${encodeURIComponent(wiql)}`;
              };
              teamFeatUrl = buildTeamWiql('Feature');
              teamDefUrl  = buildTeamWiql('Defect');
            }
          }

          return (
            <div key={team} className="team-card">
              <div className="team-card-name">
                👥 {team}
                {(teamFeatUrl || teamDefUrl) && (
                  <span className="tfs-link-slot" style={{ marginLeft: 8, fontSize: 11 }}>
                    {teamFeatUrl && <TFSLink href={teamFeatUrl} label="Features" />}
                    {' '}
                    {teamDefUrl  && <TFSLink href={teamDefUrl} label="Defects" />}
                  </span>
                )}
              </div>
              <div className="team-stat-row">
                <span className="team-stat-label">Total Features</span>
                <span className="team-stat-val">{totalF}</span>
              </div>
              <div className="team-stat-row">
                <span className="team-stat-label">Features Done</span>
                <span className="team-stat-val" style={{ color: 'var(--success)' }}>{doneF}</span>
              </div>
              <div className="team-stat-row">
                <span className="team-stat-label">Total Defects</span>
                <span className="team-stat-val">{totalD}</span>
              </div>
              <div className="team-stat-row">
                <span className="team-stat-label">Open Defects</span>
                <span className="team-stat-val" style={{ color: 'var(--danger)' }}>{openD}</span>
              </div>
              <div className="team-stat-row">
                <span className="team-stat-label">Resolved Defects</span>
                <span className="team-stat-val" style={{ color: 'var(--teal, #21837c)' }}>{resolvedD}</span>
              </div>
            </div>
          );
        })}
        {teams.length === 0 && <p style={{ color: 'var(--muted)' }}>No team data available.</p>}
      </div>
      <ChartAnnotations
        section="teams"
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
