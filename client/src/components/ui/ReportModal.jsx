import { useState, useEffect, useMemo, useRef } from 'react';
import useStore from '../../store/useStore.js';
import { useAuth } from '../../hooks/useAuth.js';
import { PageLoader } from './PageLoader.jsx';

const REPORT_TYPES = [
  // ── RTE / Release Train Engineer ─────────────────────────────────────────
  {
    id: 'pi-feature-delivery',
    label: 'PI Feature Delivery',
    icon: '📊',
    roles: ['rte', 'pm', 'all', 'admin'],
    desc: 'Features committed vs completed across all sprints.',
    group: 'RTE',
  },
  {
    id: 'sprint-progress',
    label: 'Sprint-wise Progress',
    icon: '🏃',
    roles: ['rte', 'sm', 'all', 'admin'],
    desc: 'Planned vs completed stories per sprint, carryover, health.',
    group: 'RTE',
  },
  {
    id: 'pi-predictability',
    label: 'PI Predictability',
    icon: '🎯',
    roles: ['rte', 'exec', 'all', 'admin'],
    desc: 'Planned vs actual delivery and confidence. Predictability % per sprint and team.',
    group: 'RTE',
  },
  {
    id: 'dependency-risk',
    label: 'Dependency & Risk',
    icon: '⚠️',
    roles: ['rte', 'pm', 'all', 'admin'],
    desc: 'Blocked features, cross-team dependencies, RAID items.',
    group: 'RTE',
  },
  // ── Product Manager ───────────────────────────────────────────────────────
  {
    id: 'business-value',
    label: 'Business Value Delivery',
    icon: '💼',
    roles: ['pm', 'rte', 'exec', 'all', 'admin'],
    desc: 'Planned BV vs delivered BV by objective. Achievement % by team.',
    group: 'PM',
  },
  // ── Product Owner ─────────────────────────────────────────────────────────
  {
    id: 'story-by-feature',
    label: 'Story Completion by Feature',
    icon: '📌',
    roles: ['po', 'pm', 'sm', 'all', 'admin'],
    desc: 'Stories done vs total per feature. Features fully/partially done.',
    group: 'PO',
  },
  {
    id: 'backlog-readiness',
    label: 'Backlog Readiness',
    icon: '📝',
    roles: ['po', 'sm', 'all', 'admin'],
    desc: 'Stories missing estimates or assignees. Backlog health for the next sprint.',
    group: 'PO',
  },
  // ── QA Lead ───────────────────────────────────────────────────────────────
  {
    id: 'defect-summary',
    label: 'Defect Summary',
    icon: '🔴',
    roles: ['qa', 'rte', 'all', 'admin'],
    desc: 'Defects by severity, sprint, and team. P1/P2 breakdown.',
    group: 'QA',
  },
  {
    id: 'release-readiness',
    label: 'Release Readiness',
    icon: '🚀',
    roles: ['rte', 'pm', 'all', 'admin'],
    desc: 'Feature dev status, testing status, open defects, blockers, Go/No-Go.',
    group: 'Release',
  },
  // ── Engineering Manager ───────────────────────────────────────────────────
  {
    id: 'team-health',
    label: 'Team Delivery Health',
    icon: '🏥',
    roles: ['em', 'rte', 'all', 'admin'],
    desc: 'Velocity, features, stories, and defect density per team.',
    group: 'EM',
  },
  // ── Leadership / Executive ────────────────────────────────────────────────
  {
    id: 'executive-summary',
    label: 'Executive Summary',
    icon: '📋',
    roles: ['all', 'admin', 'rte', 'exec'],
    desc: 'PI confidence, delivery %, BV attainment, major risks, decisions needed.',
    group: 'Exec',
  },
  // ── Sprint Closure ─────────────────────────────────────────────────────────
  {
    id: 'sprint-close',
    label: 'Sprint Close',
    icon: '✅',
    roles: ['rte', 'sm', 'pm', 'all', 'admin'],
    desc: 'Sprint summary: features done/WIP, open defects, top teams by delivery.',
    group: 'Sprint',
  },
  // ── Scope Change ──────────────────────────────────────────────────────────
  {
    id: 'scope-change',
    label: 'Scope Change Report',
    icon: '🔄',
    roles: ['rte', 'pm', 'all', 'admin'],
    desc: 'Scope delta vs a baseline snapshot: added, removed, estimate changes, sprint moves.',
    group: 'Scope',
  },
  // ── Data Export ───────────────────────────────────────────────────────────
  {
    id: 'excel',
    label: 'Excel Data Export',
    icon: '📑',
    roles: ['all', 'admin', 'pm', 'rte', 'sm'],
    desc: 'Multi-sheet Excel: Features, Defects, Risks, Objectives. Raw data for analysis.',
    group: 'Export',
  },
];

