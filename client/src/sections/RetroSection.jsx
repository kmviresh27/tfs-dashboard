import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import useStore from '../store/useStore.js';
import { useRetroActions } from '../api/hooks.js';
import { apiFetch } from '../api/apiClient.js';
import { PageLoader } from '../components/ui/PageLoader.jsx';

const CATEGORIES = [
  { id: 'process',  label: '⚙️ Process',  color: '#1492ff' },
  { id: 'tech',     label: '🔧 Tech',      color: '#a855f7' },
  { id: 'people',   label: '👥 People',    color: '#10b981' },
  { id: 'quality',  label: '🛡 Quality',   color: '#f59e0b' },
  { id: 'other',    label: '📌 Other',     color: '#94a3b8' },
];

const STATUSES = [
  { id: 'open',        label: '🔴 Open',        color: '#ef4444' },
  { id: 'in-progress', label: '🟡 In Progress', color: '#f59e0b' },
  { id: 'done',        label: '🟢 Done',        color: '#068443' },
  { id: 'dropped',     label: '⚫ Dropped',     color: '#757575' },
];

function catColor(cat) { return CATEGORIES.find(c => c.id === cat)?.color || '#94a3b8'; }
function statColor(st) { return STATUSES.find(s => s.id === st)?.color || '#94a3b8'; }
function statLabel(st) { return STATUSES.find(s => s.id === st)?.label || st; }

const EMPTY_FORM = { title: '', owner: '', sprint: '', pi: '', team: '', category: 'process', dueDate: '', notes: '', status: 'open' };

