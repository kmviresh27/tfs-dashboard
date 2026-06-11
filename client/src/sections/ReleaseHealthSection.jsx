import { useState, useRef } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend,
} from 'chart.js';
import useStore from '../store/useStore.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/apiClient.js';
import { useAnnotations, useConfig } from '../api/hooks.js';
import { PageLoader } from '../components/ui/PageLoader.jsx';
import CopyButton from '../components/ui/CopyButton.jsx';
import ChartAnnotations, { AnnotationButton, buildAnnotationLines } from '../components/ui/ChartAnnotations.jsx';
import { buildTFSQueryUrl } from '../tfsLinks.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// ── Colours ────────────────────────────────────────────────────────────────────
const FEAT_COLORS = {
  Done:       '#068443',
  Approved:   '#ff7f0f',
  Activated:  '#9B5CFF',
  Forecasted: '#1492ff',
  New:        '#858FFF',
  Unknown:    '#6b7280',
};
const STORY_COLORS = {
  Done:          '#068443',
  Closed:        '#22c55e',
  Resolved:      '#21837c',
  Active:        '#1492ff',
  'In Progress': '#06b6d4',
  New:           '#858FFF',
  Unknown:       '#6b7280',
};

function stateColor(state, palette) {
  return palette[state] || '#a78bfa';
}

// ── Hook ───────────────────────────────────────────────────────────────────────
function useReleaseHealth(team, pi) {
  const params = new URLSearchParams();
  if (team) params.set('teamPath', team);
  if (pi)   params.set('pi', pi);
  const qs = params.toString();
  return useQuery({
    queryKey: ['release-health', team, pi],
    queryFn:  () => apiFetch(`/api/release-health${qs ? '?' + qs : ''}`),
    staleTime: 5 * 60 * 1000,
  });
}

