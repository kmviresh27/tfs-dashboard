import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import useStore from '../../store/useStore.js';
import { apiFetch } from '../../api/apiClient.js';
import { useConfig } from '../../api/hooks.js';
import { NAV_ITEMS, ROLE_DEFS, ROLE_SECTIONS } from '../../constants.js';

const BUILT_IN_IDS = Object.keys(ROLE_DEFS);
const ALL_SECTION_IDS = NAV_ITEMS.map(n => n.id);
const ICON_OPTIONS = ['🔓','👔','🚂','📋','🏃','🔬','🧪','👁','🎯','💼','🛠','👤','🌐','📊','🏅','🧑‍💻','📌','🔑','🏆','🎖'];

// ── Info callout pointing users to Visibility Policies ────────────────────
function VisibilityNote() {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '12px 14px', background: 'rgba(20,146,255,0.07)',
      border: '1px solid rgba(20,146,255,0.2)', borderRadius: 0,
    }}>
      <span style={{ fontSize: 18, lineHeight: 1.2 }}>🔒</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary-light)', marginBottom: 2 }}>
          Section &amp; chart visibility is controlled in Visibility Policies
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          Use the <strong style={{ color: 'var(--text)' }}>Visibility Policies</strong> panel below to show or hide
          specific sections, tabs, and charts for this role.
        </div>
      </div>
    </div>
  );
}

