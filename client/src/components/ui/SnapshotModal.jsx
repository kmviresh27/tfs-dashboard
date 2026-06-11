import { useState, useEffect } from 'react';
import useStore from '../../store/useStore.js';
import { apiFetch } from '../../api/apiClient.js';

export default function SnapshotModal({ open, onClose }) {
  const availablePIs      = useStore(s => s.availablePIs);
  const selectedPIs       = useStore(s => s.selectedPIs);
  const setActiveSnapshot = useStore(s => s.setActiveSnapshot);

  const [tab, setTab] = useState('capture');

  // ── Capture state ──────────────────────────────────────────────────────────
  const [capturePIs, setCapturePIs]   = useState([]);
  const [label, setLabel]             = useState('Plan Final - Approved');
  const [isRevision, setIsRevision]   = useState(false);
  const [parentId, setParentId]       = useState('');
  const [parents, setParents]         = useState([]);
  const [captureStatus, setCaptureStatus] = useState('');
  const [capturing, setCapturing]     = useState(false);

  // ── Browse state ───────────────────────────────────────────────────────────
  const [snapshots, setSnapshots]         = useState([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browsePI, setBrowsePI]           = useState('');

  // Initialise PI selection when modal opens
  useEffect(() => {
    if (!open) return;
    const defaults = selectedPIs.length
      ? selectedPIs
      : availablePIs.filter(p => p.isPast || p.isCurrent).map(p => p.label);
    setCapturePIs(defaults);
    setCaptureStatus('');
    setIsRevision(false);
    setParentId('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load snapshot browser when the browse tab is active
  useEffect(() => {
    if (open && tab === 'browse') loadSnapshots();
  }, [open, tab, browsePI]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load parent list whenever revision checkbox is toggled on
  useEffect(() => {
    if (isRevision) loadParents();
    else setParents([]);
  }, [isRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSnapshots() {
    setBrowseLoading(true);
    try {
      const qs   = browsePI ? `?pi=${encodeURIComponent(browsePI)}` : '';
      const data = await apiFetch(`/api/snapshots${qs}`);
      setSnapshots(data.snapshots || []);
    } catch {
      setSnapshots([]);
    } finally {
      setBrowseLoading(false);
    }
  }

  async function loadParents() {
    try {
      const data = await apiFetch('/api/snapshots');
      setParents(data.snapshots || []);
    } catch {
      setParents([]);
    }
  }

  function togglePI(piLabel) {
    setCapturePIs(prev =>
      prev.includes(piLabel) ? prev.filter(p => p !== piLabel) : [...prev, piLabel]
    );
  }

  async function handleCapture() {
    if (!capturePIs.length) {
      setCaptureStatus('⚠️ Please select at least one PI.');
      return;
    }
    setCapturing(true);
    setCaptureStatus('⏳ Fetching live TFS data…');
    try {
      const result = await apiFetch('/api/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pis: capturePIs,
          label,
          isRevision,
          parentId: isRevision ? (parentId || null) : null,
        }),
      });
      const s = result.snapshot;
      setCaptureStatus(
        `✅ Captured ${s.featureCount} features, ${s.defectCount} defects, ${s.objectiveCount ?? 0} objectives, ${s.riskCount ?? 0} risks at ${new Date(s.capturedAt).toLocaleString()}`
      );
      setTab('browse');
    } catch (e) {
      setCaptureStatus(`❌ Failed: ${e.message}`);
    } finally {
      setCapturing(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this PI Plan Data entry? This cannot be undone.')) return;
    try {
      await apiFetch(`/api/snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadSnapshots();
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    }
  }

  function handleCompare(id, lbl) {
    setActiveSnapshot(id, lbl);
    onClose();
  }

  if (!open) return null;

  const statusColor = captureStatus.startsWith('✅')
    ? 'var(--success)'
    : captureStatus.startsWith('❌')
      ? 'var(--danger)'
      : 'var(--muted2)';

  return (
    <div
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.72)', zIndex:9500, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', width:'min(680px, 95vw)', maxHeight:'85vh', display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <span style={{ fontWeight:700, fontSize:14, color:'var(--text)', display:'flex', alignItems:'center', gap:6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            PI Plan Data — Snapshots
          </span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕ Close</button>
        </div>

        {/* Tab bar */}
        <div style={{ display:'flex', gap:4, padding:'10px 16px 0', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          {[['capture', 'Capture'], ['browse', 'Browse']].map(([id, lbl]) => (
            <button
              key={id}
              className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab(id)}
            >
              {lbl}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ overflowY:'auto', flex:1, padding:16 }}>

          {/* ── CAPTURE TAB ─────────────────────────────────────────────────── */}
          {tab === 'capture' && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

              {/* PI selector */}
              <div>
                <div style={{ fontSize:12, color:'var(--muted2)', marginBottom:6 }}>Select PIs to capture:</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  {availablePIs.map(p => (
                    <button
                      key={p.label}
                      className={`btn btn-sm ${capturePIs.includes(p.label) ? 'btn-primary' : 'btn-ghost'}`}
                      style={p.isCurrent ? { outline:'1px solid var(--primary)' } : {}}
                      onClick={() => togglePI(p.label)}
                    >
                      {p.label}{p.isCurrent ? ' ●' : ''}
                    </button>
                  ))}
                </div>
              </div>

              {/* Label */}
              <div>
                <div style={{ fontSize:12, color:'var(--muted2)', marginBottom:4 }}>Label:</div>
                <input
                  className="search-input"
                  style={{ width:'100%', boxSizing:'border-box' }}
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  placeholder="e.g. Plan Final - Approved"
                />
              </div>

              {/* Revision */}
              <div>
                <label style={{ fontSize:12, color:'var(--muted2)', display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                  <input
                    type="checkbox"
                    checked={isRevision}
                    onChange={e => setIsRevision(e.target.checked)}
                  />
                  Is Revision (links to a parent snapshot)
                </label>
                {isRevision && (
                  <div style={{ marginTop:8 }}>
                    <div style={{ fontSize:12, color:'var(--muted2)', marginBottom:4 }}>Parent Snapshot:</div>
                    <select
                      className="filter-select"
                      style={{ width:'100%' }}
                      value={parentId}
                      onChange={e => setParentId(e.target.value)}
                    >
                      <option value="">Select parent…</option>
                      {parents.map(s => (
                        <option key={s.id} value={s.id}>
                          {(s.pis || []).join(', ')} · {s.label} ({new Date(s.capturedAt).toLocaleDateString()})
                        </option>
                      ))}
                      {parents.length === 0 && <option disabled>No snapshots yet</option>}
                    </select>
                  </div>
                )}
              </div>

              {/* Status */}
              {captureStatus && (
                <div style={{ fontSize:12, padding:'8px 12px', background:'rgba(255,255,255,.06)', color: statusColor }}>
                  {captureStatus}
                </div>
              )}

              <button
                className="btn btn-primary"
                disabled={capturing}
                onClick={handleCapture}
                style={{ alignSelf:'flex-start' }}
              >
                {capturing ? 'Capturing…' : 'Capture Now'}
              </button>
            </div>
          )}

          {/* ── BROWSE TAB ──────────────────────────────────────────────────── */}
          {tab === 'browse' && (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

              {/* PI filter */}
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:12, color:'var(--muted2)' }}>Filter by PI:</span>
                <select className="filter-select" value={browsePI} onChange={e => setBrowsePI(e.target.value)}>
                  <option value="">All PIs</option>
                  {availablePIs.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
                </select>
              </div>

              {/* Snapshot list */}
              {browseLoading ? (
                <div style={{ color:'var(--muted2)', padding:16 }}>Loading…</div>
              ) : snapshots.length === 0 ? (
                <div style={{ color:'var(--muted2)', padding:16, textAlign:'center' }}>
                  No PI Plan Data yet. Use the Capture tab to create one.
                </div>
              ) : (
                snapshots.map(s => (
                  <div
                    key={s.id}
                    style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 12px', background:'rgba(255,255,255,.04)', border:'1px solid var(--border)' }}
                  >
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:600, fontSize:13, marginBottom:4 }}>
                        {s.isRevision && (
                          <span style={{ fontSize:10, background:'#1492ff33', color:'#1492ff', padding:'1px 6px', marginRight:6 }}>
                            Revision
                          </span>
                        )}
                        {s.label}
                      </div>
                      <div style={{ fontSize:11, color:'var(--muted2)', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                        <span style={{ background:'rgba(255,255,255,.1)', padding:'1px 6px' }}>
                          {(s.pis || []).join(', ')}
                        </span>
                        <span>{s.featureCount} features</span>
                        <span>{s.defectCount} defects</span>
                        {s.objectiveCount > 0 && <span>{s.objectiveCount} objectives</span>}
                        {s.riskCount      > 0 && <span>{s.riskCount} risks</span>}
                        {s.storyCount     > 0 && <span>{s.storyCount} stories</span>}
                        {s.piCheckIssues  > 0 && <span style={{color:'#ff7f0f'}}>{s.piCheckIssues} PI issues</span>}
                        {s.depBlockedCount > 0 && <span style={{color:'#eb3f3f'}}>{s.depBlockedCount} blocked deps</span>}
                        <span>{new Date(s.capturedAt).toLocaleString()}</span>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:6, flexShrink:0, marginLeft:12 }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => handleCompare(s.id, s.label)}>
                        Compare
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        style={{ color:'var(--danger)' }}
                        onClick={() => handleDelete(s.id)}
                        title="Delete snapshot"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