export default function RetroSection() {
  const qc          = useQueryClient();
  const selectedPIs = useStore(s => s.selectedPIs);
  const currentPI   = useStore(s => s.currentPI);
  const selectedTeam = useStore(s => s.selectedTeam);

  const pi   = selectedPIs[0] || currentPI || '';
  const team = selectedTeam || '';

  const { data, isLoading, error } = useRetroActions(pi, team);
  const items = data?.items || [];

  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCat,    setFilterCat]    = useState('all');
  const [showModal,    setShowModal]    = useState(false);
  const [editing,      setEditing]      = useState(null);  // item being edited
  const [form,         setForm]         = useState(EMPTY_FORM);
  const [saving,       setSaving]       = useState(false);

  const filtered = useMemo(() => {
    let r = items;
    if (filterStatus !== 'all') r = r.filter(i => i.status === filterStatus);
    if (filterCat    !== 'all') r = r.filter(i => i.category === filterCat);
    return r;
  }, [items, filterStatus, filterCat]);

  // Stats
  const stats = useMemo(() => {
    const open   = items.filter(i => i.status === 'open').length;
    const inProg = items.filter(i => i.status === 'in-progress').length;
    const done   = items.filter(i => i.status === 'done').length;
    const overdue = items.filter(i => {
      if (!i.dueDate || i.status === 'done' || i.status === 'dropped') return false;
      return new Date(i.dueDate) < new Date();
    }).length;
    const closePct = items.length ? Math.round((done / items.length) * 100) : 0;
    return { total: items.length, open, inProg, done, overdue, closePct };
  }, [items]);

  // Close-rate trend (by sprint)
  const sprintTrend = useMemo(() => {
    const byS = {};
    items.forEach(i => {
      const s = i.sprint || 'Unknown';
      if (!byS[s]) byS[s] = { sprint: s, total: 0, done: 0 };
      byS[s].total++;
      if (i.status === 'done') byS[s].done++;
    });
    return Object.values(byS).sort((a, b) => a.sprint.localeCompare(b.sprint));
  }, [items]);

  function openAdd() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, pi, sprint: '', team: selectedTeam || '' });
    setShowModal(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      title: item.title, owner: item.owner || '', sprint: item.sprint || '',
      pi: item.pi || pi, team: item.team || '', category: item.category || 'process',
      dueDate: item.dueDate || '', notes: item.notes || '', status: item.status,
    });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await apiFetch(`/api/retro/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) });
      } else {
        await apiFetch('/api/retro', { method: 'POST', body: JSON.stringify(form) });
      }
      qc.invalidateQueries({ queryKey: ['retro'] });
      setShowModal(false);
    } finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this action item?')) return;
    await apiFetch(`/api/retro/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['retro'] });
  }

  async function cycleStatus(item) {
    const order = ['open', 'in-progress', 'done', 'open'];
    const next  = order[order.indexOf(item.status) + 1] || 'open';
    await apiFetch(`/api/retro/${item.id}`, {
      method: 'PUT', body: JSON.stringify({ status: next }),
    });
    qc.invalidateQueries({ queryKey: ['retro'] });
  }

  if (isLoading) return <PageLoader />;
  if (error) return <div style={{ padding: 24, color: '#ef4444' }}>Error: {error.message}</div>;

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 18 }}>🔁 Retro Action Items</span>
        {pi && <span style={{ fontSize: 11, padding: '2px 8px', background: '#1492ff22', color: '#1492ff', borderRadius: 10 }}>{pi}</span>}
        <button onClick={openAdd} style={{
          marginLeft: 'auto', padding: '6px 16px', background: '#1492ff', color: '#fff',
          border: 'none', borderRadius: 0, cursor: 'pointer', fontWeight: 600, fontSize: 12,
        }}>+ Add Action</button>
      </div>

      {/* ── Stats strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Total',      value: stats.total,    color: '#94a3b8' },
          { label: '🔴 Open',    value: stats.open,     color: '#ef4444' },
          { label: '🟡 In Prog', value: stats.inProg,   color: '#f59e0b' },
          { label: '🟢 Done',    value: stats.done,     color: '#068443' },
          { label: '⚠ Overdue', value: stats.overdue,  color: '#ff7f0f' },
        ].map(s => (
          <div key={s.label} style={{
            background: 'var(--surface2)', border: `1px solid ${s.color}33`,
            borderTop: `3px solid ${s.color}`, padding: '12px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Close Rate Trend ── */}
      {sprintTrend.length > 0 && (
        <div style={{ marginBottom: 20, background: 'var(--surface)', border: '1px solid var(--border)', padding: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10 }}>📈 Close Rate by Sprint</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            {sprintTrend.map(s => {
              const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
              return (
                <div key={s.sprint} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#068443', marginBottom: 2 }}>{pct}%</div>
                  <div style={{
                    height: Math.max(4, (pct / 100) * 60), background: '#06844366',
                    borderTop: '2px solid #068443', borderRadius: '2px 2px 0 0',
                  }} />
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 3 }}>{s.sprint}</div>
                  <div style={{ fontSize: 9, color: 'var(--muted)' }}>{s.done}/{s.total}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Filter:</span>
        {['all', ...STATUSES.map(s => s.id)].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} style={{
            padding: '3px 10px', fontSize: 11, border: '1px solid var(--border)',
            background: filterStatus === s ? '#1492ff' : 'var(--surface2)',
            color: filterStatus === s ? '#fff' : 'var(--text)',
            cursor: 'pointer', borderRadius: 0,
          }}>{s === 'all' ? 'All' : statLabel(s)}</button>
        ))}
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>Category:</span>
        {['all', ...CATEGORIES.map(c => c.id)].map(c => (
          <button key={c} onClick={() => setFilterCat(c)} style={{
            padding: '3px 10px', fontSize: 11, border: '1px solid var(--border)',
            background: filterCat === c ? '#1492ff' : 'var(--surface2)',
            color: filterCat === c ? '#fff' : 'var(--text)',
            cursor: 'pointer', borderRadius: 0,
          }}>{c === 'all' ? 'All' : CATEGORIES.find(x => x.id === c)?.label || c}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>{filtered.length} items</span>
      </div>

      {/* ── Table ── */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--surface2)' }}>
              {['Status', 'Category', 'Action Item', 'Owner', 'Sprint', 'Due', 'PI', 'Notes', ''].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                No action items found. Click "+ Add Action" to create one.
              </td></tr>
            ) : filtered.map(item => (
              <tr key={item.id} style={{ borderBottom: '1px solid var(--border)', background: item.status === 'done' ? 'rgba(6,132,67,0.04)' : 'transparent' }}>
                <td style={{ padding: '8px 10px' }}>
                  <button onClick={() => cycleStatus(item)} style={{
                    padding: '2px 8px', fontSize: 10, borderRadius: 10, border: `1px solid ${statColor(item.status)}44`,
                    background: `${statColor(item.status)}22`, color: statColor(item.status), cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }} title="Click to cycle status">{statLabel(item.status)}</button>
                </td>
                <td style={{ padding: '8px 10px' }}>
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 10, background: `${catColor(item.category)}22`, color: catColor(item.category) }}>
                    {CATEGORIES.find(c => c.id === item.category)?.label || item.category}
                  </span>
                </td>
                <td style={{ padding: '8px 10px', maxWidth: 260 }}>
                  <div style={{ fontWeight: 600, color: item.status === 'done' ? 'var(--muted)' : 'var(--text)', textDecoration: item.status === 'done' ? 'line-through' : 'none' }}>{item.title}</div>
                  {item.team && <div style={{ fontSize: 10, color: 'var(--muted)' }}>👥 {item.team}</div>}
                </td>
                <td style={{ padding: '8px 10px', color: 'var(--muted)', fontSize: 11 }}>{item.owner || '—'}</td>
                <td style={{ padding: '8px 10px', color: 'var(--muted)', fontSize: 11 }}>{item.sprint || '—'}</td>
                <td style={{ padding: '8px 10px', fontSize: 11 }}>
                  {item.dueDate ? (
                    <span style={{ color: (item.status !== 'done' && item.status !== 'dropped' && new Date(item.dueDate) < new Date()) ? '#ef4444' : 'var(--muted)' }}>
                      {item.dueDate}
                    </span>
                  ) : '—'}
                </td>
                <td style={{ padding: '8px 10px', color: 'var(--muted)', fontSize: 11 }}>{item.pi || '—'}</td>
                <td style={{ padding: '8px 10px', color: 'var(--muted)', fontSize: 11, maxWidth: 160 }}>
                  <span title={item.notes}>{(item.notes || '').length > 40 ? item.notes.slice(0, 40) + '…' : (item.notes || '—')}</span>
                </td>
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                  <button onClick={() => openEdit(item)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 12, padding: '0 4px' }} title="Edit">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 12, padding: '0 4px' }} title="Delete">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Add/Edit Modal ── */}
      {showModal && (
        <div onClick={() => setShowModal(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            padding: 24, width: 520, maxWidth: '95vw', maxHeight: '90vh',
            overflowY: 'auto', borderRadius: 0,
          }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 18 }}>
              {editing ? '✏️ Edit Action Item' : '➕ New Action Item'}
            </div>

            {[
              { key: 'title',  label: 'Action Item *',   type: 'text',   placeholder: 'Describe the action...' },
              { key: 'owner',  label: 'Owner',           type: 'text',   placeholder: 'Person responsible' },
              { key: 'sprint', label: 'Sprint',          type: 'text',   placeholder: 'e.g. 26-PI2 S1' },
              { key: 'pi',     label: 'PI',              type: 'text',   placeholder: 'e.g. 26-PI2' },
              { key: 'team',   label: 'Team',            type: 'text',   placeholder: 'Team name' },
              { key: 'dueDate',label: 'Due Date',        type: 'date',   placeholder: '' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{f.label}</label>
                <input
                  type={f.type} value={form[f.key]} placeholder={f.placeholder}
                  onChange={e => setForm(v => ({ ...v, [f.key]: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 0, fontSize: 12, boxSizing: 'border-box' }}
                />
              </div>
            ))}

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Category</label>
              <select value={form.category} onChange={e => setForm(v => ({ ...v, category: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 0, fontSize: 12 }}>
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>

            {editing && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Status</label>
                <select value={form.status} onChange={e => setForm(v => ({ ...v, status: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 0, fontSize: 12 }}>
                  {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Notes</label>
              <textarea value={form.notes} rows={3} placeholder="Additional context..."
                onChange={e => setForm(v => ({ ...v, notes: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 0, fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '7px 18px', background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', borderRadius: 0 }}>Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.title.trim()} style={{ padding: '7px 18px', background: '#1492ff', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: 0, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Saving…' : (editing ? 'Save Changes' : 'Add Action')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