export default function RolesManager() {
  const queryClient  = useQueryClient();
  const store            = useStore(s => s);
  const setCustomRoles   = store.setCustomRoles;
  const setRoleOverrides = store.setRoleOverrides;

  const { data: configData } = useConfig();

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  // Draft state — synced once from server config on first load
  const [draftOverrides, setDraftOverrides] = useState({ ...ROLE_SECTIONS });
  const [draftCustom, setDraftCustom]       = useState([]);
  const [configSynced, setConfigSynced]     = useState(false);

  // Sync drafts from server config once it arrives (not from store, to avoid timing issues)
  useEffect(() => {
    if (!configSynced && configData) {
      const saved = configData.roles || {};
      setDraftCustom((saved.custom || []).map(r => ({ ...r })));
      setDraftOverrides({ ...ROLE_SECTIONS, ...(saved.overrides || {}) });
      setConfigSynced(true);
    }
  }, [configData, configSynced]);

  // selection state
  const [selectedId, setSelectedId] = useState(BUILT_IN_IDS[0]);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newRole, setNewRole]   = useState({ id: '', label: '', icon: '🎯' });
  const [newError, setNewError] = useState('');

  // ── helpers ────────────────────────────────────────────────────────────
  const allRoleItems = [
    ...BUILT_IN_IDS.map(id => ({ ...ROLE_DEFS[id], id, isBuiltIn: true })),
    ...draftCustom.map(r => ({ ...r, isBuiltIn: false })),
  ];

  const selectedRole   = allRoleItems.find(r => r.id === selectedId);
  const isBuiltIn      = selectedRole?.isBuiltIn;
  const currentSections = isBuiltIn
    ? (draftOverrides[selectedId] || ROLE_SECTIONS[selectedId] || [])
    : (draftCustom.find(r => r.id === selectedId)?.sections || []);
  const defaultSections = isBuiltIn ? (ROLE_SECTIONS[selectedId] || []) : [];
  const isModified = isBuiltIn
    && JSON.stringify(currentSections.slice().sort()) !== JSON.stringify(defaultSections.slice().sort());

  const persistRoles = async (customList) => {
    setSaving(true); setStatus('');
    const overridesPayload = {};
    BUILT_IN_IDS.forEach(id => {
      const def = ROLE_SECTIONS[id] || [];
      const dr  = draftOverrides[id] || [];
      if (dr.length !== def.length || dr.some(s => !def.includes(s))) overridesPayload[id] = dr;
    });
    try {
      await apiFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: { custom: customList, overrides: overridesPayload } }),
      });
      setCustomRoles(customList);
      setRoleOverrides(overridesPayload);
      queryClient.invalidateQueries({ predicate: q => q.queryKey.includes('config') });
      setStatus('saved');
      setTimeout(() => setStatus(''), 2000);
    } catch (e) {
      setStatus('err:' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRole = async () => {
    setNewError('');
    const id = newRole.id.trim().toLowerCase().replace(/\s+/g, '-');
    if (!id)                    return setNewError('Role ID is required');
    if (!newRole.label.trim())  return setNewError('Display name is required');
    if ([...BUILT_IN_IDS, ...draftCustom.map(r => r.id)].includes(id))
                                return setNewError(`ID "${id}" already exists`);
    const added = { id, label: newRole.label.trim(), icon: newRole.icon, sections: ALL_SECTION_IDS };
    const next = [...draftCustom, added];
    setDraftCustom(next);
    setNewRole({ id: '', label: '', icon: '🎯' });
    setIsAddingNew(false);
    setSelectedId(id);
    await persistRoles(next);
  };

  const handleDeleteCustom = async (id) => {
    const next = draftCustom.filter(r => r.id !== id);
    setDraftCustom(next);
    setSelectedId(BUILT_IN_IDS[0]);
    await persistRoles(next);
  };

  const updateCustomSections = (sections) => {
    setDraftCustom(prev => prev.map(r => r.id === selectedId ? { ...r, sections } : r));
  };

  const updateCustomMeta = (field, value) => {
    setDraftCustom(prev => prev.map(r => r.id === selectedId ? { ...r, [field]: value } : r));
  };

  const handleCustomMetaBlur = async () => {
    await persistRoles(draftCustom);
  };

  // ── styles ─────────────────────────────────────────────────────────────
  const listItemStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
    borderRadius: 0, cursor: 'pointer', transition: 'background 0.12s',
    background: active ? 'rgba(20,146,255,0.12)' : 'transparent',
    border: `1.5px solid ${active ? 'var(--primary)' : 'transparent'}`,
    marginBottom: 2,
  });

  return (
    <div style={{ display: 'flex', gap: 0, minHeight: 420, overflow: 'hidden' }}>

      {/* ── Left: Role list ─────────────────────────────────────────── */}
      <div style={{
        width: 220, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', padding: '12px 8px',
      }}>
        {/* Built-in group */}
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
          letterSpacing: '0.07em', padding: '2px 12px 6px' }}>Built-in</div>
        {BUILT_IN_IDS.map(id => {
          const def = ROLE_DEFS[id];
          const ovSections = draftOverrides[id] || ROLE_SECTIONS[id] || [];
          const modified = JSON.stringify(ovSections.slice().sort()) !== JSON.stringify((ROLE_SECTIONS[id]||[]).slice().sort());
          return (
            <button key={id} type="button"
              style={listItemStyle(!isAddingNew && selectedId === id)}
              onClick={() => { setSelectedId(id); setIsAddingNew(false); }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>{def.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{def.label}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{ovSections.length} sections</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: 'var(--muted)', opacity: 0.5 }}>🔒</span>
                {modified && <span style={{ fontSize: 9, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', padding: '1px 4px', borderRadius: 0 }}>edited</span>}
              </div>
            </button>
          );
        })}

        {/* Custom group */}
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
          letterSpacing: '0.07em', padding: '10px 12px 6px', marginTop: 4, borderTop: '1px solid var(--border)' }}>Custom</div>
        {draftCustom.length === 0 && !isAddingNew && (
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '4px 12px', opacity: 0.7 }}>None yet</div>
        )}
        {draftCustom.map(r => (
          <button key={r.id} type="button"
            style={listItemStyle(!isAddingNew && selectedId === r.id)}
            onClick={() => { setSelectedId(r.id); setIsAddingNew(false); }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>{r.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{(r.sections||[]).length} sections</div>
            </div>
          </button>
        ))}
        {isAddingNew && (
          <button type="button"
            style={{ ...listItemStyle(true), borderColor: 'var(--primary)', background: 'rgba(20,146,255,0.08)' }}>
            <span style={{ fontSize: 18 }}>{newRole.icon}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary-light)' }}>{newRole.label || 'New Role'}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>unsaved</div>
            </div>
          </button>
        )}

        {/* Add button */}
        <button type="button"
          onClick={() => { setIsAddingNew(true); setNewError(''); setNewRole({ id: '', label: '', icon: '🎯', sections: [] }); }}
          style={{
            marginTop: 'auto', padding: '8px 12px', borderRadius: 0, cursor: 'pointer',
            border: '1.5px dashed var(--border)', background: 'transparent',
            color: 'var(--primary-light)', fontSize: 12, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
          }}>
          <span>＋</span> Add Role
        </button>
      </div>

      {/* ── Right: Editor pane ──────────────────────────────────────── */}
      <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── NEW ROLE form ─────────────────────────────────────────── */}
        {isAddingNew && (
          <>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Create New Role</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Define a custom role. Configure its visibility in the policies panel below.</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <label className="form-label">Role ID <span style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 400 }}>(slug, no spaces)</span>
                <input className="form-input" placeholder="e.g. rd-leader"
                  value={newRole.id} onChange={e => setNewRole(p => ({ ...p, id: e.target.value }))} />
              </label>
              <label className="form-label">Display Name
                <input className="form-input" placeholder="e.g. R&D Leader"
                  value={newRole.label} onChange={e => setNewRole(p => ({ ...p, label: e.target.value }))} />
              </label>
            </div>
            <label className="form-label" style={{ maxWidth: 240 }}>Icon
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {ICON_OPTIONS.map(ic => (
                  <button key={ic} type="button" onClick={() => setNewRole(p => ({ ...p, icon: ic }))}
                    style={{
                      width: 36, height: 36, fontSize: 18, borderRadius: 0, cursor: 'pointer',
                      border: `2px solid ${newRole.icon === ic ? 'var(--primary)' : 'var(--border)'}`,
                      background: newRole.icon === ic ? 'rgba(20,146,255,0.12)' : 'var(--surface-2)',
                    }}>{ic}</button>
                ))}
              </div>
            </label>
            <VisibilityNote />
            {newError && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{newError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" type="button" onClick={handleCreateRole}>Create Role</button>
              <button className="btn btn-ghost" type="button" onClick={() => { setIsAddingNew(false); }}>Cancel</button>
            </div>
          </>
        )}

        {/* ── BUILT-IN role editor ──────────────────────────────────── */}
        {!isAddingNew && selectedRole && isBuiltIn && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 40 }}>{selectedRole.icon}</span>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{selectedRole.label}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  <code style={{ fontSize: 11, background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 0, color: 'var(--muted)' }}>{selectedRole.id}</code>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>🔒 Built-in · cannot rename or delete</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(ROLE_SECTIONS[selectedRole.id] || []).map(sid => {
                const item = NAV_ITEMS.find(n => n.id === sid);
                return item ? (
                  <span key={sid} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                    fontSize: 11, fontWeight: 600, background: 'rgba(20,146,255,0.08)',
                    border: '1px solid rgba(20,146,255,0.2)', color: 'var(--primary-light)',
                  }}>
                    {item.icon} {item.label}
                  </span>
                ) : null;
              })}
            </div>
            <VisibilityNote />
          </>
        )}

        {/* ── CUSTOM role editor ────────────────────────────────────── */}
        {!isAddingNew && selectedRole && !isBuiltIn && (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 40 }}>{selectedRole.icon}</span>
                <select
                  value={selectedRole.icon}
                  onChange={e => { updateCustomMeta('icon', e.target.value); }}
                  onBlur={handleCustomMetaBlur}
                  style={{ fontSize: 18, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 0, padding: '2px 4px', color: 'var(--text)', cursor: 'pointer', width: 56, textAlign: 'center' }}>
                  {ICON_OPTIONS.map(ic => <option key={ic} value={ic}>{ic}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <input
                  className="form-input"
                  value={selectedRole.label}
                  onChange={e => updateCustomMeta('label', e.target.value)}
                  onBlur={handleCustomMetaBlur}
                  style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  <code style={{ fontSize: 11, background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 0, color: 'var(--muted)' }}>{selectedRole.id}</code>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Custom role</span>
                  {saving && <span style={{ fontSize: 11, color: 'var(--muted)' }}>⏳ Saving…</span>}
                  {status === 'saved' && <span style={{ fontSize: 11, color: 'var(--success)' }}>✅ Saved</span>}
                  {status.startsWith('err:') && <span style={{ fontSize: 11, color: 'var(--danger)' }}>❌ {status.slice(4)}</span>}
                </div>
              </div>
              <button type="button"
                onClick={() => handleDeleteCustom(selectedId)}
                style={{
                  padding: '6px 12px', borderRadius: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  border: '1.5px solid var(--danger)', background: 'transparent', color: 'var(--danger)',
                }}>
                Delete Role
              </button>
            </div>
            <VisibilityNote />
          </>
        )}

        {/* ── Inline status for create/delete ──────────────────────── */}
        {!isAddingNew && isBuiltIn && (
          <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{draftCustom.length} custom · {BUILT_IN_IDS.length} built-in</span>
            {saving && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>⏳ Saving…</span>}
            {status === 'saved' && <span style={{ fontSize: 11, color: 'var(--success)', marginLeft: 'auto' }}>✅ Saved</span>}
            {status.startsWith('err:') && <span style={{ fontSize: 11, color: 'var(--danger)', marginLeft: 'auto' }}>❌ {status.slice(4)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
