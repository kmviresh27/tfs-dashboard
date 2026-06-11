import { useMemo, useState, Fragment } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import { Bar, Radar, Doughnut } from 'react-chartjs-2';
import { useQueryClient } from '@tanstack/react-query';
import useStore from '../store/useStore.js';
import { useKPI, useAnnotations } from '../api/hooks.js';
import { apiFetch } from '../api/apiClient.js';
import { TM_COLORS } from '../constants.js';
import CopyButton from '../components/ui/CopyButton.jsx';
import ChartAnnotations, { AnnotationButton } from '../components/ui/ChartAnnotations.jsx';
import { PageLoader } from '../components/ui/PageLoader.jsx';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  annotationPlugin,
);

const GROUP_META = {
  quality: { label: 'Quality', icon: '🧪', desc: 'Test depth & real-world coverage', color: 'var(--success)' },
  process: { label: 'Process', icon: '⚙️', desc: 'Standards & collaboration', color: 'var(--accent)' },
  change:  { label: 'Change Mgmt', icon: '🔄', desc: 'Integration & impact awareness', color: 'var(--caution)' },
  ai:      { label: 'AI / Auto', icon: '🤖', desc: 'End-to-end efficiency', color: '#20c997' },
};

const RAG_STYLE = {
  green:   { color: '#068443', bg: 'rgba(6,132,67,0.12)', border: 'rgba(6,132,67,0.4)', label: '✅ On Track' },
  amber:   { color: '#f5cc00', bg: 'rgba(245,204,0,0.12)', border: 'rgba(245,204,0,0.4)', label: '⚠️ At Risk' },
  red:     { color: '#eb3f3f', bg: 'rgba(235,63,63,0.12)', border: 'rgba(235,63,63,0.4)', label: '🔴 Off Track' },
  unknown: { color: '#666', bg: 'rgba(102,102,102,0.14)', border: 'rgba(120,120,120,0.35)', label: '⏳ No Data' },
};

const TYPE_BADGE = {
  leading: { bg: 'rgba(20,146,255,0.15)', color: '#1492ff', border: 'rgba(20,146,255,0.3)', label: 'Leading' },
  lagging: { bg: 'rgba(255,127,15,0.15)', color: '#ff7f0f', border: 'rgba(255,127,15,0.3)', label: 'Lagging' },
};

const RADAR_AXES = ['Exploratory', 'FMEA', 'Checklist', 'Cross-Review', 'Impact', 'AI-Assisted'];
const RADAR_FIELDS = ['exploratory', 'fmea', 'checklist', 'crossReview', 'impactAssess', 'aiAssisted'];
const RADAR_COLORS = Array.isArray(TM_COLORS) && TM_COLORS.length >= 6
  ? TM_COLORS.slice(0, 6)
  : ['#1492ff', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];

const KPI_SHORT_LABELS = {
  'exploratory-coverage': 'Exploratory',
  'fmea-coverage': 'FMEA',
  'checklist-compliance': 'Checklist',
  'cross-team-review': 'Cross-Review',
  'impact-assessment': 'Impact',
  'ai-assisted-usage': 'AI-Assisted',
  'late-changes': 'Late Changes',
  'say-do-ratio': 'Say / Do',
  'post-integration-regression': 'Post-Int Regression',
  'regression-defects': 'Regression Defects',
  'scenario-gap-defects': 'Scenario Gap',
  'missed-standard-defects': 'Missed Standard',
  'build-time-reduction': 'Build Time',
  'build-stability': 'Build Stability',
};

const inputStyle = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 0,
  padding: '6px 8px',
  color: 'var(--text)',
  fontSize: 13,
  boxSizing: 'border-box',
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function computeRag(value, target, dir) {
  if (value == null) return 'unknown';
  const v = Number(value), t = Number(target);
  if (dir === 'count') return v === 0 ? 'green' : v <= 3 ? 'amber' : 'red';
  if (dir === 'lte') return v <= t ? 'green' : v <= t * 1.2 ? 'amber' : 'red';
  if (!t) return v > 0 ? 'green' : 'amber';
  const ratio = v / t;
  return ratio >= 1 ? 'green' : ratio >= 0.9 ? 'amber' : 'red';
}

function getGapInfo(value, target, dir, unit) {
  if (value == null || target == null) return null;
  const v = Number(value), t = Number(target);
  if (dir === 'count') {
    return v === 0 ? null : { isGood: false, gap: -v, displayLabel: `${v} vs 0 target` };
  }
  const gap = dir === 'gte' ? v - t : t - v;
  if (Math.abs(gap) < 0.5) return null;
  const isGood = gap >= 0;
  const abs = Math.abs(gap);
  const label = unit === '%' ? `${Math.round(abs)}pp` : unit === 'days' ? `${abs.toFixed(1)}d` : `${Math.round(abs)}`;
  return { isGood, gap, displayLabel: (isGood ? '+' : '−') + label };
}

function getTrendArrow(value, previousValue, targetDir) {
  if (value == null || previousValue == null) return null;
  const delta = Number(value) - Number(previousValue);
  if (Math.abs(delta) < 0.5) return { arrow: '→', color: 'var(--muted)' };
  const improving = (targetDir === 'gte' && delta > 0) || (targetDir === 'lte' && delta < 0) || (targetDir === 'count' && delta <= 0);
  return { arrow: improving ? '↑' : '↓', color: improving ? '#068443' : '#eb3f3f' };
}

function getTargetLabel({ target, targetDir, unit }) {
  if (target === null || target === undefined) return '—';
  const suffix = unit === '%' ? '%' : unit === 'days' ? 'd' : '';
  if (targetDir === 'count') return 'ideally 0';
  if (targetDir === 'lte') return `≤ ${target}${suffix}`;
  return `≥ ${target}${suffix}`;
}

function formatValue(value, unit) {
  if (value === null || value === undefined) return '—';
  if (unit === '%') return `${Math.round(value)}%`;
  if (unit === 'days') return `${Number(value).toFixed(1)}d`;
  return `${value}`;
}

function getProgressState(value, target, dir) {
  if (value === null || value === undefined) return { fill: 0, color: 'var(--muted)' };
  if (dir === 'count') {
    return {
      fill: clamp(100 - (Number(value) * 20)),
      color: value === 0 ? 'var(--success)' : value <= 2 ? 'var(--caution)' : 'var(--danger)',
    };
  }
  if (dir === 'lte') {
    const basis = Math.max(Number(value) || 0, Number(target) || 0, 1);
    return {
      fill: clamp(((Number(target) || 0) / basis) * 100),
      color: value <= target ? 'var(--success)' : value <= target * 1.2 ? 'var(--caution)' : 'var(--danger)',
    };
  }
  const safeTarget = Number(target) || 100;
  const fill = safeTarget > 0 ? clamp(((Number(value) || 0) / safeTarget) * 100) : clamp(Number(value) || 0);
  return {
    fill,
    color: fill >= 100 ? 'var(--success)' : fill >= 90 ? 'var(--caution)' : 'var(--danger)',
  };
}