// ── Stat card ──────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, onClick }) {
  return (
    <div className="card" onClick={onClick}
      style={{ minWidth: 130, flex: '1 1 130px', padding: '12px 16px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'opacity .15s',
      }}
      title={onClick ? 'Click to open in TFS' : undefined}
    >
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color || '#fff', lineHeight: 1,
        textDecoration: onClick ? 'underline dotted' : 'none' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Stacked horizontal bar chart ───────────────────────────────────────────────
function StackedBar({ title, releases, stateOrder, palette, valueKey, labelFn, icon,
                      tfsBaseUrl, area, iterationPath, activePi, workItemType, onAddNote, chartId = '', releaseField = 'releaseField' }) {
  const [drill, setDrill] = useState(null); // { release, state }

  if (!releases.length) return null;

  function openTFS(releaseName, state = null) {
    if (!tfsBaseUrl || !area) return;
    let wiql = `SELECT [System.Id],[System.Title],[System.State],[System.AreaPath],[System.IterationPath] FROM WorkItems WHERE [System.WorkItemType]='${workItemType}' AND [System.AreaPath] UNDER '${area}' AND [${releaseField}]='${releaseName}'`;
    if (state)    wiql += ` AND [System.State]='${state}'`;
    if (activePi && iterationPath) wiql += ` AND [System.IterationPath] UNDER '${iterationPath}\\${activePi}'`;
    wiql += ' ORDER BY [System.Id]';
    const url = buildTFSQueryUrl(tfsBaseUrl, wiql);
    if (url) window.open(url, '_blank', 'noopener');
  }

  const labels   = releases.map(r => r.name);
  const allStates = [...new Set([
    ...stateOrder,
    ...releases.flatMap(r => Object.keys(r[valueKey].byState || r[valueKey].ptsByState || {})),
  ])];

  // Features → count (byState); Stories → story points (ptsByState)
  const getVal = (r, state) => {
    const d = r[valueKey];
    const src = valueKey === 'stories' ? (d.ptsByState || d.byState) : d.byState;
    return (src && src[state]) || 0;
  };

  const datasets = allStates.map(state => ({
    label:           state,
    data:            releases.map(r => getVal(r, state)),
    backgroundColor: stateColor(state, palette),
    borderColor:     stateColor(state, palette),
    borderWidth:     0,
    borderRadius:    2,
  })).filter(ds => ds.data.some(v => v > 0));

  const chartData = { labels, datasets };
  const opts = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { color: '#ADADAD', boxWidth: 12, padding: 10 } },
      tooltip: {
        callbacks: {
          label: ctx => {
            const r = releases[ctx.dataIndex];
            const d = r[valueKey];
            const total = valueKey === 'features' ? d.total : d.totalPts;
            const pct = total > 0 ? Math.round(ctx.parsed.x / total * 100) : 0;
            return ` ${ctx.dataset.label}: ${ctx.parsed.x} ${labelFn(ctx.parsed.x)} (${pct}%)`;
          },
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { color: '#454545' },
        ticks: { color: '#ADADAD' },
        title: { display: true, text: labelFn(2), color: '#ADADAD', font: { size: 11 } },
      },
      y: {
        stacked: true,
        grid: { display: false },
        ticks: { color: '#fff', font: { size: 12 } },
      },
    },
    onClick: (evt, elements) => {
      if (!elements.length) { setDrill(null); return; }
      const el    = elements[0];
      const state = datasets[el.datasetIndex].label;
      const rel   = releases[el.index].name;
      setDrill(d => d && d.release === rel && d.state === state ? null : { release: rel, state });
      openTFS(rel, state);
    },
    onHover: (evt) => {
      evt.native.target.style.cursor = tfsBaseUrl ? 'pointer' : 'default';
    },
  };

  const height = Math.max(220, releases.length * 36 + 80);

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header"><span className="card-title">{icon} {title}</span><div className="card-actions">{onAddNote && <AnnotationButton onClick={() => onAddNote(labels, chartId)} /> }{drill && <button onClick={() => setDrill(null)} style={{
      fontSize: 11,
      background: 'transparent',
      border: '1px solid var(--border)',
      color: 'var(--muted)',
      cursor: 'pointer',
      padding: '2px 8px',
      borderRadius: 4
    }}>
            ✕ Clear filter
          </button>}<CopyButton type="chart" /></div></div>
      <div style={{ height }}>
        <Bar data={chartData} options={opts} />
      </div>

      {/* Per-release breakdown table */}
      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--muted)' }}>Release</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--muted)' }}>
                {valueKey === 'features' ? 'Total Features' : 'Total SP'}
              </th>
              {allStates.map(s => (
                <th key={s} style={{ textAlign: 'right', padding: '6px 8px', color: stateColor(s, palette) }}>{s}</th>
              ))}
              <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--muted)' }}>% Done</th>
            </tr>
          </thead>
          <tbody>
            {releases.map(r => {
              const d     = r[valueKey];
              const total = valueKey === 'features' ? d.total : d.totalPts;
              const done  = valueKey === 'features'
                ? (d.byState['Done'] || 0)
                : (d.ptsByState?.['Done'] || 0) + (d.ptsByState?.['Closed'] || 0) + (d.ptsByState?.['Resolved'] || 0);
              const pct   = total > 0 ? Math.round(done / total * 100) : 0;
              const isHL  = drill && drill.release === r.name;
              return (
                <tr key={r.name}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background: isHL ? 'var(--surface2)' : 'transparent',
                  }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600, cursor: tfsBaseUrl ? 'pointer' : 'default', color: 'var(--primary-light)' }}
                    title="Open all items for this release in TFS"
                    onClick={() => openTFS(r.name)}>
                    {r.name}
                  </td>
                  <td style={{ textAlign: 'right', padding: '6px 8px', color: '#fff' }}>{total}</td>
                  {allStates.map(s => (
                    <td key={s} onClick={() => getVal(r, s) > 0 && openTFS(r.name, s)}
                      title={getVal(r, s) > 0 ? `Open ${r.name} · ${s} in TFS` : undefined}
                      style={{
                        textAlign: 'right', padding: '6px 8px',
                        color: getVal(r, s) > 0 ? stateColor(s, palette) : 'var(--muted)',
                        cursor: getVal(r, s) > 0 && tfsBaseUrl ? 'pointer' : 'default',
                      }}>
                      {getVal(r, s) || '—'}
                    </td>
                  ))}
                  <td style={{ textAlign: 'right', padding: '6px 8px' }}>
                    <span style={{
                      color: pct >= 80 ? 'var(--success)' : pct >= 50 ? '#F5CC00' : 'var(--danger)',
                      fontWeight: 700,
                    }}>{pct}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main section ───────────────────────────────────────────────────────────────
export default function ReleaseHealthSection() {
  const selectedTeam   = useStore(s => s.selectedTeam);
  const selectedPIs    = useStore(s => s.selectedPIs);
  const availablePIs   = useStore(s => s.availablePIs);
  const tfsBaseUrl     = useStore(s => s.tfsBaseUrl);
  const areaPath       = useStore(s => s.areaPath);
  const iterationPath  = useStore(s => s.iterationPath);

  // Resolve active PI (same pattern as PI Delivery)
  const activePi = selectedPIs && selectedPIs.length
    ? selectedPIs[selectedPIs.length - 1]
    : (availablePIs.find(p => p.isCurrent) || availablePIs.filter(p => p.isPast).pop() || availablePIs[0])?.label || '';

  const [annPopup, setAnnPopup] = useState({ open: false, sprints: [], chartId: '' });
  const { data, isLoading, error } = useReleaseHealth(selectedTeam || null, activePi || null);
  const { data: annData } = useAnnotations('release-health', activePi, selectedTeam);
  const annItems = annData?.items || [];
  const qc = useQueryClient();
  const { data: cfg } = useConfig();
  const releaseField = cfg?.fieldMappings?.fields?.releaseField || 'releaseField';

  async function handleDeleteAnnotation(id) {
    await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['annotations', 'release-health'] });
  }

  function openAnnPopup(sprints, chartId = '') {
    setAnnPopup({ open: true, sprints, chartId });
  }

  if (isLoading) return <PageLoader label="Loading release health data…" />;
  if (error)     return <div style={{ color: 'var(--danger)', padding: 32 }}>❌ {error.message}</div>;
  if (!data)     return null;

  const { releases, totalFeatures, totalStories, featStateOrder, storyStateOrder,
          featureType = 'Feature', storyType = 'Story' } = data;
  const totalReleases  = releases.length;
  const doneFeatures   = releases.reduce((s, r) => s + (r.features.byState['Done'] || 0), 0);
  const totalSP        = releases.reduce((s, r) => s + r.stories.totalPts, 0);
  const doneSP         = releases.reduce((s, r) =>
    s + (r.stories.ptsByState?.['Done'] || 0) + (r.stories.ptsByState?.['Closed'] || 0) + (r.stories.ptsByState?.['Resolved'] || 0), 0);

  // ── TFS link helpers (respect team filter) ──────────────────────────────────
  // Strip ROOT: prefix that some team selectors prepend — TFS rejects it in WIQL
  const area = (selectedTeam ? selectedTeam.replace(/^ROOT:/i, '') : null) || areaPath || '';
  function makeTfsUrl(workItemType, extraClauses = []) {
    if (!tfsBaseUrl || !area) return null;
    let wiql = `SELECT [System.Id],[System.Title],[System.State],[System.IterationPath],[System.AreaPath] FROM WorkItems WHERE [System.WorkItemType]='${workItemType}' AND [System.AreaPath] UNDER '${area}'`;
    if (activePi && iterationPath) {
      wiql += ` AND [System.IterationPath] UNDER '${iterationPath}\\${activePi}'`;
    }
    for (const c of extraClauses) wiql += ` AND ${c}`;
    wiql += ' ORDER BY [System.Id]';
    return buildTFSQueryUrl(tfsBaseUrl, wiql);
  }
  const allFeatUrl  = makeTfsUrl(featureType);
  const doneFeatUrl = makeTfsUrl(featureType, ["[System.State]='Done'"]);
  const allStoryUrl = makeTfsUrl(storyType);
  const doneStoryUrl= makeTfsUrl(storyType, ["[System.State] IN ('Done','Closed','Resolved')"]);

  return (
    <div style={{ padding: '0 0 32px' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}><span className="icon-grey">📦</span> Release Health</h2>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
          Feature &amp; Story breakdown by <code style={{ background: 'var(--surface2)', padding: '1px 4px', borderRadius: 3 }}>{releaseField}</code>
          {activePi   && <span style={{ marginLeft: 8, color: '#1492ff', fontWeight: 600 }}>· {activePi}</span>}
          {selectedTeam && <span style={{ marginLeft: 8 }}>· {selectedTeam.split('\\').pop()}</span>}
        </div>
      </div>

      {/* Info blurb */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        background: 'var(--surface2)', border: '1px solid var(--border)',
        borderLeft: '3px solid #1492ff', borderRadius: 6,
        padding: '10px 14px', marginBottom: 20, fontSize: 12, color: 'var(--muted)',
      }}>
        <span style={{ fontSize: 16, lineHeight: 1.4 }}>ℹ️</span>
        <span>
          The data in this section is driven by two TFS work item fields:
          {' '}<strong style={{ color: '#fff' }}>Release</strong>{' '}
          (<code style={{ background: '#1a1a2e', padding: '1px 5px', borderRadius: 3 }}>{releaseField}</code>)
          — used to group Features and Stories by their target release — and
          {' '}<strong style={{ color: '#fff' }}>State</strong>{' '}
          (<code style={{ background: '#1a1a2e', padding: '1px 5px', borderRadius: 3 }}>System.State</code>)
          — used to show progress per state. Work items without a Release field value are excluded.
          Features are counted by <strong style={{ color: '#fff' }}>number of items</strong>; Stories are measured by <strong style={{ color: '#fff' }}>sum of Story Points</strong>.
        </span>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatCard label="Releases"       value={totalReleases}  color="#1492ff" />
        <StatCard label="Total Features" value={totalFeatures}  sub={`${doneFeatures} Done`} color="#fff"
          onClick={allFeatUrl ? () => window.open(allFeatUrl, '_blank') : null} />
        <StatCard label="Features Done"  value={doneFeatures}
          sub={totalFeatures > 0 ? `${Math.round(doneFeatures / totalFeatures * 100)}% done rate` : '—'}
          color="#068443"
          onClick={doneFeatUrl ? () => window.open(doneFeatUrl, '_blank') : null} />
        <StatCard label="Total Stories"  value={totalStories}   sub={`${totalSP} SP`} color="#fff"
          onClick={allStoryUrl ? () => window.open(allStoryUrl, '_blank') : null} />
        <StatCard label="SP Done"        value={doneSP}
          sub={totalSP > 0 ? `${Math.round(doneSP / totalSP * 100)}% of SP` : '—'}
          color="#068443"
          onClick={doneStoryUrl ? () => window.open(doneStoryUrl, '_blank') : null} />
      </div>

      {releases.length === 0 && (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
          No items found with <code>{releaseField}</code> field set.
        </div>
      )}

      {/* Features chart */}
      {releases.some(r => r.features.total > 0) && (
        <StackedBar
          title="Features by Release"
          icon="🚀"
          releases={releases.filter(r => r.features.total > 0)}
          stateOrder={featStateOrder || ['Done', 'Approved', 'Activated', 'Forecasted', 'New']}
          palette={FEAT_COLORS}
          valueKey="features"
          labelFn={n => n === 1 ? 'feature' : 'features'}
          tfsBaseUrl={tfsBaseUrl} area={area} iterationPath={iterationPath} activePi={activePi} workItemType={featureType}
          onAddNote={openAnnPopup}
          chartId="relhealth-features"
          releaseField={releaseField}
        />
      )}

      {/* Stories chart */}
      {releases.some(r => r.stories.total > 0) && (
        <StackedBar
          title="Stories by Release — Story Points"
          icon="📋"
          releases={releases.filter(r => r.stories.total > 0)}
          stateOrder={storyStateOrder || ['Done', 'Closed', 'Resolved', 'Active', 'In Progress', 'New']}
          palette={STORY_COLORS}
          valueKey="stories"
          labelFn={n => n === 1 ? 'SP' : 'SP'}
          tfsBaseUrl={tfsBaseUrl} area={area} iterationPath={iterationPath} activePi={activePi} workItemType={storyType}
          onAddNote={openAnnPopup}
          chartId="relhealth-stories"
          releaseField={releaseField}
        />
      )}
      <ChartAnnotations
        section="release-health"
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