const SPRINT_LABELS_FALLBACK = ['S1', 'S2', 'S3', 'S4', 'IP'];

const ROLES = [
  { value: 'all',   label: '👥 All Roles' },
  { value: 'rte',   label: '🚄 RTE / Release Train Engineer' },
  { value: 'pm',    label: '📦 Product Manager' },
  { value: 'po',    label: '📋 Product Owner' },
  { value: 'sm',    label: '🏃 Scrum Master' },
  { value: 'em',    label: '🏗️ Engineering Manager' },
  { value: 'qa',    label: '🔬 QA Lead' },
  { value: 'exec',  label: '📊 Leadership / Executive' },
  { value: 'admin', label: '⚙️ Admin' },
];

export default function ReportModal({ open, onClose, areaPaths = [] }) {
  const availablePIs       = useStore(s => s.availablePIs);
  const selectedPIs        = useStore(s => s.selectedPIs);
  const teamRootPath       = useStore(s => s.teamRootPath);
  const sprintLabels       = useStore(s => s.sprintLabels) || SPRINT_LABELS_FALLBACK;
  const activeSnapshotId   = useStore(s => s.activeSnapshotId);
  const activeSnapshotLabel = useStore(s => s.activeSnapshotLabel);

  const { role: userRole } = useAuth();

  // Build a sorted, unique list of team paths for the selector.
  const teamOptions = useMemo(() => {
    const set = new Set();
    (teamRootPath || []).forEach(p => p && set.add(p.replace(/\//g, '\\')));
    (areaPaths || []).forEach(p => p && set.add(p.replace(/\//g, '\\')));
    return [...set].sort();
  }, [teamRootPath, areaPaths]);

  function teamLabel(path) {
    const segs = path.replace(/\//g, '\\').split('\\').filter(Boolean);
    return segs[segs.length - 1] || path;
  }

  const [selectedRole, setSelectedRole]     = useState(userRole || 'all');
  const [selectedReport, setSelectedReport] = useState('pi-feature-delivery');
  const [piSelections, setPiSelections]     = useState([]);
  const [teamPath, setTeamPath]             = useState('');
  const [sprint, setSprint]                 = useState('');
  const [generating, setGenerating]         = useState(false);
  const [error, setError]                   = useState('');
  const [previewUrl, setPreviewUrl]         = useState('');   // non-empty = show preview
  const [previewTitle, setPreviewTitle]     = useState('');
  const [iframeLoading, setIframeLoading]   = useState(false);
  const iframeRef                           = useRef(null);

  // Reports visible for the chosen role
  const availableTypes = useMemo(() => {
    if (selectedRole === 'all' || selectedRole === 'admin') return REPORT_TYPES;
    return REPORT_TYPES.filter(t => t.roles.includes(selectedRole));
  }, [selectedRole]);

  // When role changes, keep selection if still valid, otherwise pick first
  useEffect(() => {
    if (!availableTypes.find(t => t.id === selectedReport)) {
      setSelectedReport(availableTypes[0]?.id || 'pi-feature-delivery');
    }
  }, [selectedRole]); // eslint-disable-line react-hooks/exhaustive-deps

  // Init on open
  useEffect(() => {
    if (!open) return;
    setSelectedRole(userRole || 'all');
    setPreviewUrl('');
    const defaults = selectedPIs.length
      ? selectedPIs
      : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);
    setPiSelections(defaults.length ? defaults : availablePIs.map(p => p.label));
    setError('');
    setGenerating(false);
    setTeamPath('');
    const sl = sprintLabels.length >= 2
      ? sprintLabels[sprintLabels.length - 2]
      : sprintLabels[0] || 'S3';
    setSprint(sl);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePI(label) {
    setPiSelections(prev =>
      prev.includes(label) ? prev.filter(p => p !== label) : [...prev, label]
    );
  }

  function buildUrl(reportId, inline = false) {
    if (reportId === 'scope-change') {
      const params = new URLSearchParams();
      if (activeSnapshotId) params.set('snapshotId', activeSnapshotId);
      if (inline) params.set('inline', '1');
      return `/api/scope-change/report?${params.toString()}`;
    }
    const params = new URLSearchParams();
    piSelections.forEach(pi => params.append('pis[]', pi));
    if (teamPath) params.set('teamPath', teamPath);
    if (selectedRole) params.set('role', selectedRole);
    if (reportId === 'sprint-close' && sprint) params.set('sprint', sprint);
    if (inline) params.set('inline', '1');
    return `/api/reports/${reportId}?${params.toString()}`;
  }

  // Create a temporary <a> and click it — reliable download trigger
  function triggerDownload(url) {
    const a = document.createElement('a');
    a.href = url;
    a.setAttribute('download', '');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleGenerate() {
    if (selectedReport === 'scope-change') {
      if (!activeSnapshotId) { setError('No baseline snapshot selected. Set one in the Config panel.'); return; }
      setError('');
      const type = REPORT_TYPES.find(t => t.id === selectedReport);
      setPreviewTitle(`${type?.icon || '📄'} ${type?.label || selectedReport}`);
      setIframeLoading(true);
      setPreviewUrl(buildUrl(selectedReport, true));
      return;
    }
    if (!piSelections.length) { setError('Please select at least one PI.'); return; }
    setError('');

    if (selectedReport === 'excel') {
      triggerDownload(buildUrl(selectedReport, false));
      return;
    }
    // Open inline preview in iframe overlay
    const type = REPORT_TYPES.find(t => t.id === selectedReport);
    setPreviewTitle(`${type?.icon || '📄'} ${type?.label || selectedReport}`);
    setIframeLoading(true);
    setPreviewUrl(buildUrl(selectedReport, true));
  }

  function handleDownload() {
    if (selectedReport === 'scope-change') {
      if (!activeSnapshotId) { setError('No baseline snapshot selected. Set one in the Config panel.'); return; }
      setError('');
      triggerDownload(buildUrl(selectedReport, false));
      return;
    }
    if (!piSelections.length) { setError('Please select at least one PI.'); return; }
    setError('');
    triggerDownload(buildUrl(selectedReport, false));
  }

  function handlePrint() {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.print();
    }
  }

  if (!open) return null;

  const selectedType = REPORT_TYPES.find(t => t.id === selectedReport);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)',
        zIndex: 9500, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--surface, var(--bg-card, #2B2B2B))',
        border: '1px solid var(--border, #454545)',
        width: 'min(780px, 96vw)',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 'var(--radius, 0px)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border, #454545)', flexShrink: 0,
        }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text, #fff)' }}>
            📄 Generate Report
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            style={{ color: 'var(--muted, #adadad)' }}
          >
            ✕ Close
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Role selector */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted2, #9a9a9a)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              View Reports For Role
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ROLES.map(r => (
                <button
                  key={r.value}
                  onClick={() => setSelectedRole(r.value)}
                  style={{
                    padding: '5px 12px',
                    fontSize: 12,
                    border: `1.5px solid ${selectedRole === r.value ? 'var(--primary, #0072db)' : 'var(--border, #454545)'}`,
                    background: selectedRole === r.value
                      ? 'color-mix(in srgb, var(--primary, #0072db) 22%, transparent)'
                      : 'rgba(255,255,255,.04)',
                    color: selectedRole === r.value ? 'var(--primary, #0072db)' : 'var(--muted, #adadad)',
                    borderRadius: 20,
                    cursor: 'pointer',
                    fontWeight: selectedRole === r.value ? 700 : 400,
                    transition: 'all .15s',
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Report type grid — grouped */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted2, #9a9a9a)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Report Type
            </div>
            {(() => {
              const groups = [...new Set(availableTypes.map(t => t.group || 'Other'))];
              return groups.map(group => {
                const groupTypes = availableTypes.filter(t => (t.group || 'Other') === group);
                return (
                  <div key={group} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted2, #9a9a9a)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 5, paddingBottom: 3, borderBottom: '1px solid var(--border, #454545)' }}>
                      {group}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
                      {groupTypes.map(t => {
                        const isSelected = selectedReport === t.id;
                        return (
                          <button
                            key={t.id}
                            onClick={() => setSelectedReport(t.id)}
                            style={{
                              textAlign: 'left',
                              padding: '8px 12px',
                              background: isSelected ? 'color-mix(in srgb, var(--primary, #0072db) 18%, transparent)' : 'rgba(255,255,255,.04)',
                              border: `1.5px solid ${isSelected ? 'var(--primary, #0072db)' : 'var(--border, #454545)'}`,
                              borderRadius: 'var(--radius, 0px)',
                              cursor: 'pointer',
                              color: 'var(--text, #fff)',
                              transition: 'border-color .15s, background .15s',
                            }}
                          >
                            <div style={{ fontSize: 14, marginBottom: 2 }}>{t.icon} <strong style={{ fontSize: 12 }}>{t.label}</strong></div>
                            <div style={{ fontSize: 11, color: 'var(--muted2, #9a9a9a)', lineHeight: 1.4 }}>{t.desc}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>

          {/* PI selector */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted2, #9a9a9a)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Programme Increments
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {availablePIs.map(p => (
                <button
                  key={p.label}
                  className={`btn btn-sm ${piSelections.includes(p.label) ? 'btn-primary' : 'btn-ghost'}`}
                  style={p.isCurrent ? { outline: '1px solid var(--primary, #0072db)' } : {}}
                  onClick={() => togglePI(p.label)}
                >
                  {p.label}{p.isCurrent ? ' ●' : ''}
                </button>
              ))}
              {!availablePIs.length && (
                <span style={{ fontSize: 12, color: 'var(--muted2, #9a9a9a)' }}>No PIs available</span>
              )}
            </div>
          </div>

          {/* Team path — native select, works correctly inside modals */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted2, #9a9a9a)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Team / Area Filter <span style={{ fontStyle: 'italic', textTransform: 'none' }}>(optional)</span>
            </div>
            <select
              className="filter-select"
              style={{ width: '100%', maxWidth: 480 }}
              value={teamPath}
              onChange={e => setTeamPath(e.target.value)}
            >
              <option value="">All Teams</option>
              {teamOptions.map(p => (
                <option key={p} value={p}>{teamLabel(p)}</option>
              ))}
            </select>
          </div>

          {/* Sprint selector (sprint-close only) */}
          {selectedReport === 'sprint-close' && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--muted2, #9a9a9a)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Sprint
              </div>
              <select
                className="filter-select"
                value={sprint}
                onChange={e => setSprint(e.target.value)}
              >
                {sprintLabels.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}

          {/* Snapshot info (scope-change only) */}
          {selectedReport === 'scope-change' && (
            <div style={{ padding: '10px 14px', borderRadius: 6,
              background: activeSnapshotId ? 'var(--violet-bg, rgba(99,102,241,.08))' : 'var(--warning-bg, rgba(234,179,8,.08))',
              border: `1px solid ${activeSnapshotId ? 'var(--violet-bdr, rgba(99,102,241,.3))' : 'var(--warning-bdr, rgba(234,179,8,.3))'}`,
              fontSize: 12, color: 'var(--text)' }}>
              {activeSnapshotId
                ? <><span style={{ color: 'var(--muted)' }}>Baseline snapshot: </span><strong>{activeSnapshotLabel || activeSnapshotId}</strong><br/><span style={{ color: 'var(--muted)', fontSize: 11 }}>Report will compare this snapshot against current TFS scope.</span></>
                : <span style={{ color: 'var(--warning, #d97706)' }}>⚠ No snapshot selected. Open the <strong>Config panel</strong> and select a baseline snapshot first.</span>
              }
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              fontSize: 12, padding: '8px 12px',
              background: 'var(--danger-bg, rgba(235,63,63,.12))',
              border: '1px solid var(--danger-bdr, rgba(235,63,63,.3))',
              color: 'var(--danger, #eb3f3f)',
            }}>
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', borderTop: '1px solid var(--border, #454545)', flexShrink: 0, gap: 8,
        }}>
          <div style={{ fontSize: 11, color: 'var(--muted2, #9a9a9a)' }}>
            {piSelections.length} PI{piSelections.length !== 1 ? 's' : ''} selected
            {selectedType && ` · ${selectedType.icon} ${selectedType.label}`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {selectedReport !== 'excel' && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleDownload}
                title="Download HTML file"
              >
                ⬇ Download
              </button>
            )}
            <button
              className="btn btn-primary btn-sm"
              onClick={handleGenerate}
            >
              {selectedReport === 'excel' ? '📑 Export Excel' : '👁 Preview Report'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Inline Preview Overlay ─────────────────────────────────────────── */}
      {previewUrl && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9600,
          display: 'flex', flexDirection: 'column',
          background: 'rgba(0,0,0,0.92)',
        }}>
          {/* Preview header bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 16px', background: '#1a1a1a',
            borderBottom: '1px solid #333', flexShrink: 0,
          }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#fff', flex: 1 }}>
              {previewTitle}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handlePrint}
              title="Print / Save as PDF"
              style={{ color: '#9ca3af' }}
            >
              🖨 Print / PDF
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleDownload}
              title="Download HTML"
              style={{ color: '#9ca3af' }}
            >
              ⬇ Download
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setPreviewUrl('')}
              style={{ color: '#9ca3af' }}
            >
              ✕ Close Preview
            </button>
          </div>

          {/* iframe + centered loader */}
          <div style={{ flex: 1, position: 'relative', background: '#fff' }}>
            {iframeLoading && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--surface, #1e1e1e)',
                zIndex: 1,
              }}>
                <PageLoader label="Generating report…" />
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={previewUrl}
              title="Report Preview"
              onLoad={() => setIframeLoading(false)}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                border: 'none',
                background: '#fff',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