function getDisplayTeamName(team) {
  return team?.split('\\').pop() || team;
}

function getShortLabel(kpi) {
  return KPI_SHORT_LABELS[kpi.id]
    || kpi.name
      .replace(' Testing', '')
      .replace(' Coverage', '')
      .replace(' Compliance', '')
      .replace(' Assessment', '')
      .replace(' Usage', '');
}

function Modal({ onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
      zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--surface-1)', border: '1px solid var(--border)',
        width: '90vw', maxWidth: 720, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        borderRadius: 0,
      }}>
        {children}
      </div>
    </div>
  );
}

function KPIDetailModal({ kpi, pi, teamBreakdown, onClose, onPipelineSaved }) {
  if (!kpi) return null;

  const ragS = RAG_STYLE[kpi.rag] || RAG_STYLE.unknown;
  const typeBadge = TYPE_BADGE[kpi.type] || TYPE_BADGE.leading;

  return (
    <Modal onClose={onClose}>
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.25 }}>{kpi.name}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
              background: typeBadge.bg, color: typeBadge.color, border: `1px solid ${typeBadge.border}`,
            }}>
              {typeBadge.label}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
              background: ragS.bg, color: ragS.color, border: `1px solid ${ragS.border}`,
            }}>
              {ragS.label}
            </span>
          </div>
        </div>
        <button type="button" onClick={onClose} style={{
          background: 'none', border: '1px solid var(--border)', borderRadius: 0,
          color: 'var(--muted)', cursor: 'pointer', padding: '6px 10px', lineHeight: 1,
        }}>
          ✕
        </button>
      </div>

      <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `3px solid ${ragS.color}`,
          borderRadius: 0, padding: 16,
        }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: ragS.color }}>{formatValue(kpi.value, kpi.unit)}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Target {getTargetLabel(kpi)}</div>
            {kpi.seq !== null && kpi.seq !== undefined && <div style={{ fontSize: 12, color: 'var(--muted)' }}>KPI #{kpi.seq}</div>}
          </div>
          {(kpi.met !== null && kpi.met !== undefined && kpi.total !== null && kpi.total !== undefined) && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
              {kpi.met} of {kpi.total} items meet this KPI.
            </div>
          )}
          {(kpi.baseline !== null && kpi.baseline !== undefined) && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              Baseline: {formatValue(kpi.baseline, kpi.unit)}
            </div>
          )}
        </div>

        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 0, padding: 14,
        }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Formula
          </div>
          <div style={{
            fontSize: 12, lineHeight: 1.6, fontFamily: 'Consolas, Menlo, Monaco, monospace',
            background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 0, padding: '10px 12px', color: '#58a6ff',
          }}>
            {kpi.formula || 'Not available'}
          </div>
        </div>

        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 0, padding: 14,
        }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Note
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.65 }}>
            {kpi.note || 'No additional note available.'}
          </div>
        </div>

        <TeamBreakdown kpiId={kpi.id} teamBreakdown={teamBreakdown} />

        {kpi.isManual && (
          <PipelineInputPanel key={kpi.id} kpi={kpi} pi={pi} onSaved={onPipelineSaved} />
        )}
      </div>

      <div style={{
        padding: '14px 20px', borderTop: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {kpi.tfsUrlMet && (
            <a
              href={kpi.tfsUrlMet}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 4,
                border: '1px solid rgba(6,132,67,0.4)', background: 'rgba(6,132,67,0.1)',
                color: '#3ecf8e', textDecoration: 'none',
              }}
            >
              ✓ Followed ({kpi.metCount ?? 0})
            </a>
          )}
          {kpi.tfsUrlNotMet && (
            <a
              href={kpi.tfsUrlNotMet}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 4,
                border: '1px solid rgba(235,63,63,0.4)', background: 'rgba(235,63,63,0.1)',
                color: '#eb3f3f', textDecoration: 'none',
              }}
            >
              ✗ Not Followed ({kpi.notMetCount ?? 0})
            </a>
          )}
          {kpi.tfsUrl && !kpi.tfsUrlMet && (
            <a
              href={kpi.tfsUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 4,
                border: '1px solid rgba(20,146,255,0.35)', background: 'rgba(20,146,255,0.12)',
                color: '#1492ff', textDecoration: 'none',
              }}
            >
              🔗 TFS
            </a>
          )}
        </div>
        <button type="button" onClick={onClose} style={{
          padding: '6px 14px', borderRadius: 0, border: '1px solid var(--border)',
          background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer',
        }}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function ProgressBar({ value, target, dir, rag }) {
  if (value === null || value === undefined) {
    return <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 0 }} />;
  }

  const progress = getProgressState(value, target, dir);
  const ragColor = (RAG_STYLE[rag] || {}).color;

  return (
    <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 0, overflow: 'hidden' }}>
      <div style={{
        height: '100%',
        width: `${progress.fill}%`,
        background: ragColor || progress.color,
        borderRadius: 0,
        transition: 'width 0.4s ease',
      }} />
    </div>
  );
}

function ValueDisplay({ kpi }) {
  const ragS = RAG_STYLE[kpi.rag] || RAG_STYLE.unknown;

  if (kpi.value === null || kpi.value === undefined) {
    return (
      <div style={{ margin: '10px 0 8px' }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--muted)' }}>—</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>No data</div>
      </div>
    );
  }

  return (
    <div style={{ margin: '10px 0 8px' }}>
      <div style={{ fontSize: 30, fontWeight: 700, color: ragS.color, lineHeight: 1.1 }}>
        {formatValue(kpi.value, kpi.unit)}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
        Target {getTargetLabel(kpi)}
      </div>
    </div>
  );
}

