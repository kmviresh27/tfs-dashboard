import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../api/apiClient.js';

const COLORS = [
  { id: '#F5CC00', label: '🟡 Note' },
  { id: '#1492ff', label: '🔵 Info' },
  { id: '#068443', label: '🟢 Good' },
  { id: '#ef4444', label: '🔴 Issue' },
  { id: '#a855f7', label: '🟣 Event' },
];

export function AnnotationButton({ onClick, title = 'Add note' }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ fontSize: 12, padding: '2px 7px', background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer' }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    </button>
  );
}

/**
 * Generates chartjs-plugin-annotation config for vertical sprint lines.
 * Each annotation is clickable — clicking calls onDelete(id).
 */
export function buildAnnotationLines(annotations = [], labels = [], onDelete, chartId = '') {
  const result = {};
  annotations.forEach(a => {
    if (chartId && a.chartId && a.chartId !== chartId) return;
    if (!labels.includes(a.sprint)) return;
    result[`ann_${a.id}`] = {
      type: 'line',
      xMin: a.sprint,
      xMax: a.sprint,
      borderColor: a.color,
      borderWidth: 2,
      borderDash: [5, 4],
      label: {
        display: true,
        content: `${a.text}  ✕`,
        color: '#ffffff',
        backgroundColor: 'rgba(10,10,10,0.85)',
        borderColor: a.color,
        borderWidth: 1,
        borderRadius: 3,
        font: { size: 10, weight: 'bold' },
        position: 'end',
        padding: { x: 7, y: 4 },
        yAdjust: -4,
      },
      click: onDelete ? (ctx, event) => {
        if (ctx.element?.label?.inRange(event?.x ?? 0, event?.y ?? 0)) {
          onDelete(a.id);
        }
      } : undefined,
      enter: ctx => { ctx.chart.canvas.style.cursor = 'pointer'; },
      leave: ctx => { ctx.chart.canvas.style.cursor = 'default'; },
    };
  });
  return result;
}

/**
 * ChartAnnotations — popup-only component for adding chart notes.
 * Annotations are displayed directly on charts via buildAnnotationLines().
 *
 * Props:
 *   section  — e.g. 'velocity', 'pi-delivery'
 *   pi       — currently selected PI label
 *   team     — currently selected team path
 *   sprints  — array of sprint labels for the dropdown
 *   open     — controlled open state (required)
 *   setOpen  — controlled setter (required)
 */
export default function ChartAnnotations({ section, chartId = '', pi, team, sprints = [], open, setOpen, items = [], onDelete }) {
  const qc = useQueryClient();
  const [form,   setForm]   = useState({ sprint: '', text: '', color: '#F5CC00' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({ sprint: sprints[0] || '', text: '', color: '#F5CC00' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd(e) {
    e.preventDefault();
    if (!form.sprint || !form.text.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/api/annotations', {
        method: 'POST',
        body: JSON.stringify({ section, chartId, pi, team, sprint: form.sprint, text: form.text.trim(), color: form.color }),
      });
      qc.invalidateQueries({ queryKey: ['annotations', section] });
      setOpen(false);
    } finally { setSaving(false); }
  }

  const filteredItems = items.filter(item => !item.chartId || !chartId || item.chartId === chartId);

  if (!open) return null;

  return (
    <div onClick={() => setOpen(false)} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--surface-1)', border: '1px solid var(--border)',
        width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>📝 Add Chart Note</span>
          <button onClick={() => setOpen(false)} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--muted)', fontSize: 18, lineHeight: 1,
          }}>✕</button>
        </div>

        {/* Form */}
        <form onSubmit={handleAdd} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Sprint / X-axis point</label>
            {sprints.length > 0 ? (
              <select value={form.sprint} onChange={e => setForm(v => ({ ...v, sprint: e.target.value }))}
                style={{ width: '100%', fontSize: 12, padding: '7px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {sprints.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input type="text" value={form.sprint} placeholder="e.g. S1, S2…"
                onChange={e => setForm(v => ({ ...v, sprint: e.target.value }))}
                style={{ width: '100%', fontSize: 12, padding: '7px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', boxSizing: 'border-box' }}
              />
            )}
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Note</label>
            <input type="text" value={form.text} placeholder="What happened at this sprint?"
              onChange={e => setForm(v => ({ ...v, text: e.target.value }))}
              style={{ width: '100%', fontSize: 12, padding: '7px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', boxSizing: 'border-box' }}
              autoFocus
            />
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Type</label>
            <select value={form.color} onChange={e => setForm(v => ({ ...v, color: e.target.value }))}
              style={{ width: '100%', fontSize: 12, padding: '7px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
              {COLORS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>

          <div style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'italic' }}>
            💡 Click the annotation label on the chart to remove it
          </div>

          {filteredItems.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>Existing notes</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 160, overflowY: 'auto' }}>
                {filteredItems.map(item => (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '7px 9px' }}>
                    <span style={{ width: 8, height: 8, background: item.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.text}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{item.sprint || 'Free-text note'}</div>
                    </div>
                    {onDelete && (
                      <button type="button" onClick={() => onDelete(item.id)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', fontSize: 10, padding: '3px 7px' }}>
                        Delete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setOpen(false)}
              style={{ padding: '7px 18px', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer', fontSize: 12 }}>
              Cancel
            </button>
            <button type="submit" disabled={saving || !form.sprint || !form.text.trim()}
              style={{ padding: '7px 20px', background: '#1492ff', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

