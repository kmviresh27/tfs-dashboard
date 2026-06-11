import { useState } from 'react';
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
import { useTestCoverage, useGithubCoverage, useSnapshotTCDelta, useAnnotations } from '../api/hooks.js';
import { getTeamAreaPath } from '../tfsLinks.js';
import TableModal from '../components/ui/TableModal.jsx';
import CopyButton from '../components/ui/CopyButton.jsx';
import { usePolicies } from '../hooks/usePolicies.js';
import { TFSItemLink as ItemLink } from '../components/ui/TFSLink';
import ChartAnnotations, { AnnotationButton, buildAnnotationLines } from '../components/ui/ChartAnnotations.jsx';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement,
  PointElement, LineElement, Title, Tooltip, Legend, ChartDataLabels,
);

const GH_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

function DensityBar({ tc, tf }) {
  const density = tf > 0 ? tc / tf : 0;
  const width = Math.min(100, density * 5);
  const color = density >= 10 ? 'var(--success)' : density >= 3 ? 'var(--caution)' : 'var(--danger)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 80, height: 8, background: 'rgba(255,255,255,.1)' }}>
        <div style={{ width: `${width}%`, height: '100%', background: color }} />
      </div>
      <span style={{ fontSize: 10, color: 'var(--muted)' }}>{density.toFixed(1)}/f</span>
    </div>
  );
}