function TeamBreakdown({ kpiId, teamBreakdown }) {
  const fieldMap = {
    'exploratory-coverage': 'exploratory',
    'fmea-coverage': 'fmea',
    'checklist-compliance': 'checklist',
    'cross-team-review': 'crossReview',
    'impact-assessment': 'impactAssess',
    'ai-assisted-usage': 'aiAssisted',
    'late-changes': 'lateChanges',
  };

  if (!teamBreakdown || !Object.keys(teamBreakdown).length) return null;

  const field = fieldMap[kpiId];
  if (!field) {
    return (
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 0, padding: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          Team Breakdown
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          No team-level breakdown is available for this KPI.
        </div>
      </div>
    );
  }

  const entries = Object.entries(teamBreakdown)
    .map(([team, data]) => ({
      team,
      value: data?.[field] ?? 0,
      features: data?.features ?? 0,
      tfsUrl: data?.tfsUrls?.[kpiId] || data?.tfsUrl,
    }))
    .sort((a, b) => b.value - a.value || b.features - a.features);

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 0, padding: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        Team Breakdown
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map(({ team, value, features, tfsUrl }) => {
          const isCount = field === 'lateChanges';
          const tone = isCount
            ? (value === 0 ? 'var(--success)' : value <= 2 ? 'var(--caution)' : 'var(--danger)')
            : (value >= 80 ? 'var(--success)' : value >= 60 ? 'var(--caution)' : 'var(--danger)');

          return (
            <div key={team} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 56px 90px', gap: 10, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                {tfsUrl ? (
                  <a
                    href={tfsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Open ${getDisplayTeamName(team)} items in TFS`}
                    style={{ color: 'var(--text)', textDecoration: 'none', fontSize: 12, fontWeight: 600 }}
                  >
                    {getDisplayTeamName(team)} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({features})</span>
                  </a>
                ) : (
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {getDisplayTeamName(team)} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({features})</span>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: tone, textAlign: 'right' }}>
                {isCount ? value : `${value}%`}
              </div>
              {isCount ? (
                <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>count</div>
              ) : (
                <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 0, overflow: 'hidden' }}>
                  <div style={{ width: `${clamp(value)}%`, height: '100%', background: tone, borderRadius: 0 }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PipelineInputPanel({ kpi, pi, onSaved }) {
  const [baseline, setBaseline] = useState(kpi.pipelineConfig?.baseline ?? '');
  const [current, setCurrent] = useState(kpi.pipelineConfig?.current ?? '');
  const [stability, setStability] = useState(kpi.pipelineConfig?.stability ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isTimeBased = kpi.id === 'build-time-reduction';

  async function handleSave() {
    setSaving(true);
    try {
      const body = isTimeBased
        ? { pi, buildTimeBaseline: parseFloat(baseline) || null, buildTimeCurrent: parseFloat(current) || null }
        : { pi, buildStability: parseFloat(stability) || null };

      await apiFetch('/api/kpi/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved?.();
    } catch {
      // ignore save errors here; query refresh will surface server issues elsewhere
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 0, padding: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        Pipeline Input
      </div>
      {isTimeBased ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>
            Baseline (min)
            <input type="number" value={baseline} onChange={e => setBaseline(e.target.value)} style={inputStyle} placeholder="e.g. 120" />
          </label>
          <label style={{ fontSize: 12, color: 'var(--muted)' }}>
            Current (min)
            <input type="number" value={current} onChange={e => setCurrent(e.target.value)} style={inputStyle} placeholder="e.g. 90" />
          </label>
        </div>
      ) : (
        <label style={{ fontSize: 12, color: 'var(--muted)', display: 'block', maxWidth: 220 }}>
          Stability %
          <input type="number" min="0" max="100" value={stability} onChange={e => setStability(e.target.value)} style={inputStyle} placeholder="0-100" />
        </label>
      )}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        style={{
          marginTop: 12, fontSize: 12, padding: '6px 12px', borderRadius: 0,
          border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer',
          opacity: saving ? 0.7 : 1,
        }}
      >
        {saved ? '✓ Saved' : saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  );
}

function KPICard({ kpi, onOpen, onQuickEdit }) {
  const ragS = RAG_STYLE[kpi.rag] || RAG_STYLE.unknown;
  const typeBadge = TYPE_BADGE[kpi.type] || TYPE_BADGE.leading;
  const hasValue = kpi.value !== null && kpi.value !== undefined;
  const noDataReason = hasValue ? null : kpi.isManual ? 'Not configured' : kpi.total === 0 ? 'No TFS items' : 'No data';
  const gapInfo = getGapInfo(kpi.value, kpi.target, kpi.targetDir, kpi.unit);
  const trendArrow = getTrendArrow(kpi.value, kpi.previousValue, kpi.targetDir);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.()}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(); } }}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${ragS.color}`,
        borderRadius: 0,
        padding: '10px 12px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface)'; }}
    >
      {/* Row 1: name + TFS links */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <span style={{
          fontSize: 12, fontWeight: 700, lineHeight: 1.35, flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {kpi.name}
        </span>
        <div
          onClick={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
          role="presentation"
          style={{ display: 'flex', gap: 3, flexShrink: 0 }}
        >
          {kpi.tfsUrlMet && (
            <a href={kpi.tfsUrlMet} target="_blank" rel="noopener noreferrer"
              title={`${kpi.metCount ?? ''} followed`}
              style={{ fontSize: 9, fontWeight: 600, padding: '2px 5px', borderRadius: 3, border: '1px solid rgba(6,132,67,0.4)', background: 'rgba(6,132,67,0.1)', color: '#3ecf8e', textDecoration: 'none' }}>
              ✓{kpi.metCount ?? ''}
            </a>
          )}
          {kpi.tfsUrlNotMet && (
            <a href={kpi.tfsUrlNotMet} target="_blank" rel="noopener noreferrer"
              title={`${kpi.notMetCount ?? ''} not followed`}
              style={{ fontSize: 9, fontWeight: 600, padding: '2px 5px', borderRadius: 3, border: '1px solid rgba(235,63,63,0.4)', background: 'rgba(235,63,63,0.1)', color: '#eb3f3f', textDecoration: 'none' }}>
              ✗{kpi.notMetCount ?? ''}
            </a>
          )}
          {!kpi.tfsUrlMet && !kpi.tfsUrlNotMet && kpi.tfsUrl && (
            <a href={kpi.tfsUrl} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 9, fontWeight: 600, padding: '2px 5px', borderRadius: 3, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', textDecoration: 'none' }}>
              🔗
            </a>
          )}
          {kpi.isManual && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onQuickEdit?.(); }}
              title="Quick enter value"
              style={{ fontSize: 9, fontWeight: 600, padding: '2px 5px', borderRadius: 3, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)', cursor: 'pointer' }}>
              ✏
            </button>
          )}
        </div>
      </div>

      {/* Row 2: big value + trend left, RAG + type stacked right */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5 }}>
          <span style={{ fontSize: 28, fontWeight: 800, color: ragS.color, lineHeight: 1 }}>
            {hasValue ? formatValue(kpi.value, kpi.unit) : '—'}
          </span>
          {trendArrow && (
            <span style={{ fontSize: 16, fontWeight: 700, color: trendArrow.color, lineHeight: 1.2, marginBottom: 2 }} title={`vs ${kpi.previousValue}${kpi.unit || ''} prior PI`}>
              {trendArrow.arrow}
            </span>
          )}
          {!hasValue && noDataReason && (
            <span style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 4, whiteSpace: 'nowrap' }}>{noDataReason}</span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 8, whiteSpace: 'nowrap',
            background: ragS.bg, color: ragS.color, border: `1px solid ${ragS.border}`,
          }}>
            {ragS.label}
          </span>
          <span style={{
            fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 8, whiteSpace: 'nowrap',
            background: typeBadge.bg, color: typeBadge.color, border: `1px solid ${typeBadge.border}`,
          }}>
            {typeBadge.label}
          </span>
        </div>
      </div>

      {/* Row 3: progress bar + target + gap chip */}
      <div>
        <ProgressBar value={kpi.value} target={kpi.target} dir={kpi.targetDir} rag={kpi.rag} />
        <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 3, lineHeight: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Target {getTargetLabel(kpi)}</span>
          {gapInfo && (
            <span style={{ fontWeight: 700, color: gapInfo.isGood ? '#068443' : '#eb3f3f' }}>
              {gapInfo.displayLabel}
            </span>
          )}
        </div>
      </div>

      {/* Row 4: sprint sparkline */}
      {kpi.sprintValues?.length > 0 && (
        <SprintSparkline sprintValues={kpi.sprintValues} target={kpi.target} targetDir={kpi.targetDir} unit={kpi.unit} />
      )}
    </div>
  );
}

