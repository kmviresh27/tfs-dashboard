import { useState, useEffect, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import useStore from '../store/useStore.js';
import { apiFetch } from '../api/apiClient.js';
import { getRAG, ragClass } from '../utils.js';
import CopyButton from '../components/ui/CopyButton.jsx';
import DownloadCSVButton from '../components/ui/DownloadCSVButton.jsx';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const CHARTS = [
  { key: 'doneRate',       label: 'Done Rate %',     color: '#068443', maxVal: 100 },
  { key: 'escapeRatio',    label: 'Escape Ratio %',  color: '#eb3f3f', maxVal: 100 },
  { key: 'healthScore',    label: 'Health Score',    color: '#1492ff', maxVal: 100 },
  { key: 'defectDensity',  label: 'Defect Density',  color: '#ff7f0f', maxVal: undefined },
];

function makeLineData(labels, data, color, label) {
  return {
    labels,
    datasets: [{
      label,
      data,
      borderColor: color,
      backgroundColor: color + '22',
      pointBackgroundColor: color,
      pointBorderColor: '#1a1a1a',
      pointRadius: 5,
      pointHoverRadius: 7,
      borderWidth: 2,
      fill: true,
      tension: 0.3,
    }],
  };
}

function chartOptions(maxVal, label) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: ctx => `PI: ${ctx[0].label}`,
          label: ctx => ` ${label}: ${ctx.raw}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#ADADAD', font: { weight: 'bold' } } },
      y: {
        grid: { color: '#333' },
        ticks: { color: '#ADADAD' },
        beginAtZero: true,
        ...(maxVal !== undefined ? { max: maxVal } : {}),
      },
    },
  };
}

export default function CompareSection() {
  const availablePIs  = useStore(s => s.availablePIs);
  const selectedPIs   = useStore(s => s.selectedPIs);
  const selectedTeam  = useStore(s => s.selectedTeam);
  const ragThresholds = useStore(s => s.ragThresholds);

  const [pickedPIs, setPickedPIs] = useState(() => {
    if (selectedPIs.length) return [...selectedPIs];
    return availablePIs.filter(p => p.isPast).map(p => p.label);
  });
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const isMounted = useRef(false);

  function togglePI(label) {
    setPickedPIs(prev => prev.includes(label) ? prev.filter(p => p !== label) : [...prev, label]);
  }

  async function runComparison(pis = pickedPIs) {
    if (!pis.length) return;
    setLoading(true);
    setError(null);
    try {
      const qs = pis.map(p => `pis[]=${encodeURIComponent(p)}`).join('&') +
        (selectedTeam ? `&teamPath=${encodeURIComponent(selectedTeam)}` : '');
      const data = await apiFetch(`/api/pi-comparison?${qs}`);
      setComparison(data.comparison);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Auto-run on mount if we have PIs to compare
  useEffect(() => {
    const initial = selectedPIs.length
      ? [...selectedPIs]
      : availablePIs.filter(p => p.isPast).map(p => p.label);
    if (initial.length) runComparison(initial);
    isMounted.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run automatically when team filter changes (skip first mount)
  useEffect(() => {
    if (!isMounted.current) return;
    if (pickedPIs.length) runComparison();
  }, [selectedTeam]); // eslint-disable-line react-hooks/exhaustive-deps

  const labels = comparison ? comparison.map(d => d.pi) : [];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 700, color: '#fff' }}><span className="icon-grey">⚖️</span> Compare PIs</h2>

      {/* PI selector */}
      <div style={{ background: '#2B2B2B', border: '1px solid #454545', borderRadius: 0, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#ADADAD', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
          Select PIs to Compare
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {availablePIs.map(item => (
            <button
              key={item.label}
              onClick={() => togglePI(item.label)}
              style={{
                padding: '6px 14px',
                borderRadius: 0,
                border: `1px solid ${pickedPIs.includes(item.label) ? '#1492ff' : '#454545'}`,
                background: pickedPIs.includes(item.label) ? 'rgba(20,146,255,.15)' : 'transparent',
                color: pickedPIs.includes(item.label) ? '#1492ff' : '#ADADAD',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: pickedPIs.includes(item.label) ? 700 : 400,
              }}
            >
              {item.isCurrent ? `${item.label} ★` : item.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => runComparison()}
          disabled={loading || !pickedPIs.length}
          style={{
            padding: '8px 20px', borderRadius: 0, border: 'none',
            background: pickedPIs.length ? '#1492ff' : '#454545',
            color: '#fff', cursor: pickedPIs.length ? 'pointer' : 'default',
            fontSize: 14, fontWeight: 600,
          }}
        >
          {loading ? 'Loading…' : 'Compare'}
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(235,63,63,.15)', border: '1px solid #eb3f3f', borderRadius: 0, padding: '10px 14px', marginBottom: 20, color: '#eb3f3f', fontSize: 13 }}>
          ❌ {error}
        </div>
      )}

      {comparison && (
        <>
          {selectedTeam && (
            <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--primary)' }}>👥</span>
              Scoped to: <strong style={{ color: '#fff' }}>
                {(selectedTeam.startsWith('ROOT:') ? selectedTeam.slice(5) : selectedTeam).split('\\').pop()}
              </strong>
            </div>
          )}
          {/* Charts 2×2 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {CHARTS.map(({ key, label, color, maxVal }) => (
              <div key={key} data-copy-scope style={{ background: '#2B2B2B', border: '1px solid #454545', borderRadius: 0, padding: '16px 16px 12px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#ADADAD', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {label}
                  <CopyButton type="chart" />
                </div>
                <div style={{ height: 200 }}>
                  <Line
                    data={makeLineData(labels, comparison.map(d => d[key]), color, label)}
                    options={chartOptions(maxVal, label)}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* PI Predictability Trend — full width */}
          <div data-copy-scope style={{ background: '#2B2B2B', border: '1px solid #454545', borderRadius: 0, padding: '16px 16px 12px', marginBottom: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#ADADAD', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              📈 PI Predictability Trend
              <CopyButton type="chart" />
            </div>
            {/* KPI strip */}
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12, fontSize: 12 }}>
              {comparison.map(d => {
                const c = d.doneRate >= 80 ? '#068443' : d.doneRate >= 50 ? '#F5CC00' : '#eb3f3f';
                return (
                  <span key={d.pi}>
                    <strong style={{ color: '#1492ff' }}>{d.pi}</strong>
                    <span style={{ color: c, fontWeight: 700, marginLeft: 6 }}>{d.doneRate}%</span>
                    <span style={{ color: '#888', marginLeft: 3 }}>({d.featureDone}/{d.featureTotal})</span>
                  </span>
                );
              })}
            </div>
            <div style={{ height: 200 }}>
              <Line
                data={{
                  labels,
                  datasets: [
                    {
                      label: 'Done Rate %',
                      data: comparison.map(d => d.doneRate),
                      borderColor: '#068443',
                      backgroundColor: '#06844322',
                      pointBackgroundColor: comparison.map(d => d.doneRate >= 80 ? '#068443' : d.doneRate >= 50 ? '#F5CC00' : '#eb3f3f'),
                      pointBorderColor: '#1a1a1a',
                      fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: 6,
                    },
                    {
                      label: 'Target 80%',
                      data: comparison.map(() => 80),
                      borderColor: '#F5CC00',
                      backgroundColor: 'transparent',
                      borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5,
                    },
                  ],
                }}
                options={chartOptions(100, 'Done Rate %')}
              />
            </div>
          </div>

          {/* Comparison table */}
          <div data-copy-scope style={{ background: '#2B2B2B', border: '1px solid #454545', borderRadius: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #454545' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#ADADAD', textTransform: 'uppercase', letterSpacing: '0.05em' }}>PI Comparison</span>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                <DownloadCSVButton filename="pi-comparison.csv" />
                <CopyButton type="table" />
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #454545' }}>
                  {['PI', 'F.Total', 'F.Done', 'Done Rate', 'D.Total', 'D.Resolved', 'Escape', 'Density', 'Health'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#ADADAD', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.map((row, i) => {
                  const healthRAG = getRAG(row.healthScore, 'healthScore', ragThresholds);
                  const doneRAG   = getRAG(row.doneRate,    'doneRate',    ragThresholds);
                  const escapeRAG = getRAG(row.escapeRatio, 'escapeRatio', ragThresholds);
                  return (
                    <tr key={row.pi} style={{ borderBottom: i < comparison.length - 1 ? '1px solid #363636' : 'none' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#1492ff' }}>{row.pi}</td>
                      <td style={{ padding: '10px 12px', color: '#fff' }}>{row.featureTotal}</td>
                      <td style={{ padding: '10px 12px', color: '#fff' }}>{row.featureDone}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span className={`rag-cell ${ragClass(doneRAG)}`}>{row.doneRate}%</span>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#fff' }}>{row.defectTotal}</td>
                      <td style={{ padding: '10px 12px', color: '#fff' }}>{row.defectResolved}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span className={`rag-cell ${ragClass(escapeRAG)}`}>{row.escapeRatio}%</span>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#fff' }}>{row.defectDensity}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span className={`rag-badge ${ragClass(healthRAG)}`}>
                          <span className="rag-dot" />
                          {row.healthScore}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!comparison && !loading && !error && (
        <div style={{ textAlign: 'center', padding: 48, color: '#ADADAD', fontSize: 14 }}>
          Select PIs above and click <strong style={{ color: '#1492ff' }}>Compare</strong> to see the comparison.
        </div>
      )}
    </div>
  );
}