function GitHubCoverageCard({ data, onAddNote, title = '🐙 GitHub Coverage' }) {
  if (!data) return (
    <div className="card mt-16">
      <div className="card-header"><span className="card-title">{title}</span></div>
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, padding:24 }}>
        <div className="loading-spinner" />
        <span className="loading-text">Loading GitHub coverage…</span>
      </div>
    </div>
  );

  if (!data.configured) return (
    <div className="card mt-16">
      <div className="card-header"><span className="card-title">{title}</span></div>
      <div style={{ color: 'var(--muted)', padding: 24, textAlign: 'center', fontSize: 13 }}>
        ⚙️ Configure GitHub token in Settings → Advanced to scan repos
      </div>
    </div>
  );

  const repos        = data.repos || [];
  const scanned      = repos.filter(r => r.status === 'test_scan');
  const totalCases   = scanned.reduce((s, r) => s + (r.scan?.testCaseCount || 0), 0);
  const totalFiles   = scanned.reduce((s, r) => s + (r.scan?.testFileCount || 0), 0);

  // Chart: Test Cases by Repo (horizontal bar)
  const repoCasesData = {
    labels: scanned.map(r => r.label || r.repo),
    datasets: [{
      label: 'Test Cases',
      data: scanned.map(r => r.scan?.testCaseCount || 0),
      backgroundColor: scanned.map((_, i) => GH_COLORS[i % GH_COLORS.length] + 'bb'),
      borderColor:     scanned.map((_, i) => GH_COLORS[i % GH_COLORS.length]),
      borderWidth: 1,
    }],
  };

  // Chart: Test Files by Repo (horizontal bar)
  const repoFilesData = {
    labels: scanned.map(r => r.label || r.repo),
    datasets: [{
      label: 'Test Files',
      data: scanned.map(r => r.scan?.testFileCount || 0),
      backgroundColor: scanned.map((_, i) => GH_COLORS[i % GH_COLORS.length] + 'bb'),
      borderColor:     scanned.map((_, i) => GH_COLORS[i % GH_COLORS.length]),
      borderWidth: 1,
    }],
  };

  // Chart: Top Modules (horizontal bar)
  const allMods = [];
  scanned.forEach(r => {
    const tag = (r.label || r.repo).split('/').pop() || r.repo;
    (r.scan?.modules || []).forEach(m => allMods.push({ name: `${m.name} [${tag}]`, cases: m.testCases }));
  });
  allMods.sort((a, b) => b.cases - a.cases);
  const topMods = allMods.slice(0, 15).filter(m => m.cases > 0);

  const topModsData = {
    labels: topMods.map(m => m.name),
    datasets: [{
      label: 'Test Cases',
      data: topMods.map(m => m.cases),
      backgroundColor: topMods.map((_, i) => GH_COLORS[i % GH_COLORS.length] + 'cc'),
      borderWidth: 1,
    }],
  };

  const hBarOpts = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      datalabels: { anchor: 'end', align: 'right', color: '#ccc', font: { size: 10 } },
    },
    scales: {
      x: { ticks: { color: '#aaa', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true },
      y: { ticks: { color: '#aaa', font: { size: 10 }, maxRotation: 0 }, grid: { display: false } },
    },
    layout: { padding: { right: 36 } },
  };

  return (
    <div className="card mt-16">
      <div className="card-header"><span className="card-title">{title}</span><div className="card-actions"><AnnotationButton onClick={() => onAddNote(scanned.map(r => r.label || r.repo), 'testcov-github')} /><TableModal label="View Test Matrix" title="GitHub Test Matrix">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Repository</th><th>Status</th>
                  <th style={{
                textAlign: 'right'
              }}>Files</th>
                  <th style={{
                textAlign: 'right'
              }}>Test Cases</th>
                  <th>Density</th><th>Scanned At</th>
                </tr>
              </thead>
              <tbody>
                {repos.flatMap(r => {
              const scan = r.scan || {};
              const tc = scan.testCaseCount || 0;
              const tf = scan.testFileCount || 0;
              const tcCol = tc >= 50 ? 'var(--success)' : tc >= 10 ? 'var(--caution)' : 'var(--danger)';
              const scannedAt = scan.scannedAt ? new Date(scan.scannedAt).toLocaleTimeString() : '–';
              const isOk = r.status === 'test_scan';
              const statusEl = isOk ? <span style={{
                color: 'var(--success)'
              }}>✅ Scanned</span> : r.status === 'no_tests' ? <span style={{
                color: 'var(--caution)'
              }}>⚠️ No tests</span> : <span style={{
                color: 'var(--danger)'
              }} title={r.error || ''}>❌ Error</span>;
              const rows = [<tr key={r.repo} style={{
                fontWeight: 700,
                background: 'rgba(255,255,255,0.06)',
                borderTop: '1px solid var(--border)'
              }}>
                      <td>📦 {r.label || r.repo}{scan.truncated ? ' ⚠️' : ''}</td>
                      <td>{statusEl}</td>
                      <td style={{
                  textAlign: 'right',
                  color: 'var(--accent)'
                }}>{tf}</td>
                      <td style={{
                  textAlign: 'right',
                  fontSize: 15,
                  color: tcCol
                }}>{tc.toLocaleString()}</td>
                      <td>{isOk ? <DensityBar tc={tc} tf={tf} /> : null}</td>
                      <td style={{
                  fontSize: 11,
                  color: 'var(--muted)'
                }}>{scannedAt}</td>
                    </tr>];
              (scan.modules || []).forEach((m, mi) => {
                const mCol = m.testCases >= 10 ? 'var(--success)' : m.testCases >= 3 ? 'var(--caution)' : 'var(--danger)';
                rows.push(<tr key={`${r.repo}-m${mi}`} style={{
                  fontSize: 12
                }}>
                        <td style={{
                    paddingLeft: 28,
                    color: 'var(--muted)'
                  }}>↳ {m.name || '–'}</td>
                        <td></td>
                        <td style={{
                    textAlign: 'right',
                    color: 'var(--muted)'
                  }}>{m.testFiles}</td>
                        <td style={{
                    textAlign: 'right',
                    color: mCol
                  }}>{m.testCases}</td>
                        <td><DensityBar tc={m.testCases} tf={m.testFiles} /></td>
                        <td></td>
                      </tr>);
              });
              return rows;
            })}
              </tbody>
            </table>
          </div>
        </TableModal></div></div>

      {/* KPI cards — one per repo */}
      <div className="kpi-strip" style={{ flexWrap: 'wrap' }}>
        {repos.map(r => {
          const tc  = r.scan?.testCaseCount || 0;
          const col = r.status === 'test_scan'
            ? (tc >= 50 ? 'var(--success)' : tc >= 10 ? 'var(--caution)' : 'var(--danger)')
            : 'var(--muted)';
          return (
            <div key={r.repo} className="kpi-card" style={{ minWidth: 160, maxWidth: 220 }}>
              <div className="kpi-val" style={{ color: col }}>
                {r.status === 'error' ? '❌' : tc.toLocaleString()}
              </div>
              <div className="kpi-lbl">🧪 {r.label || r.repo}</div>
              <div style={{ fontSize: 10, marginTop: 2, color: r.status === 'error' ? 'var(--danger)' : r.status === 'no_tests' ? 'var(--caution)' : 'var(--muted)' }}>
                {r.status === 'test_scan'
                  ? `${r.scan?.testFileCount || 0} files · ${r.scan?.moduleCount || 0} modules`
                  : r.status === 'no_tests' ? '⚠️ No tests' : '❌ Error'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sub-label */}
      <div style={{ padding: '0 16px 12px', fontSize: 11, color: 'var(--muted)' }}>
        {scanned.length
          ? `${totalCases.toLocaleString()} test cases · ${totalFiles} test files across ${scanned.length} repos`
          : `${repos.length} repos configured — check token / SSO authorization`}
      </div>

      {/* 3 charts */}
      {scanned.length > 0 && (
        <div className="charts-grid-3" style={{ padding: '0 16px 16px', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontWeight: 600 }}>Test Cases by Repo</div>
            <div style={{ height: Math.max(100, scanned.length * 32) }}>
              <Bar data={repoCasesData} options={hBarOpts} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontWeight: 600 }}>Test Files by Repo</div>
            <div style={{ height: Math.max(100, scanned.length * 32) }}>
              <Bar data={repoFilesData} options={hBarOpts} />
            </div>
          </div>
          {topMods.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontWeight: 600 }}>Top Modules</div>
              <div style={{ height: Math.max(100, topMods.length * 22) }}>
                <Bar data={topModsData} options={hBarOpts} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { GitHubCoverageCard };
export default function TestCoverageSection() {
  const store        = useStore(s => s);
  const { selectedPIs, availablePIs, selectedTeam, tfsBaseUrl } = store;
  const { chartVisible } = usePolicies();
  const pis = selectedPIs.length
    ? selectedPIs
    : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);

  const activeSnapshotId    = store.activeSnapshotId;
  const activeSnapshotLabel = store.activeSnapshotLabel;
  const teamPath            = getTeamAreaPath(store);
  const [annPopup, setAnnPopup] = useState({ open: false, sprints: [], chartId: '' });
  const activePi = selectedPIs[selectedPIs.length - 1] || '';

  const { data, isLoading, error }   = useTestCoverage(pis, selectedTeam);
  const { data: tcDeltaData }        = useSnapshotTCDelta(activeSnapshotId, teamPath);
  const { data: ghData }             = useGithubCoverage();
  const { data: annData } = useAnnotations('test-coverage', activePi, selectedTeam);
  const annItems = annData?.items || [];
  const qc = useQueryClient();

  async function handleDeleteAnnotation(id) {
    await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['annotations', 'test-coverage'] });
  }

  function openAnnPopup(sprints, chartId = '') {
    setAnnPopup({ open: true, sprints, chartId });
  }

  if (isLoading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16 }}>
      <div className="loading-spinner" />
      <span className="loading-text">Loading Test Coverage data…</span>
    </div>
  );
  if (error)     return <div style={{ padding: 24, color: 'var(--danger)' }}>❌ {error.message}</div>;
  if (!data)     return <div style={{ padding: 24, color: 'var(--muted)' }}>No test coverage data available. Configure and refresh.</div>;

  const {
    automationBreakdown = {},
    automatedPct = 0,
    byTeam = {},
    featureCoverage = {},
    testRunsSummary = {},
    meta = {},
  } = data;

  const total   = meta.totalTestCases || 0;
  const auto    = automationBreakdown.Automated       || 0;
  const manual  = automationBreakdown['Not Automated'] || 0;
  const planned = automationBreakdown.Planned          || 0;

  // Automation donut
  const autoDonutData = {
    labels: ['Automated', 'Not Automated', 'Planned'],
    datasets: [{
      data: [auto, manual, planned],
      backgroundColor: ['#068443', '#eb3f3f', '#1492ff'],
      borderColor: '#2B2B2B',
      borderWidth: 2,
      hoverOffset: 6,
    }],
  };

  // Team Coverage stacked bar
  const teams = Object.keys(byTeam).sort();
  const teamBarData = {
    labels: teams,
    datasets: [
      { label: 'Automated',     data: teams.map(t => byTeam[t]?.Automated       || 0), backgroundColor: '#068443bb', borderColor: '#068443', borderWidth: 1, stack: 's' },
      { label: 'Not Automated', data: teams.map(t => byTeam[t]?.['Not Automated'] || 0), backgroundColor: '#eb3f3fbb', borderColor: '#eb3f3f', borderWidth: 1, stack: 's' },
      { label: 'Planned',       data: teams.map(t => byTeam[t]?.Planned         || 0), backgroundColor: '#1492ffbb', borderColor: '#1492ff', borderWidth: 1, stack: 's' },
    ],
  };

  // Test Runs donut
  const { passed = 0, failed = 0, blocked = 0, notExecuted = 0, inProgress = 0 } = testRunsSummary;
  const runsTotal = passed + failed + blocked + (notExecuted || 0) + (inProgress || 0);
  const runsDonutData = {
    labels: ['Passed', 'Failed', 'Blocked', 'Not Executed', 'In Progress'],
    datasets: [{
      data: [passed, failed, blocked, notExecuted || 0, inProgress || 0],
      backgroundColor: ['#068443', '#eb3f3f', '#F5CC00', '#757575', '#1492ff'],
      borderColor: '#2B2B2B',
      borderWidth: 2,
      hoverOffset: 6,
    }],
  };

  // Feature Coverage donut
  const covered   = featureCoverage.coveredCount  || 0;
  const uncovered = featureCoverage.uncoveredCount || 0;
  const featTotal = featureCoverage.total || (covered + uncovered);
  const featCovData = {
    labels: ['Has Test Cases', 'No Test Cases'],
    datasets: [{
      data: [covered, uncovered],
      backgroundColor: ['#068443', '#eb3f3f'],
      borderColor: '#2B2B2B',
      borderWidth: 2,
      hoverOffset: 6,
    }],
  };

  const donutOpts = (subtitle) => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: '70%',
    plugins: {
      legend: { position: 'right', labels: { color: '#ADADAD', boxWidth: 12, padding: 10 } },
      datalabels: { display: false },
      tooltip: {
        callbacks: {
          label: ctx => {
            const tot = ctx.dataset.data.reduce((a, b) => a + b, 0);
            return ` ${ctx.label}: ${ctx.raw} (${tot > 0 ? Math.round(ctx.raw / tot * 100) : 0}%)`;
          },
        },
      },
      subtitle: subtitle ? { display: true, text: subtitle, color: '#ADADAD', font: { size: 11 } } : undefined,
    },
  });

  const uncoveredFeatures = featureCoverage.uncoveredFeatures || [];

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title">🧪 Test Coverage</h1>
        {pis.map(pi => <span key={pi} className="pi-tag">{pi}</span>)}
      </div>

      {/* KPI strip */}
      <div className="kpi-strip">
        <div className="kpi-card blue">  <div className="kpi-val">{total}</div>   <div className="kpi-lbl">Total TCs</div></div>
        <div className="kpi-card green"> <div className="kpi-val">{auto}</div>    <div className="kpi-lbl">Automated</div></div>
        <div className="kpi-card muted"> <div className="kpi-val">{manual}</div>  <div className="kpi-lbl">Manual</div></div>
        <div className="kpi-card blue">  <div className="kpi-val">{planned}</div> <div className="kpi-lbl">Planned</div></div>
        <div className="kpi-card green"> <div className="kpi-val">{testRunsSummary.passRate != null ? testRunsSummary.passRate + '%' : '–'}</div><div className="kpi-lbl">Pass Rate</div></div>
        <div className="kpi-card teal">  <div className="kpi-val">{featureCoverage.coveredPct != null ? featureCoverage.coveredPct + '%' : '–'}</div><div className="kpi-lbl">Feature Coverage</div></div>
      </div>

      {/* Automation donut + Team Coverage bar */}
      <div className="charts-grid-2">
        {chartVisible('test-coverage', 'automation') && (
          <div className="card">
            <div className="card-header"><span className="card-title">Automation Breakdown</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(autoDonutData.labels, 'testcov-automation')} /><CopyButton type="chart" /></div></div>
            <div style={{ height: 240 }}>
              <Doughnut data={autoDonutData} options={donutOpts(`${automatedPct}% automated — ${total} total TCs`)} />
            </div>
          </div>
        )}
        {teams.length > 0 && chartVisible('test-coverage', 'team-coverage') && (
          <div className="card">
            <div className="card-header"><span className="card-title">Team Coverage</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(teams, 'testcov-team')} /><CopyButton type="chart" /></div></div>
            <div style={{ height: 240 }}>
              <Bar data={teamBarData} options={{
                responsive: true, maintainAspectRatio: false,
                plugins: {
                  legend: { labels: { boxWidth: 10, padding: 8, color: '#ADADAD' } },
                  datalabels: { display: false },
                  annotation: {
                    annotations: buildAnnotationLines(annItems, teams, handleDeleteAnnotation, 'testcov-team'),
                  },
                },
                scales: {
                  x: { stacked: true, ticks: { color: '#ADADAD' }, grid: { display: false } },
                  y: { stacked: true, ticks: { color: '#ADADAD' }, grid: { color: '#454545' }, beginAtZero: true },
                },
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Test Runs + Feature Coverage */}
      <div className="charts-grid-2 mt-16">
        {chartVisible('test-coverage', 'test-runs') && (
          <div className="card">
            <div className="card-header"><span className="card-title">Test Runs Summary</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(runsDonutData.labels, 'testcov-runs')} /><CopyButton type="chart" /></div></div>
            <div style={{ height: 240 }}>
              {runsTotal > 0
                ? <Doughnut data={runsDonutData} options={donutOpts(`${testRunsSummary.runCount || 0} runs · Pass Rate: ${testRunsSummary.passRate || 0}%`)} />
                : <div style={{ color: 'var(--muted2)', padding: 32, textAlign: 'center' }}>No test run data available</div>}
            </div>
          </div>
        )}
        {chartVisible('test-coverage', 'feature-coverage') && (
          <div className="card">
            <div className="card-header"><span className="card-title">Feature Coverage</span><div className="card-actions"><AnnotationButton onClick={() => openAnnPopup(featCovData.labels, 'testcov-features')} /><CopyButton type="chart" /></div></div>
            <div style={{ height: 240 }}>
              {featTotal > 0
                ? <Doughnut data={featCovData} options={donutOpts(`${featureCoverage.coveredPct || 0}% covered — ${featTotal} features total`)} />
                : <div style={{ color: 'var(--muted2)', padding: 32, textAlign: 'center' }}>No feature data for selected PIs</div>}
            </div>
          </div>
        )}
      </div>

      {/* Uncovered Features table */}
      {chartVisible('test-coverage', 'uncovered') && (
        <div className="card mt-16">
          <div className="card-header"><span className="card-title">Uncovered Features</span><div className="card-actions"><TableModal label="Uncovered Features" title="Uncovered Features" badge={uncoveredFeatures.length}>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>ID</th><th>Title</th><th>State</th><th>Team</th></tr>
                  </thead>
                  <tbody>
                    {uncoveredFeatures.length === 0 ? <tr><td colSpan="4" style={{
                textAlign: 'center',
                padding: 24,
                color: 'var(--success)'
              }}>✅ All features have at least one linked test case</td></tr> : uncoveredFeatures.map(item => <tr key={item.id}>
                            <td className="id-cell"><ItemLink id={item.id} tfsBaseUrl={tfsBaseUrl} /></td>
                            <td className="title-cell" title={item.title || ''}>{item.title || '–'}</td>
                            <td><span className={`state-badge state-${item.state}`}>{item.state || '–'}</span></td>
                            <td>{item.team || '–'}</td>
                          </tr>)}
                  </tbody>
                </table>
              </div>
            </TableModal></div></div>
        </div>
      )}

      {/* GitHub Coverage */}
      {chartVisible('test-coverage', 'github') && <GitHubCoverageCard data={ghData} onAddNote={openAnnPopup} />}

      {/* TC Delta vs Snapshot */}
      {chartVisible('test-coverage', 'delta') && <div className="card mt-16">
        <div className="card-header">
          <span className="card-title">Test Coverage Delta</span>
          {tcDeltaData && (
            <span style={{ fontSize:12, color:'var(--muted2)' }}>
              vs <strong style={{ color:'var(--primary-light)' }}>{tcDeltaData.snapshotLabel || activeSnapshotLabel || activeSnapshotId}</strong>
            </span>
          )}
        </div>
        {!activeSnapshotId ? (
          <div style={{ color:'var(--muted2)', padding:24, textAlign:'center', fontSize:13 }}>
            📋 Select PI Plan Data from topbar to compare test coverage
          </div>
        ) : !tcDeltaData ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, padding:24 }}>
            <div className="loading-spinner" />
            <span className="loading-text">Loading…</span>
          </div>
        ) : !tcDeltaData.hasSnapshot ? (
          <div style={{ color:'var(--muted2)', padding:24, textAlign:'center', fontSize:13 }}>
            ⚠️ PI Plan Data predates TC tracking — re-capture to enable comparison
          </div>
        ) : (() => {
          const { snapshot: s, live: l, delta: dd } = tcDeltaData;
          const fmtDelta = (v) => {
            if (v == null) return <span style={{ color:'var(--muted)' }}>–</span>;
            const sign  = v > 0 ? '+' : '';
            const color = v === 0 ? 'var(--muted)' : v > 0 ? 'var(--success)' : 'var(--danger)';
            const arrow = v > 0 ? '↑' : v < 0 ? '↓' : '→';
            return <span style={{ fontWeight:700, color }}>{sign}{v} {arrow}</span>;
          };
          const rows = [
            { label:'📋 Total Test Cases',   snap: s.totalTests,          live: l.totalTests,          delta: dd.totalTests },
            { label:'🤖 Automated %',        snap: s.automatedPct + '%',  live: l.automatedPct + '%',  delta: dd.automatedPct },
            { label:'✅ Pass Rate',           snap: s.passRate + '%',      live: l.passRate + '%',      delta: dd.passRate },
            { label:'🔗 Feature Coverage %', snap: s.coveredPct + '%',    live: l.coveredPct + '%',    delta: dd.coveredPct },
          ];
          return (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Metric</th><th>Snapshot</th><th>Live</th><th>Δ</th></tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.label}>
                      <td style={{ fontWeight:600 }}>{row.label}</td>
                      <td style={{ color:'var(--primary-light)', fontWeight:600 }}>{row.snap}</td>
                      <td>{row.live}</td>
                      <td>{fmtDelta(row.delta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>}
      <ChartAnnotations
        section="test-coverage"
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