function SummaryBar({ summary, total, kpis, previousPI, previousSummary }) {
  const green = summary?.green || 0;
  const amber = summary?.amber || 0;
  const red = summary?.red || 0;
  const unknown = summary?.unknown || 0;
  const leading = kpis?.filter(kpi => kpi.type === 'leading').length || 0;
  const lagging = kpis?.filter(kpi => kpi.type === 'lagging').length || 0;
  const overallScore = total ? Math.round((((green * 1) + (amber * 0.5)) / total) * 100) : 0;

  const prevScore = previousSummary && total
    ? Math.round(((previousSummary.green || 0) + (previousSummary.amber || 0) * 0.5) / total * 100)
    : null;
  const scoreDelta = prevScore != null ? overallScore - prevScore : null;

  const donutData = {
    labels: ['Green', 'Amber', 'Red', 'Unknown'],
    datasets: [{
      data: [green, amber, red, unknown],
      backgroundColor: ['#068443', '#f5cc00', '#eb3f3f', '#666'],
      borderWidth: 0,
      hoverOffset: 4,
    }],
  };

  const donutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '68%',
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: context => {
            const value = context.raw || 0;
            const pct = total ? Math.round((value / total) * 100) : 0;
            return ` ${context.label}: ${value} (${pct}%)`;
          },
        },
      },
    },
  };

  const ragItems = [
    { label: 'On Track', value: green, color: '#068443', bg: 'rgba(6,132,67,0.12)', border: 'rgba(6,132,67,0.3)' },
    { label: 'At Risk', value: amber, color: '#f5cc00', bg: 'rgba(245,204,0,0.12)', border: 'rgba(245,204,0,0.3)' },
    { label: 'Off Track', value: red, color: '#eb3f3f', bg: 'rgba(235,63,63,0.12)', border: 'rgba(235,63,63,0.3)' },
    { label: 'No Data', value: unknown, color: '#888', bg: 'rgba(100,100,100,0.10)', border: 'rgba(100,100,100,0.3)' },
  ];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      background: 'var(--surface)', border: '1px solid var(--border)',
      padding: '10px 14px', marginBottom: 18,
    }}>
      <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>
        <Doughnut data={donutData} options={donutOptions} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{overallScore}%</span>
        </div>
      </div>

      <div style={{ width: 1, height: 28, background: 'var(--border)', flexShrink: 0 }} />

      {ragItems.map(item => (
        <div key={item.label} style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: item.bg, border: `1px solid ${item.border}`,
          borderRadius: 4, padding: '3px 9px',
        }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: item.color, lineHeight: 1 }}>{item.value}</span>
          <span style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{item.label}</span>
        </div>
      ))}

      <div style={{ width: 1, height: 28, background: 'var(--border)', flexShrink: 0 }} />

      <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
        <span style={{ color: '#1492ff', fontWeight: 700 }}>{leading}</span> Leading ·{' '}
        <span style={{ color: '#ff7f0f', fontWeight: 700 }}>{lagging}</span> Lagging
      </span>

      {previousPI && (
        <>
          <div style={{ width: 1, height: 28, background: 'var(--border)', flexShrink: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>vs {previousPI}</span>
            {scoreDelta != null && (
              <span style={{ fontSize: 15, fontWeight: 700, color: scoreDelta >= 0 ? '#068443' : '#eb3f3f', lineHeight: 1 }}>
                {scoreDelta >= 0 ? '+' : ''}{scoreDelta}pp
              </span>
            )}
            {previousSummary && (
              <div style={{ display: 'flex', gap: 4, fontSize: 9 }}>
                <span style={{ color: '#068443', fontWeight: 700 }}>{previousSummary.green ?? 0}✓</span>
                <span style={{ color: '#f5cc00', fontWeight: 700 }}>{previousSummary.amber ?? 0}⚠</span>
                <span style={{ color: '#eb3f3f', fontWeight: 700 }}>{previousSummary.red ?? 0}✗</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Renders saved annotation notes as a compact strip below a chart */
function NoteStrip({ items = [] }) {
  if (!items.length) return null;
  return (
    <div style={{
      marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-sub)',
      display: 'flex', flexWrap: 'wrap', gap: 5,
    }}>
      {items.map(item => (
        <span key={item.id} style={{
          fontSize: 10, padding: '2px 8px',
          background: item.color + '1a', border: `1px solid ${item.color}55`,
          color: item.color, display: 'inline-flex', alignItems: 'center', gap: 5,
          maxWidth: '100%',
        }}>
          <span style={{ width: 5, height: 5, background: item.color, borderRadius: '50%', flexShrink: 0 }} />
          {item.sprint && <span style={{ color: 'var(--muted)', fontSize: 9, flexShrink: 0 }}>{item.sprint} ·</span>}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text}</span>
        </span>
      ))}
    </div>
  );
}

function SprintSparkline({ sprintValues, target, targetDir, unit }) {
  if (!sprintValues || !sprintValues.length) return null;
  const numericVals = sprintValues.filter(sv => sv.value != null).map(sv => sv.value);
  if (!numericVals.length) return null;
  const W = 100, H = 28, PAD = 3;
  const maxV = unit === '%' ? 100 : Math.max(...numericVals, target != null ? Number(target) : 0, 1);
  const tgtY = target != null ? PAD + (1 - Math.min(Number(target), maxV) / maxV) * (H - 2 * PAD) : null;
  const sX = i => sprintValues.length === 1 ? W / 2 : PAD + (i / (sprintValues.length - 1)) * (W - 2 * PAD);
  const sY = v => PAD + (1 - Math.max(0, Math.min(v, maxV)) / maxV) * (H - 2 * PAD);
  let pathD = '';
  sprintValues.forEach((sv, i) => {
    if (sv.value == null) return;
    pathD += pathD ? ` L${sX(i)},${sY(sv.value)}` : `M${sX(i)},${sY(sv.value)}`;
  });
  return (
    <div style={{ marginTop: 5 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block', overflow: 'visible' }}>
        {tgtY != null && <line x1={PAD} y1={tgtY} x2={W - PAD} y2={tgtY} stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="3,2" />}
        {pathD && <path d={pathD} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
        {sprintValues.map((sv, i) => {
          if (sv.value == null) return null;
          const r = computeRag(sv.value, target, targetDir);
          const c = (RAG_STYLE[r] || RAG_STYLE.unknown).color;
          return <circle key={sv.sprint} cx={sX(i)} cy={sY(sv.value)} r="2.5" fill={c} stroke="rgba(0,0,0,0.3)" strokeWidth="0.5" />;
        })}
        {sprintValues.map((sv, i) => (
          <text key={`l${sv.sprint}`} x={sX(i)} y={H} fill="rgba(255,255,255,0.3)" fontSize="5.5" textAnchor="middle" style={{ userSelect: 'none' }}>
            {sv.sprint}
          </text>
        ))}
      </svg>
    </div>
  );
}

function QuickEditPanel({ kpi, pi, onSaved, onClose }) {
  const [baseline, setBaseline] = useState(kpi.pipelineConfig?.baseline ?? '');
  const [current, setCurrent] = useState(kpi.pipelineConfig?.current ?? '');
  const [stability, setStability] = useState(kpi.pipelineConfig?.stability ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const isTimeBased = kpi.id === 'build-time-reduction';
  const ragS = RAG_STYLE[kpi.rag] || RAG_STYLE.unknown;

  async function handleSave() {
    setSaving(true);
    try {
      const body = isTimeBased
        ? { pi, buildTimeBaseline: parseFloat(baseline) || null, buildTimeCurrent: parseFloat(current) || null }
        : { pi, buildStability: parseFloat(stability) || null };
      await apiFetch('/api/kpi/pipeline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose?.(); onSaved?.(); }, 1200);
    } finally { setSaving(false); }
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none',
      borderLeft: `3px solid ${ragS.color}`,
      padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quick Enter</span>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1 }}>✕</button>
      </div>
      {isTimeBased ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>Baseline (min)<input type="number" value={baseline} onChange={e => setBaseline(e.target.value)} style={inputStyle} placeholder="e.g. 120" /></label>
          <label style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>Current (min)<input type="number" value={current} onChange={e => setCurrent(e.target.value)} style={inputStyle} placeholder="e.g. 90" /></label>
        </div>
      ) : (
        <label style={{ fontSize: 11, color: 'var(--muted)' }}>Stability %<input type="number" min="0" max="100" value={stability} onChange={e => setStability(e.target.value)} style={inputStyle} placeholder="0–100" /></label>
      )}
      <button type="button" onClick={handleSave} disabled={saving}
        style={{ fontSize: 11, padding: '4px 10px', border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer', alignSelf: 'flex-end', opacity: saving ? 0.7 : 1 }}>
        {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function KPIScoreBar({ kpis, inline, onNote, annItems = [], onOpen }) {
  const chartKpis = useMemo(
    () => (kpis || [])
      .filter(kpi => kpi.value !== null && kpi.value !== undefined)
      .sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999) || a.name.localeCompare(b.name)),
    [kpis],
  );

  if (!chartKpis.length) return null;

  const TRACK_H   = 44;
  const AXIS_MARKS = [0, 25, 50, 75, 100];
  const GROUP_ORDER = ['quality', 'process', 'change', 'ai'];
  const grouped = GROUP_ORDER
    .map(gid => ({ id: gid, meta: GROUP_META[gid], kpis: chartKpis.filter(k => k.group === gid) }))
    .filter(g => g.kpis.length > 0);
  const ungrouped = chartKpis.filter(k => !GROUP_ORDER.includes(k.group));
  if (ungrouped.length) grouped.push({ id: 'other', meta: { label: 'Other', icon: '📋', color: '#888' }, kpis: ungrouped });

  function renderRow(kpi) {
    const ragS      = RAG_STYLE[kpi.rag] || RAG_STYLE.unknown;
    const typeBadge = TYPE_BADGE[kpi.type] || TYPE_BADGE.leading;
    const trendArrow = getTrendArrow(kpi.value, kpi.previousValue, kpi.targetDir);
    const gapInfo   = getGapInfo(kpi.value, kpi.target, kpi.targetDir, kpi.unit);

    const val    = clamp(Number(kpi.value) || 0);
    const hasTgt = kpi.target !== null && kpi.target !== undefined;
    const tgt    = hasTgt ? clamp(Number(kpi.target)) : null;
    const ragColor = ragS.color;

    const isBehind  = gapInfo ? !gapInfo.isGood : false;
    const connLeft  = tgt != null ? Math.min(val, tgt) : val;
    const connWidth = tgt != null ? Math.abs(val - tgt) : 0;
    const tooClose  = tgt != null && Math.abs(val - tgt) < 12;
    const valShift  = tooClose ? (val <= tgt ? -6 : 6) : 0;
    const tgtShift  = tooClose ? (tgt <= val ? -6 : 6) : 0;

    return (
      <div
        key={kpi.id}
        role="button"
        tabIndex={0}
        title="Click for details"
        onClick={() => onOpen?.(kpi.id)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(kpi.id); } }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3, rgba(0,0,0,0.04))'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        style={{
          display: 'flex', alignItems: 'stretch', cursor: 'pointer',
          padding: '6px 0', borderBottom: '1px solid var(--border-sub, var(--border))',
          transition: 'background 0.1s',
        }}
      >
        {/* ── Label cell ── */}
        <div style={{ width: 155, flexShrink: 0, paddingRight: 10, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {getShortLabel(kpi)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 10, color: ragColor }}>{ragS.label}</span>
            {trendArrow && (
              <span style={{ fontSize: 11, color: trendArrow.color, lineHeight: 1 }} title="vs prior PI">{trendArrow.arrow}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 8, padding: '1px 4px', background: typeBadge.bg, color: typeBadge.color, border: `1px solid ${typeBadge.border}`, borderRadius: 3 }}>
              {typeBadge.label}
            </span>
            {kpi.tfsUrlMet && (
              <a href={kpi.tfsUrlMet} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                title={`${kpi.metCount ?? ''} items met`}
                style={{ fontSize: 8, padding: '1px 4px', background: 'rgba(6,132,67,0.12)', color: '#3ecf8e', border: '1px solid rgba(6,132,67,0.3)', borderRadius: 3, textDecoration: 'none' }}>
                ✓{kpi.metCount ?? ''}
              </a>
            )}
            {kpi.tfsUrlNotMet && (
              <a href={kpi.tfsUrlNotMet} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                title={`${kpi.notMetCount ?? ''} items not met`}
                style={{ fontSize: 8, padding: '1px 4px', background: 'rgba(235,63,63,0.12)', color: '#eb3f3f', border: '1px solid rgba(235,63,63,0.3)', borderRadius: 3, textDecoration: 'none' }}>
                ✗{kpi.notMetCount ?? ''}
              </a>
            )}
            {!kpi.tfsUrlMet && !kpi.tfsUrlNotMet && kpi.tfsUrl && (
              <a href={kpi.tfsUrl} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{ fontSize: 8, padding: '1px 4px', background: 'var(--surface-2)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 3, textDecoration: 'none' }}>
                🔗
              </a>
            )}
          </div>
        </div>

        {/* ── Plot cell ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative' }}>
          {/* Subtle vertical grid */}
          {AXIS_MARKS.filter(v => v > 0 && v < 100).map(v => (
            <div key={v} style={{ position: 'absolute', top: 0, bottom: 0, left: `${v}%`, width: 1, background: 'var(--border)', pointerEvents: 'none', opacity: 0.5 }} />
          ))}

          {/* Dumbbell track */}
          <div style={{ position: 'relative', height: TRACK_H }}>
            {/* Background track */}
            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, transform: 'translateY(-50%)', background: 'var(--border)' }} />

            {/* Connector */}
            {tgt != null && connWidth > 0.5 && (
              <div style={{
                position: 'absolute', top: '50%',
                left: `${connLeft}%`, width: `${connWidth}%`,
                height: 2, transform: 'translateY(-50%)',
                background: isBehind ? 'rgba(239,68,68,0.45)' : 'rgba(16,185,129,0.45)',
              }} />
            )}

            {/* Target diamond */}
            {tgt != null && (
              <div title={`Target: ${getTargetLabel(kpi)}`} style={{
                position: 'absolute', left: `${tgt}%`, top: '50%',
                transform: 'translate(-50%, -50%) rotate(45deg)',
                width: 11, height: 11,
                border: '2px solid var(--text)',
                background: 'var(--surface)', zIndex: 2,
              }} />
            )}

            {/* Value dot */}
            <div title={`${kpi.name}: ${formatValue(kpi.value, kpi.unit)}`} style={{
              position: 'absolute', left: `${val}%`, top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 14, height: 14, borderRadius: '50%',
              background: ragColor, boxShadow: `0 0 7px ${ragColor}90`,
              zIndex: 3,
            }} />

            {/* Value label — above dot */}
            <div style={{
              position: 'absolute',
              left: `calc(${val}% + ${valShift}px)`,
              bottom: 'calc(50% + 10px)',
              transform: 'translateX(-50%)',
              fontSize: 10, color: ragColor, fontWeight: 700,
              whiteSpace: 'nowrap', lineHeight: 1, pointerEvents: 'none',
            }}>
              {formatValue(kpi.value, kpi.unit)}
            </div>

            {/* Target label — below diamond */}
            {tgt != null && (
              <div style={{
                position: 'absolute',
                left: `calc(${tgt}% + ${tgtShift}px)`,
                top: 'calc(50% + 10px)',
                transform: 'translateX(-50%)',
                fontSize: 10, color: 'var(--muted)',
                whiteSpace: 'nowrap', lineHeight: 1, pointerEvents: 'none',
              }}>
                {getTargetLabel(kpi)}
              </div>
            )}
          </div>

        </div>

        {/* ── Diff cell ── */}
        <div style={{ width: 72, flexShrink: 0, paddingLeft: 10, display: 'flex', flexDirection: 'column', justifyContent: 'center', borderLeft: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: !gapInfo ? 'var(--muted)' : isBehind ? '#eb3f3f' : '#068443', lineHeight: 1.2 }}>
            {gapInfo ? (isBehind ? '▼ ' : '▲ ') : ''}{gapInfo ? gapInfo.displayLabel : '—'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.3 }}>
            {!gapInfo ? 'on target' : isBehind ? 'behind' : 'ahead'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-copy-scope style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 0,
      padding: 16, marginBottom: inline ? 0 : 16, display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>KPI Values vs Target</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 14, marginTop: 4 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#068443', display: 'inline-block', flexShrink: 0, boxShadow: '0 0 5px #068443' }} />
              Actual value
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 9, height: 9, border: '1.5px solid var(--text)', transform: 'rotate(45deg)', display: 'inline-block', flexShrink: 0 }} />
              Target
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 11 }}>↑↓</span> Trend vs prior PI
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted2)' }}>Click any row for full details</span>
          </div>
        </div>
        <div className="card-actions">
          <AnnotationButton onClick={onNote} />
          <CopyButton type="chart" expand={false} />
        </div>
      </div>

      {/* X-axis header */}
      <div style={{ display: 'flex', marginBottom: 2 }}>
        <div style={{ width: 155, flexShrink: 0 }} />
        <div style={{ flex: 1, position: 'relative', height: 14 }}>
          {AXIS_MARKS.map(v => (
            <span key={v} style={{
              position: 'absolute', left: `${v}%`, top: 0,
              transform: 'translateX(-50%)',
              fontSize: 9, color: 'var(--muted2)', userSelect: 'none',
            }}>{v}%</span>
          ))}
        </div>
        <div style={{ width: 72, paddingLeft: 10 }}>
          <span style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Δ vs target</span>
        </div>
      </div>

      {/* Groups + rows */}
      {grouped.map(group => (
        <div key={group.id}>
          {group.kpis.map(kpi => renderRow(kpi))}
        </div>
      ))}

      {/* X-axis baseline */}
      <div style={{ display: 'flex', marginTop: 4 }}>
        <div style={{ width: 155, flexShrink: 0 }} />
        <div style={{ flex: 1, borderTop: '1px solid var(--border)', height: 0 }} />
        <div style={{ width: 72 }} />
      </div>

      <NoteStrip items={annItems} />
    </div>
  );
}

function TeamRadar({ teamBreakdown, inline, onHeatmap, onNote, annItems = [] }) {
  const theme = useStore(s => s.theme);
  const isLight = theme === 'light';

  const teams = useMemo(
    () => Object.entries(teamBreakdown || {})
      .sort(([, a], [, b]) => (b?.features ?? 0) - (a?.features ?? 0))
      .slice(0, 6),
    [teamBreakdown],
  );

  if (teams.length <= 1) return null;

  const gridColor       = isLight ? 'rgba(0,0,0,0.15)'   : 'rgba(255,255,255,0.15)';
  const labelColor      = isLight ? '#374151'             : '#E5E5E5';
  const tickColor       = isLight ? '#6b7280'             : '#ADADAD';
  const legendColor     = isLight ? '#374151'             : '#ADADAD';
  const pointBorderClr  = isLight ? '#ffffff'             : '#ffffff';

  const radarData = {
    labels: RADAR_AXES,
    datasets: teams.map(([team, data], index) => {
      const color = RADAR_COLORS[index % RADAR_COLORS.length];
      return {
        label: getDisplayTeamName(team),
        data: RADAR_FIELDS.map(field => clamp(Number(data?.[field] ?? 0))),
        backgroundColor: `${color}22`,
        borderColor: color,
        borderWidth: 2,
        pointBackgroundColor: color,
        pointBorderColor: pointBorderClr,
        pointBorderWidth: 1,
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: true,
      };
    }),
  };

  const radarOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: legendColor, boxWidth: 12, padding: 10 } },
      tooltip: {
        callbacks: {
          label: context => ` ${context.dataset.label}: ${context.raw}%`,
        },
      },
    },
    scales: {
      r: {
        min: 0,
        max: 100,
        ticks: { color: tickColor, stepSize: 20, backdropColor: 'transparent' },
        grid: { color: gridColor },
        angleLines: { color: gridColor },
        pointLabels: { color: labelColor, font: { size: 11 } },
      },
    },
  };

  return (
    <div data-copy-scope style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 0, padding: 16, marginBottom: inline ? 0 : 16, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Team Coverage Radar</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Top {teams.length} teams by feature volume.</div>
        </div>
        <div className="card-actions">
          {onHeatmap && (
            <button
              onClick={onHeatmap}
              title="View Team Heatmap"
              style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', padding: '2px 7px', color: 'var(--muted)', fontSize: 11 }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              </svg>
            </button>
          )}
          <AnnotationButton onClick={onNote} />
          <CopyButton type="chart" expand={false} />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Radar data={radarData} options={radarOptions} />
      </div>
      <NoteStrip items={annItems} />
    </div>
  );
}

function TeamHeatmap({ teamBreakdown, kpis }) {
  if (!teamBreakdown || !Object.keys(teamBreakdown).length) return null;

  const heatmapKpis = (kpis || []).filter(kpi => ['exploratory-coverage', 'fmea-coverage', 'checklist-compliance', 'cross-team-review', 'impact-assessment', 'ai-assisted-usage'].includes(kpi.id));
  const teams = Object.keys(teamBreakdown).sort((a, b) => getDisplayTeamName(a).localeCompare(getDisplayTeamName(b)));
  const fieldFor = {
    'exploratory-coverage': 'exploratory',
    'fmea-coverage': 'fmea',
    'checklist-compliance': 'checklist',
    'cross-team-review': 'crossReview',
    'impact-assessment': 'impactAssess',
    'ai-assisted-usage': 'aiAssisted',
  };

  function cellTone(value) {
    if (value >= 80) return { bg: 'rgba(6,132,67,0.45)', color: '#b5f5c3' };
    if (value >= 60) return { bg: 'rgba(245,204,0,0.38)', color: '#f6e28e' };
    return { bg: 'rgba(235,63,63,0.38)', color: '#ffb0b0' };
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--muted)', borderBottom: '1px solid var(--border)', minWidth: 140 }}>Team</th>
              <th style={{ textAlign: 'center', padding: '10px 6px', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>Feats</th>
              {heatmapKpis.map(kpi => (
                <th key={kpi.id} style={{ textAlign: 'center', padding: '10px 6px', color: 'var(--muted)', borderBottom: '1px solid var(--border)', minWidth: 88 }}>
                  {getShortLabel(kpi)}
                </th>
              ))}
              <th style={{ textAlign: 'center', padding: '10px 6px', color: 'var(--muted)', borderBottom: '1px solid var(--border)', minWidth: 88 }}>Late Chg</th>
            </tr>
          </thead>
          <tbody>
            {teams.map(team => {
              const teamData = teamBreakdown[team] || {};
              return (
                <tr key={team}>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' }}>
                    <span style={{ fontWeight: 600 }}>{getDisplayTeamName(team)}</span>
                    {teamData.tfsUrl && (
                      <a
                        href={teamData.tfsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Open ${getDisplayTeamName(team)} items in TFS`}
                        style={{ marginLeft: 8, fontSize: 11, color: '#1492ff', textDecoration: 'none' }}
                      >
                        🔗
                      </a>
                    )}
                  </td>
                  <td style={{ textAlign: 'center', padding: '10px 6px', color: 'var(--muted)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{teamData.features ?? 0}</td>
                  {heatmapKpis.map(kpi => {
                    const value = teamData[fieldFor[kpi.id]] ?? 0;
                    const tone = cellTone(value);
                    const cellUrl = teamData.tfsUrls?.[kpi.id];
                    return (
                      <td key={kpi.id} style={{
                        textAlign: 'center', padding: '10px 6px', fontWeight: 700,
                        background: tone.bg, color: tone.color, borderBottom: '1px solid rgba(255,255,255,0.06)',
                      }}>
                        {cellUrl ? (
                          <a href={cellUrl} target="_blank" rel="noopener noreferrer" title={`Open ${getDisplayTeamName(team)} · ${kpi.name} in TFS`} style={{ color: 'inherit', textDecoration: 'none' }}>
                            {value}%
                          </a>
                        ) : `${value}%`}
                      </td>
                    );
                  })}
                  <td style={{
                    textAlign: 'center', padding: '10px 6px', fontWeight: 700,
                    color: (teamData.lateChanges ?? 0) === 0 ? '#b5f5c3' : (teamData.lateChanges ?? 0) <= 2 ? '#f6e28e' : '#ffb0b0',
                    background: (teamData.lateChanges ?? 0) === 0 ? 'rgba(6,132,67,0.25)' : (teamData.lateChanges ?? 0) <= 2 ? 'rgba(245,204,0,0.22)' : 'rgba(235,63,63,0.22)',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    {teamData.tfsUrls?.['late-changes'] ? (
                      <a href={teamData.tfsUrls['late-changes']} target="_blank" rel="noopener noreferrer" title={`Open ${getDisplayTeamName(team)} late changes in TFS`} style={{ color: 'inherit', textDecoration: 'none' }}>
                        {teamData.lateChanges ?? 0}
                      </a>
                    ) : (teamData.lateChanges ?? 0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
  );
}

export default function KPISection() {
  const { currentPI, selectedPIs, selectedTeam } = useStore();
  const pi = (selectedPIs?.length ? selectedPIs[0] : null) || currentPI;
  const RAG_ORDER = { red: 0, amber: 1, green: 2, unknown: 3 };
  const GROUP_COLS = ['quality', 'process', 'change', 'ai'];
  const sortByRag = arr => [...arr].sort((a, b) => (RAG_ORDER[a.rag] ?? 3) - (RAG_ORDER[b.rag] ?? 3));
  const [selectedKpiId, setSelectedKpiId] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [annPopup, setAnnPopup] = useState({ open: false, sprints: [], chartId: '' });
  const [showInfo, setShowInfo] = useState(false);
  const [quickEditKpiId, setQuickEditKpiId] = useState(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, isError, error, refetch } = useKPI(pi, selectedTeam || null);
  const { data: annData } = useAnnotations('kpi', pi, selectedTeam);
  const annItems = annData?.items || [];

  async function handleDeleteAnnotation(id) {
    await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: ['annotations', 'kpi'] });
  }

  function openAnnPopup(sprints, chartId = '') {
    setAnnPopup({ open: true, sprints, chartId });
  }

  const allKpis = useMemo(
    () => [...(data?.kpis || [])].sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999) || a.name.localeCompare(b.name)),
    [data?.kpis],
  );

  const selectedKpi = useMemo(
    () => allKpis.find(kpi => kpi.id === selectedKpiId) || null,
    [allKpis, selectedKpiId],
  );

  function handlePipelineSaved() {
    queryClient.invalidateQueries({ queryKey: ['kpi', pi, selectedTeam || null] });
  }

  if (isLoading) return <PageLoader label="Loading KPI data…" />;

  if (isError) {
    return (
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>📊 KPI Tracker</div>
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--danger)', borderRadius: 0,
          textAlign: 'center', padding: 32,
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontSize: 14, color: 'var(--danger)', marginBottom: 8 }}>Failed to load KPI data</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>{error?.message}</div>
          <button type="button" onClick={() => refetch()} style={{
            padding: '6px 14px', borderRadius: 0, border: '1px solid var(--border)',
            background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer',
          }}>
            ↻ Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 22, fontWeight: 700 }}>📊 KPI Tracker</span>
            <span style={{
              fontSize: 12, color: 'var(--muted)', padding: '2px 8px', background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 0,
            }}>
              {allKpis.length} KPIs
            </span>
            <button
              type="button"
              onClick={() => setShowInfo(true)}
              title="Delivery notes & prerequisites"
              style={{
                background: 'none', border: '1px solid var(--border)', borderRadius: '50%',
                width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'var(--muted)', fontSize: 12, fontWeight: 700, lineHeight: 1,
                padding: 0, flexShrink: 0,
              }}
            >
              i
            </button>
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Quality · Process · Change Management · AI / Automation
            {data?.pi && <span> · <strong style={{ color: 'var(--text)' }}>{data.pi}</strong></span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {data?.computedAt && <span style={{ fontSize: 11, color: 'var(--muted)' }}>🕐 {new Date(data.computedAt).toLocaleTimeString()}</span>}
        </div>
      </div>

      {isFetching && !isLoading && (
        <div style={{ marginBottom: 12 }}>
          <div style={{
            height: 3, borderRadius: 2,
            background: 'var(--border)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              background: 'var(--primary-light)',
              animation: 'kpi-loading-bar 1.4s ease-in-out infinite',
            }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>⟳ Refreshing KPI data…</div>
        </div>
      )}

      <div style={{
        display: 'flex', gap: 12, fontSize: 12, color: 'var(--muted)',
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 0,
        padding: '10px 14px', marginBottom: 20, flexWrap: 'wrap',
      }}>
        <span>📦 <strong style={{ color: 'var(--text)' }}>{data?.totalFeatures ?? 0}</strong> Features</span>
        <span>🐛 <strong style={{ color: 'var(--text)' }}>{data?.totalBugs ?? 0}</strong> Defects</span>
        <span>🏃 PI: <strong style={{ color: 'var(--text)' }}>{data?.pi || pi}</strong></span>
        {selectedTeam && <span>👥 Team: <strong style={{ color: 'var(--text)' }}>{getDisplayTeamName(selectedTeam)}</strong></span>}
      </div>

      <SummaryBar summary={data?.summary} total={allKpis.length} kpis={allKpis}
        previousPI={data?.previousPI} previousSummary={data?.previousSummary} />

      <div style={{ display: 'grid', gridTemplateColumns: !selectedTeam ? '1fr 420px' : '1fr', gap: 14, marginBottom: 16, alignItems: 'stretch' }}>
        <KPIScoreBar kpis={allKpis} inline annItems={annItems} onOpen={setSelectedKpiId} onNote={() => openAnnPopup(allKpis.map(getShortLabel), 'kpi-score')} />
        {!selectedTeam && (
          <TeamRadar
            teamBreakdown={data?.teamBreakdown}
            inline
            annItems={annItems}
            onHeatmap={data?.teamBreakdown && Object.keys(data.teamBreakdown).length > 0 ? () => setShowHeatmap(true) : null}
            onNote={() => openAnnPopup([], 'kpi-team-radar')}
          />
        )}
      </div>



      {showHeatmap && (
        <div
          onClick={() => setShowHeatmap(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 3000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 0,
              width: '100%', maxWidth: 1100, maxHeight: '90vh', display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0,
            }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>📊 KPI Team Heatmap</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Feature-based KPIs by team · {data?.pi || pi}</div>
              </div>
              <button
                onClick={() => setShowHeatmap(false)}
                style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: 0,
                  color: 'var(--muted)', cursor: 'pointer', fontSize: 18, padding: '2px 10px', lineHeight: 1.4,
                }}
              >✕</button>
            </div>
            <div style={{ overflow: 'auto', flex: 1 }}>
              <TeamHeatmap teamBreakdown={data?.teamBreakdown} kpis={allKpis} />
            </div>
          </div>
        </div>
      )}

      <KPIDetailModal
        kpi={selectedKpi}
        pi={currentPI}
        teamBreakdown={data?.teamBreakdown}
        onClose={() => setSelectedKpiId(null)}
        onPipelineSaved={handlePipelineSaved}
      />

      {showInfo && (
        <div
          onClick={() => setShowInfo(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 0, width: '100%', maxWidth: 700, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>ℹ KPI Notes & Prerequisites</div>
              <button
                onClick={() => setShowInfo(false)}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 18, padding: '2px 10px', lineHeight: 1.4 }}
              >✕</button>
            </div>
            <div style={{ overflow: 'auto', flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ background: 'rgba(248,81,73,0.06)', border: '1px solid rgba(248,81,73,0.2)', borderRadius: 0, padding: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                  📋 Delivery - Requirements Clarity <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>(No KPI)</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
                  No trackable KPI defined for this focus area. Team note: <em>"16% requirement changes/misses are anticipated in a big &amp; complex release like AVW-16 - current state is good."</em>
                  <br />
                  Action: Better definition of implicit requirements per feature; DRS will be picked up in the next release.
                </div>
              </div>
              <div style={{ background: 'rgba(245,204,0,0.06)', border: '1px solid rgba(245,204,0,0.2)', borderRadius: 0, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>⚙️ Prerequisites for full KPI accuracy</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
                  {[
                    'Use tags: Scenario-Gap, Missed-Standard, Regression, Late-Change, AI-Assisted on work items',
                    'Attach mindmap/FMEA files to Feature work items (name must contain keyword)',
                    'Link impact analysis documents to Features',
                    'Create review tasks linked to Features with "review" in the title',
                    'Update DoD to include mindmap, FMEA, impact analysis artifacts',
                    'Enter pipeline baseline/current values via the Build KPI modal',
                  ].map(item => (
                    <div key={item} style={{ display: 'flex', gap: 6 }}>
                      <span style={{ color: 'var(--caution)', flexShrink: 0 }}>•</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ChartAnnotations
        section="kpi"
        chartId={annPopup.chartId || ''}
        pi={pi}
        team={selectedTeam}
        sprints={annPopup.sprints}
        open={annPopup.open}
        setOpen={open => setAnnPopup(prev => ({ ...prev, open }))}
        items={annItems}
        onDelete={handleDeleteAnnotation}
      />
    </div>
  );
}