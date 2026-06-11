import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/apiClient.js';
import { useAuth } from '../hooks/useAuth.js';
import { POLICY_SCHEMA } from '../constants.js';
import useStore from '../store/useStore.js';

const COLORS = {
  bg: 'var(--bg, #0f1117)',
  surface: 'var(--surface, #161620)',
  surface2: 'var(--surface2, #1d2230)',
  border: 'var(--border, #2a2a3a)',
  text: 'var(--text, #f5f7ff)',
  muted: 'var(--text-muted, #98a3b3)',
  accent: 'var(--accent, #1492ff)',
  success: 'var(--success, #068443)',
  danger: 'var(--danger, #eb3f3f)',
  warning: 'var(--warning, #f5a623)',
};

const BASE_ROLE_OPTIONS = [
  { value: 'exec',  label: 'Exec — executive view' },
  { value: 'rte',   label: 'RTE — release train engineer' },
  { value: 'pm',    label: 'PM — programme manager' },
  { value: 'sm',    label: 'SM — scrum master' },
  { value: 'all',   label: 'All — full access' },
  { value: 'admin', label: 'Admin — dept administrator' },
];

function buildRoleOptions(customRoles = []) {
  const customOpts = customRoles.map(r => ({ value: r.id, label: r.label || r.id }));
  return [...BASE_ROLE_OPTIONS, ...customOpts];
}

const EMPTY_CREATE_FORM = {
  id: '',
  name: '',
  baseUrl: '',
  organization: '',
  project: '',
  pat: '',
  areaPath: '',
  iterationPath: '',
  githubToken: '',
};

const EMPTY_ADD_USER_FORM = {
  key: '',
  role: 'read',
};

function toAbsoluteApiUrl(path) {
  if (typeof window === 'undefined') return path;
  return new URL(path, window.location.origin).toString();
}

function slugifyDepartmentId(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function normalizeDepartmentList(summaryData, departmentsData) {
  const summaryDepts = Array.isArray(summaryData?.depts) ? summaryData.depts : [];
  const departments = Array.isArray(departmentsData?.departments) ? departmentsData.departments : [];
  const byId = new Map();

  summaryDepts.forEach((dept) => {
    byId.set(dept.id, {
      id: dept.id,
      name: dept.name || dept.id,
      description: '',
      memberCount: dept.memberCount || 0,
      tfsOrg: dept.tfsOrg || '',
      tfsProject: '',
      hasPat: Boolean(dept.hasPat),
      lastConfigLoad: dept.lastConfigLoad || null,
      createdAt: null,
    });
  });

  departments.forEach((dept) => {
    const existing = byId.get(dept.id) || { id: dept.id, memberCount: 0, hasPat: Boolean(dept.hasPat) };
    byId.set(dept.id, {
      ...existing,
      ...dept,
      name: dept.name || existing.name || dept.id,
      description: dept.description || existing.description || '',
      tfsOrg: dept.tfsOrg || existing.tfsOrg || '',
      tfsProject: dept.tfsProject || existing.tfsProject || '',
      memberCount: existing.memberCount || 0,
      hasPat: dept.hasPat ?? existing.hasPat ?? false,
      lastConfigLoad: existing.lastConfigLoad || null,
    });
  });

  return [...byId.values()].sort((a, b) => {
    if (a.id === 'default') return -1;
    if (b.id === 'default') return 1;
    return String(a.name || a.id).localeCompare(String(b.name || b.id));
  });
}

function normalizeAllUsers(data) {
  const raw = data?.users;
  if (Array.isArray(raw)) {
    return raw
      .map((user) => ({ ...user, key: user.key || '' }))
      .sort((a, b) => String(a.displayName || a.key).localeCompare(String(b.displayName || b.key)));
  }

  if (raw && typeof raw === 'object') {
    return Object.entries(raw)
      .map(([key, value]) => ({ key, ...(value || {}) }))
      .sort((a, b) => String(a.displayName || a.key).localeCompare(String(b.displayName || b.key)));
  }

  return [];
}

function toConfigForm(config) {
  return {
    baseUrl: config?.tfs?.baseUrl || '',
    organization: config?.tfs?.organization || '',
    project: config?.tfs?.project || '',
    pat: config?.tfs?.pat || '',
    areaPath: config?.tfs?.areaPath || '',
    iterationPath: config?.tfs?.iterationPath || '',
    githubToken: config?.github?.token || '',
  };
}

function buildTfsPayload(form) {
  return {
    baseUrl: String(form.baseUrl || '').trim(),
    organization: String(form.organization || '').trim(),
    project: String(form.project || '').trim(),
    pat: String(form.pat || '').trim(),
    areaPath: String(form.areaPath || '').trim(),
    iterationPath: String(form.iterationPath || '').trim(),
  };
}

function buildDepartmentPayload(form) {
  const payload = {
    id: String(form.id || '').trim(),
    name: String(form.name || '').trim(),
    description: '',
    config: {
      tfs: buildTfsPayload(form),
      branding: { appName: String(form.name || '').trim() || 'AV Dashboard' },
      app: {},
    },
  };
  if (form.githubToken) {
    payload.config.github = { token: String(form.githubToken).trim() };
  }
  return payload;
}

function useScopedBanners() {
  const timersRef = useRef({});
  const [banners, setBanners] = useState({});

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach((timer) => clearTimeout(timer));
    };
  }, []);

  function showBanner(scope, type, message) {
    if (!scope) return;
    if (timersRef.current[scope]) clearTimeout(timersRef.current[scope]);

    setBanners((current) => ({
      ...current,
      [scope]: { type, message },
    }));

    timersRef.current[scope] = setTimeout(() => {
      setBanners((current) => {
        const next = { ...current };
        delete next[scope];
        return next;
      });
      delete timersRef.current[scope];
    }, 4000);
  }

  return { banners, showBanner };
}

function getButtonStyle(variant = 'secondary', disabled = false) {
  const shared = {
    border: '1px solid transparent',
    borderRadius: 0,
    padding: '10px 14px',
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.65 : 1,
    transition: 'all .2s ease',
  };

  if (variant === 'primary') {
    return {
      ...shared,
      background: COLORS.accent,
      color: '#fff',
      borderColor: `${COLORS.accent}`,
      boxShadow: '0 10px 24px rgba(20, 146, 255, 0.22)',
    };
  }

  if (variant === 'danger') {
    return {
      ...shared,
      background: COLORS.danger,
      color: '#fff',
      borderColor: `${COLORS.danger}`,
      boxShadow: '0 10px 24px rgba(235, 63, 63, 0.18)',
    };
  }

  return {
    ...shared,
    background: 'transparent',
    color: COLORS.text,
    borderColor: COLORS.border,
  };
}

function Banner({ banner }) {
  if (!banner?.message) return null;
  const tone = banner.type === 'success'
    ? { background: 'rgba(6, 132, 67, 0.14)', border: COLORS.success, color: '#c8f5db' }
    : { background: 'rgba(235, 63, 63, 0.14)', border: COLORS.danger, color: '#ffd3d3' };

  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 0,
        border: `1px solid ${tone.border}`,
        background: tone.background,
        color: tone.color,
        fontSize: 13,
        marginBottom: 16,
      }}
    >
      {banner.message}
    </div>
  );
}

function Panel({ title, subtitle, actions, children }) {
  return (
    <section
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 0,
        padding: 18,
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.18)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.text }}>{title}</div>
          {subtitle ? (
            <div style={{ marginTop: 4, fontSize: 13, color: COLORS.muted }}>{subtitle}</div>
          ) : null}
        </div>
        {actions ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function KpiCard({ label, value }) {
  return (
    <div
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 0,
        padding: '18px 20px',
        minHeight: 106,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.16)',
      }}
    >
      <div style={{ width: 42, height: 4, borderRadius: 0, background: COLORS.accent }} />
      <div style={{ fontSize: 34, lineHeight: 1, fontWeight: 900, color: COLORS.accent }}>
        {value ?? '—'}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: COLORS.muted }}>
        {label}
      </div>
    </div>
  );
}

function TabButton({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: 'relative',
        border: `1px solid ${active ? COLORS.accent : COLORS.border}`,
        background: active ? 'rgba(20, 146, 255, 0.10)' : COLORS.surface,
        color: active ? COLORS.text : COLORS.muted,
        borderRadius: 0,
        padding: '11px 18px',
        fontWeight: 800,
        fontSize: 13,
        letterSpacing: '.02em',
        cursor: 'pointer',
        boxShadow: active ? 'inset 0 -2px 0 var(--accent, #1492ff)' : 'none',
      }}
    >
      {label}
    </button>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}
      </span>
      {children}
      {hint ? <span style={{ fontSize: 12, color: COLORS.muted }}>{hint}</span> : null}
    </label>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        background: COLORS.surface2,
        color: COLORS.text,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 0,
        padding: '11px 12px',
        fontSize: 14,
        outline: 'none',
        ...(props.style || {}),
      }}
    />
  );
}

function TextArea(props) {
  return (
    <textarea
      {...props}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        background: COLORS.surface2,
        color: COLORS.text,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 0,
        padding: '11px 12px',
        fontSize: 14,
        outline: 'none',
        resize: 'vertical',
        minHeight: 96,
        ...(props.style || {}),
      }}
    />
  );
}

function SelectInput(props) {
  return (
    <select
      {...props}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        background: COLORS.surface2,
        color: COLORS.text,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 0,
        padding: '11px 12px',
        fontSize: 14,
        outline: 'none',
        ...(props.style || {}),
      }}
    />
  );
}

function EmptyState({ title, description }) {
  return (
    <div
      style={{
        padding: 24,
        borderRadius: 0,
        border: `1px dashed ${COLORS.border}`,
        background: 'rgba(255, 255, 255, 0.02)',
        color: COLORS.muted,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.text, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13 }}>{description}</div>
    </div>
  );
}

function ModalFrame({ title, subtitle, onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6, 8, 12, 0.74)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 0,
          padding: 20,
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.35)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: COLORS.text }}>{title}</div>
            {subtitle ? <div style={{ marginTop: 6, color: COLORS.muted, fontSize: 13 }}>{subtitle}</div> : null}
          </div>
          <button type="button" onClick={onClose} style={getButtonStyle('secondary')}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function HealthDot({ ok }) {
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        display: 'inline-block',
        background: ok ? COLORS.success : COLORS.warning,
        boxShadow: `0 0 0 4px ${ok ? 'rgba(6, 132, 67, 0.16)' : 'rgba(245, 166, 35, 0.16)'}`,
      }}
    />
  );
}

function Toggle({ checked, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 52,
        height: 30,
        padding: 3,
        borderRadius: 16,
        border: `1px solid ${checked ? COLORS.accent : COLORS.border}`,
        background: checked ? 'rgba(20, 146, 255, 0.20)' : COLORS.surface2,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'all .2s ease',
      }}
    >
      <span
        style={{
          display: 'block',
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: checked ? COLORS.accent : COLORS.muted,
          transform: `translateX(${checked ? '22px' : '0'})`,
          transition: 'transform .2s ease',
        }}
      />
    </button>
  );
}

function DepartmentCard({
  dept,
  isSelected,
  deleteMode,
  deleteValue,
  deleting,
  onSelect,
  onUsers,
  onEdit,
  onClone,
  onDeleteClick,
  onDeleteChange,
  onDeleteCancel,
  onDeleteConfirm,
}) {
  return (
    <div
      style={{
        border: `1px solid ${isSelected ? COLORS.accent : COLORS.border}`,
        background: isSelected ? 'rgba(20, 146, 255, 0.08)' : COLORS.surface2,
        borderRadius: 0,
        padding: 16,
        boxShadow: isSelected ? '0 16px 32px rgba(20, 146, 255, 0.14)' : 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <button
            type="button"
            onClick={onSelect}
            style={{
              padding: 0,
              margin: 0,
              border: 'none',
              background: 'transparent',
              color: COLORS.text,
              cursor: 'pointer',
              fontSize: 17,
              fontWeight: 800,
              textAlign: 'left',
            }}
          >
            {dept.name}
          </button>
          <div style={{ marginTop: 4, fontSize: 12, color: COLORS.muted }}>ID: {dept.id}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
          <HealthDot ok={dept.hasPat} />
          <span style={{ color: COLORS.muted, fontSize: 12 }}>{dept.hasPat ? 'Configured' : 'PAT missing'}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 12 }}>
        <div style={{ padding: 12, borderRadius: 0, background: 'rgba(255, 255, 255, 0.03)' }}>
          <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>TFS Org</div>
          <div style={{ marginTop: 4, color: COLORS.text, fontWeight: 700 }}>{dept.tfsOrg || '—'}</div>
        </div>
        <div style={{ padding: 12, borderRadius: 0, background: 'rgba(255, 255, 255, 0.03)' }}>
          <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>Members</div>
          <div style={{ marginTop: 4, color: COLORS.text, fontWeight: 700 }}>{dept.memberCount || 0}</div>
        </div>
      </div>

      {dept.description ? (
        <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 12 }}>{dept.description}</div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={onUsers} style={getButtonStyle('primary')}>
          Users
        </button>
        <button type="button" onClick={onEdit} style={getButtonStyle('secondary')}>
          Edit
        </button>
        <button type="button" onClick={onClone} style={getButtonStyle('secondary')}>
          Clone
        </button>
        <button
          type="button"
          onClick={onDeleteClick}
          disabled={dept.id === 'default' || deleting}
          style={getButtonStyle('danger', dept.id === 'default' || deleting)}
        >
          Delete
        </button>
      </div>

      {deleteMode ? (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 0,
            border: `1px solid ${COLORS.danger}`,
            background: 'rgba(235, 63, 63, 0.08)',
          }}
        >
          <div style={{ color: COLORS.text, fontWeight: 700, marginBottom: 8 }}>Type {dept.name} to confirm deletion</div>
          <TextInput value={deleteValue} onChange={(event) => onDeleteChange(event.target.value)} placeholder={dept.name} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              type="button"
              onClick={onDeleteConfirm}
              disabled={deleteValue !== dept.name || deleting}
              style={getButtonStyle('danger', deleteValue !== dept.name || deleting)}
            >
              {deleting ? 'Deleting…' : 'Confirm Delete'}
            </button>
            <button type="button" onClick={onDeleteCancel} style={getButtonStyle('secondary')}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DepartmentsTab({
  departments,
  selectedDept,
  deptUsers,
  departmentsError,
  deptUsersError,
  deptUsersLoading,
  deptUsersBanner,
  departmentsBanner,
  addUserForm,
  setAddUserForm,
  roleUpdatePendingKey,
  removePendingKey,
  addUserPending,
  deletePendingDeptId,
  deleteTargetId,
  deleteConfirmValue,
  setDeleteTargetId,
  setDeleteConfirmValue,
  onSelectDept,
  onOpenEdit,
  onOpenClone,
  onDeleteDept,
  onAddUser,
  onRoleChange,
  onRemoveUser,
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 380px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
      <Panel title="Departments" subtitle="Manage tenants, clone setups, and keep access healthy.">
        <Banner banner={departmentsBanner} />
        {departmentsError ? <Banner banner={{ type: 'error', message: departmentsError.message }} /> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {departments.length ? departments.map((dept) => (
            <DepartmentCard
              key={dept.id}
              dept={dept}
              isSelected={selectedDept?.id === dept.id}
              deleteMode={deleteTargetId === dept.id}
              deleteValue={deleteConfirmValue}
              deleting={deletePendingDeptId === dept.id}
              onSelect={() => onSelectDept(dept.id)}
              onUsers={() => onSelectDept(dept.id)}
              onEdit={() => onOpenEdit(dept)}
              onClone={() => onOpenClone(dept)}
              onDeleteClick={() => {
                setDeleteTargetId((current) => current === dept.id ? null : dept.id);
                setDeleteConfirmValue('');
              }}
              onDeleteChange={setDeleteConfirmValue}
              onDeleteCancel={() => {
                setDeleteTargetId(null);
                setDeleteConfirmValue('');
              }}
              onDeleteConfirm={() => onDeleteDept(dept)}
            />
          )) : <EmptyState title="No departments found" description="Create a department from the Settings tab to get started." />}
        </div>
      </Panel>

      <Panel
        title={selectedDept ? `${selectedDept.name} users` : 'Department users'}
        subtitle={selectedDept ? `Manage access and roles for ${selectedDept.name}.` : 'Select a department to manage members.'}
      >
        <Banner banner={deptUsersBanner} />
        {!selectedDept ? (
          <EmptyState title="Select a department" description="Choose a department on the left to view and manage its users." />
        ) : (
          <>
            {deptUsersError ? <Banner banner={{ type: 'error', message: deptUsersError.message }} /> : null}
            <div style={{ overflowX: 'auto', marginBottom: 18 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr style={{ color: COLORS.muted, textAlign: 'left' }}>
                    {['User Key', 'Display Name', 'Role', 'Actions'].map((label) => (
                      <th key={label} style={{ padding: '12px 10px', borderBottom: `1px solid ${COLORS.border}`, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deptUsersLoading ? (
                    <tr>
                      <td colSpan={4} style={{ padding: 18, color: COLORS.muted }}>Loading users…</td>
                    </tr>
                  ) : deptUsers.length ? deptUsers.map((member) => (
                    <tr key={member.key}>
                      <td style={{ padding: '14px 10px', borderBottom: `1px solid ${COLORS.border}`, color: COLORS.text, fontFamily: 'monospace' }}>{member.key}</td>
                      <td style={{ padding: '14px 10px', borderBottom: `1px solid ${COLORS.border}`, color: COLORS.text }}>
                        <div style={{ fontWeight: 700 }}>{member.displayName || '—'}</div>
                        {member.email ? <div style={{ fontSize: 12, color: COLORS.muted }}>{member.email}</div> : null}
                      </td>
                      <td style={{ padding: '14px 10px', borderBottom: `1px solid ${COLORS.border}` }}>
                        <SelectInput
                          value={member.role}
                          disabled={roleUpdatePendingKey === member.key}
                          onChange={(event) => onRoleChange(member.key, event.target.value)}
                        >
                          {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </SelectInput>
                      </td>
                      <td style={{ padding: '14px 10px', borderBottom: `1px solid ${COLORS.border}` }}>
                        <button
                          type="button"
                          onClick={() => onRemoveUser(member.key)}
                          disabled={removePendingKey === member.key}
                          style={getButtonStyle('danger', removePendingKey === member.key)}
                        >
                          {removePendingKey === member.key ? 'Removing…' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={4} style={{ padding: 18, color: COLORS.muted }}>No department users yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 18 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.text, marginBottom: 12 }}>Add user</div>
              <form onSubmit={onAddUser} style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1.8fr) minmax(160px, .8fr) auto', gap: 12, alignItems: 'end' }}>
                <Field label="TFS User Key" hint="Example: tfs:domain\username">
                  <TextInput
                    value={addUserForm.key}
                    onChange={(event) => setAddUserForm((current) => ({ ...current, key: event.target.value }))}
                    placeholder="tfs:domain\username"
                  />
                </Field>
                <Field label="Role">
                  <SelectInput
                    value={addUserForm.role}
                    onChange={(event) => setAddUserForm((current) => ({ ...current, role: event.target.value }))}
                  >
                    {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </SelectInput>
                </Field>
                <button type="submit" disabled={addUserPending} style={getButtonStyle('primary', addUserPending)}>
                  {addUserPending ? 'Adding…' : 'Add User'}
                </button>
              </form>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

function UsersTab({ users, usersBanner, usersError, togglePendingKey, onToggleSuperAdmin, departmentNameById }) {
  return (
    <Panel title="All users" subtitle="Super-admins can audit access across all departments.">
      <Banner banner={usersBanner} />
      {usersError ? <Banner banner={{ type: 'error', message: usersError.message }} /> : null}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: COLORS.muted }}>
              {['Key', 'Display Name', 'Email', 'Departments', 'Super Admin', 'Last Login'].map((label) => (
                <th key={label} style={{ padding: '12px 10px', borderBottom: `1px solid ${COLORS.border}`, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.length ? users.map((user) => {
              const departments = Array.isArray(user.departments)
                ? user.departments.map((dept) => departmentNameById.get(dept.id) || dept.id).join(', ')
                : '—';

              return (
                <tr key={user.key}>
                  <td style={{ padding: '14px 10px', borderBottom: `1px solid ${COLORS.border}`, color: COLORS.text, fontFamily: 'monospace' }}>{user.key}</td>
                  <td style={{ padding: '14px 10px', borderBottom: `1px solid ${COLORS.border}`, color: COLORS.text, fontWeight: 700 }}>{user.displayName || '—'}</td>
                  <td style={{ padding: '14px 10px', borderBottom: `1px solid ${COLORS.border}`, color: COLORS.muted }}>{user.email || '—'}</td>
                  <td style={{ padding: '14px 10px', borderBottom: `1px solid ${COLORS.border}`, color: COLORS.text }}>{departments || '—'}</td>
                  <td style={{ padding: '14px 10px', borderBottom: `1px solid ${COLORS.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Toggle
                        checked={Boolean(user.isSuperAdmin)}
                        disabled={togglePendingKey === user.key}
                        onClick={() => onToggleSuperAdmin(user)}
                      />
                      <span style={{ color: COLORS.muted, fontSize: 13 }}>
                        {togglePendingKey === user.key ? 'Saving…' : user.isSuperAdmin ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '14px 10px', borderBottom: `1px solid ${COLORS.border}`, color: COLORS.muted }}>{formatDateTime(user.lastLogin)}</td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={6} style={{ padding: 18, color: COLORS.muted }}>No users found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SettingsTab({
  createForm,
  onCreateNameChange,
  onCreateIdChange,
  onCreateFieldChange,
  onCreate,
  onTestCreate,
  createPending,
  testingCreate,
  settingsBanner,
  selectedDept,
  selectedDeptDetail,
  selectedDeptLoading,
  deptConfigForm,
  onDeptConfigChange,
  onSaveDeptConfig,
  saveConfigPending,
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 1fr) minmax(340px, 1fr)', gap: 16, alignItems: 'start' }}>
      <Panel title="Add Department" subtitle="Create a new tenant and store its TFS configuration.">
        <Banner banner={settingsBanner} />
        <form onSubmit={onCreate} style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Department ID" hint="Slug used in URLs and tenant storage">
              <TextInput
                value={createForm.id}
                onChange={(event) => onCreateIdChange(event.target.value)}
                placeholder="healthcare-it"
              />
            </Field>
            <Field label="Display Name">
              <TextInput
                value={createForm.name}
                onChange={(event) => onCreateNameChange(event.target.value)}
                placeholder="Healthcare IT"
              />
            </Field>
          </div>

          <Field label="TFS Base URL">
            <TextInput
              type="url"
              value={createForm.baseUrl}
              onChange={(event) => onCreateFieldChange('baseUrl', event.target.value)}
              placeholder="https://tfs.yourorg.com/tfs/YourOrg/YourProject"
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="TFS Organization">
              <TextInput
                value={createForm.organization}
                onChange={(event) => onCreateFieldChange('organization', event.target.value)}
                placeholder="YourOrg"
              />
            </Field>
            <Field label="TFS Project">
              <TextInput
                value={createForm.project}
                onChange={(event) => onCreateFieldChange('project', event.target.value)}
                placeholder="YourProject"
              />
            </Field>
          </div>

          <Field label="PAT Token">
            <TextInput
              type="password"
              value={createForm.pat}
              onChange={(event) => onCreateFieldChange('pat', event.target.value)}
              placeholder="Enter PAT token"
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Area Path">
              <TextInput
                value={createForm.areaPath}
                onChange={(event) => onCreateFieldChange('areaPath', event.target.value)}
                placeholder="YourProject\YourTeam"
              />
            </Field>
            <Field label="Iteration Path">
              <TextInput
                value={createForm.iterationPath}
                onChange={(event) => onCreateFieldChange('iterationPath', event.target.value)}
                placeholder="YourProject\YourTeam"
              />
            </Field>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={onTestCreate} disabled={testingCreate} style={getButtonStyle('secondary', testingCreate)}>
              {testingCreate ? 'Testing…' : 'Test Connection'}
            </button>
            <button type="submit" disabled={createPending} style={getButtonStyle('primary', createPending)}>
              {createPending ? 'Creating…' : 'Create Department'}
            </button>
          </div>
        </form>
      </Panel>

      <Panel
        title={selectedDept ? `Edit ${selectedDept.name} config` : 'Edit Department Config'}
        subtitle={selectedDept ? 'Update TFS connection values for the selected department.' : 'Select a department to edit its saved TFS settings.'}
      >
        {!selectedDept ? (
          <EmptyState title="No department selected" description="Pick a department from the Departments tab to edit its configuration." />
        ) : selectedDeptLoading && !selectedDeptDetail ? (
          <div style={{ color: COLORS.muted }}>Loading configuration…</div>
        ) : (
          <form onSubmit={onSaveDeptConfig} style={{ display: 'grid', gap: 14 }}>
            <Field label="TFS Base URL">
              <TextInput
                type="url"
                value={deptConfigForm.baseUrl}
                onChange={(event) => onDeptConfigChange('baseUrl', event.target.value)}
                placeholder="https://tfs.yourorg.com/tfs/YourOrg/YourProject"
              />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="TFS Organization">
                <TextInput
                  value={deptConfigForm.organization}
                  onChange={(event) => onDeptConfigChange('organization', event.target.value)}
                  placeholder="YourOrg"
                />
              </Field>
              <Field label="TFS Project">
                <TextInput
                  value={deptConfigForm.project}
                  onChange={(event) => onDeptConfigChange('project', event.target.value)}
                  placeholder="YourProject"
                />
              </Field>
            </div>
            <Field label="PAT Token">
              <TextInput
                type="password"
                value={deptConfigForm.pat}
                onChange={(event) => onDeptConfigChange('pat', event.target.value)}
                placeholder="Enter PAT token"
              />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Area Path">
                <TextInput
                  value={deptConfigForm.areaPath}
                  onChange={(event) => onDeptConfigChange('areaPath', event.target.value)}
                  placeholder="YourProject\YourTeam"
                />
              </Field>
              <Field label="Iteration Path">
                <TextInput
                  value={deptConfigForm.iterationPath}
                  onChange={(event) => onDeptConfigChange('iterationPath', event.target.value)}
                  placeholder="YourProject\YourTeam"
                />
              </Field>
            </div>
            <Field label="GitHub Token (for Test Coverage)">
              <TextInput
                type="password"
                value={deptConfigForm.githubToken}
                onChange={(event) => onDeptConfigChange('githubToken', event.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              />
            </Field>
            <button type="submit" disabled={saveConfigPending} style={getButtonStyle('primary', saveConfigPending)}>
              {saveConfigPending ? 'Saving…' : 'Save Config'}
            </button>
          </form>
        )}
      </Panel>
    </div>
  );
}

// ── Dept Policies Tab (Roles & Visibility for a specific dept) ───────────────
function DeptPoliciesTab({ deptId }) {
  const [cfg, setCfg]             = useState(null);
  const [loading, setLoading]     = useState(true);
  const [policies, setPolicies]   = useState({});
  const [saveStatus, setSaveStatus] = useState('');
  const [selRole, setSelRole]     = useState('all');
  const [expandedPage, setExpandedPage] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/d/${deptId}/config`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setCfg(data); setPolicies(data.policies || {}); setLoading(false); })
      .catch(() => setLoading(false));
  }, [deptId]);

  const ROLE_META = { all: { label: 'All', icon: '🔓' }, exec: { label: 'Exec', icon: '👔' }, rte: { label: 'RTE', icon: '🚂' }, pm: { label: 'PM', icon: '📋' }, sm: { label: 'SM', icon: '🏃' }, admin: { label: 'Admin', icon: '🛠' } };
  (cfg?.roles?.custom || []).forEach(r => { if (r.id && !ROLE_META[r.id]) ROLE_META[r.id] = { label: r.label || r.id, icon: r.icon || '👤' }; });

  const BUILT_IN_IDS = new Set(['all', 'exec', 'rte', 'pm', 'sm', 'admin']);
  const defaultPolicy = rid => BUILT_IN_IDS.has(rid) ? { hiddenPages: [], hiddenTabs: [], hiddenCharts: [] } : { hiddenPages: POLICY_SCHEMA.map(p => p.id), hiddenTabs: [], hiddenCharts: [] };
  const rp = policies[selRole] ?? defaultPolicy(selRole);
  const isHiddenPage  = pid => (rp.hiddenPages  || []).includes(pid);
  const isHiddenTab   = (pid, tid) => (rp.hiddenTabs   || []).includes(`${pid}.${tid}`);
  const isHiddenChart = (pid, cid) => (rp.hiddenCharts || []).includes(`${pid}.${cid}`);

  function toggle(type, key) {
    const cur = [...(rp[type] || [])];
    const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
    setPolicies(prev => ({ ...prev, [selRole]: { ...rp, [type]: next } }));
  }

  async function save() {
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/d/${deptId}/config`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policies }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || res.statusText);
      setSaveStatus('ok');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (e) { setSaveStatus('err:' + e.message); }
  }

  if (loading) return <div style={{ color: COLORS.muted, padding: 16, fontSize: 13 }}>Loading policies…</div>;

  const visCount = POLICY_SCHEMA.filter(p => !isHiddenPage(p.id)).length;

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: COLORS.text }}>🔒 Visibility Policies</div>
          <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>Control which sections, tabs, and charts each role sees. Changes take effect after saving.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saveStatus === 'ok'         && <span style={{ color: COLORS.success, fontSize: 12, fontWeight: 600 }}>✅ Saved</span>}
          {saveStatus === 'saving'     && <span style={{ color: COLORS.muted,   fontSize: 12 }}>Saving…</span>}
          {saveStatus.startsWith('err:') && <span style={{ color: COLORS.danger, fontSize: 12 }}>❌ {saveStatus.slice(4)}</span>}
          <button onClick={save} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, background: COLORS.accent, color: '#fff', border: 'none', borderRadius: 0, cursor: 'pointer' }}>
            Save Policies
          </button>
        </div>
      </div>

      {/* Role selector */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {Object.entries(ROLE_META).map(([rid, m]) => {
          const active = selRole === rid;
          const rRp = policies[rid] ?? defaultPolicy(rid);
          const vis = POLICY_SCHEMA.filter(p => !(rRp.hiddenPages || []).includes(p.id)).length;
          return (
            <button key={rid} type="button"
              onClick={() => { setSelRole(rid); setExpandedPage(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', borderRadius: 0,
                border: `2px solid ${active ? COLORS.accent : COLORS.border}`,
                background: active ? 'rgba(20,146,255,.15)' : COLORS.surface2,
                color: active ? '#5bb8ff' : COLORS.muted,
              }}>
              <span>{m.icon}</span> {m.label}
              <span style={{ fontSize: 10, background: active ? 'rgba(20,146,255,.25)' : 'rgba(255,255,255,.05)', padding: '1px 6px', borderRadius: 0 }}>{vis}/{POLICY_SCHEMA.length}</span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 14 }}>
        {visCount} of {POLICY_SCHEMA.length} sections visible for <strong style={{ color: COLORS.text }}>{ROLE_META[selRole]?.label}</strong>
      </div>

      {/* Section cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
        {POLICY_SCHEMA.map(page => {
          const hidden   = isHiddenPage(page.id);
          const expanded = expandedPage === page.id;
          const hiddenTabCount   = page.tabs?.filter(t  => isHiddenTab(page.id, t.id)).length   || 0;
          const hiddenChartCount = page.charts?.filter(c => isHiddenChart(page.id, c.id)).length || 0;
          return (
            <div key={page.id} style={{ border: `1px solid ${hidden ? 'rgba(235,63,63,.3)' : COLORS.border}`, borderRadius: 0, overflow: 'hidden', background: hidden ? 'rgba(235,63,63,.04)' : COLORS.surface, opacity: hidden ? 0.75 : 1 }}>
              {/* Card header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px' }}>
                <button type="button" onClick={() => toggle('hiddenPages', page.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer', borderRadius: 0,
                    border: `1px solid ${hidden ? COLORS.danger : COLORS.accent}`,
                    background: hidden ? 'rgba(235,63,63,.1)' : 'rgba(20,146,255,.12)',
                    color: hidden ? COLORS.danger : '#5bb8ff' }}>
                  {hidden ? '✗ Hidden' : '✓ Visible'}
                </button>
                <span style={{ fontSize: 15 }}>{page.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, flex: 1 }}>{page.label}</span>
                {(page.tabs?.length > 0 || page.charts?.length > 0) && (
                  <button type="button" onClick={() => setExpandedPage(expanded ? null : page.id)}
                    style={{ fontSize: 11, color: COLORS.muted, background: 'none', border: `1px solid ${COLORS.border}`, borderRadius: 0, padding: '2px 7px', cursor: 'pointer' }}>
                    {expanded ? 'Hide' : `Tabs/Charts${hiddenTabCount + hiddenChartCount > 0 ? ` (${hiddenTabCount + hiddenChartCount} hidden)` : ''}`}
                  </button>
                )}
              </div>
              {/* Expanded: tabs + charts */}
              {expanded && !hidden && (
                <div style={{ padding: '4px 12px 10px', borderTop: `1px solid ${COLORS.border}` }}>
                  {page.tabs?.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '.06em', margin: '8px 0 5px' }}>Tabs</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {page.tabs.map(t => {
                          const vis = !isHiddenTab(page.id, t.id);
                          return (
                            <button key={t.id} type="button" onClick={() => toggle('hiddenTabs', `${page.id}.${t.id}`)}
                              style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', cursor: 'pointer', borderRadius: 0,
                                border: `1px solid ${vis ? COLORS.accent : COLORS.border}`,
                                background: vis ? 'rgba(20,146,255,.12)' : 'transparent',
                                color: vis ? '#5bb8ff' : COLORS.muted }}>
                              {vis ? '✓' : '○'} {t.label}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {page.charts?.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '.06em', margin: '8px 0 5px' }}>Charts</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {page.charts.map(c => {
                          const vis = !isHiddenChart(page.id, c.id);
                          return (
                            <button key={c.id} type="button" onClick={() => toggle('hiddenCharts', `${page.id}.${c.id}`)}
                              style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', cursor: 'pointer', borderRadius: 0,
                                border: `1px solid ${vis ? '#8b5cf6' : COLORS.border}`,
                                background: vis ? 'rgba(139,92,246,.12)' : 'transparent',
                                color: vis ? '#c4b5fd' : COLORS.muted }}>
                              {vis ? '✓' : '○'} {c.label}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 14, fontSize: 11, color: COLORS.muted }}>
        💡 To manage custom roles and role structure, use <strong style={{ color: COLORS.text }}>Settings → Roles &amp; Visibility</strong> while this department is active.
      </div>
    </div>
  );
}

function SlowQueryDetail({ q, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}>
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 0, width: '100%', maxWidth: 780, maxHeight: '80vh', overflowY: 'auto', padding: 24 }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>🐌 Slow Query Detail</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: COLORS.muted, fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Summary row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 18 }}>
          {[
            { label: 'Time',        val: new Date(q.at).toLocaleString() },
            { label: 'Duration',    val: `${(q.ms / 1000).toFixed(2)}s`, color: q.ms > 20000 ? COLORS.danger : COLORS.warning },
            { label: 'API Route',   val: q.apiRoute || '—', color: COLORS.accent },
            { label: 'User',        val: q.user     || '—', color: COLORS.text },
            { label: 'Dept',        val: q.deptId   || '—' },
            { label: 'Req ID',      val: q.reqId    || '—' },
          ].map(k => (
            <div key={k.label} style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, padding: '8px 12px' }}>
              <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 3 }}>{k.label}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: k.color || COLORS.text, wordBreak: 'break-all' }}>{k.val}</div>
            </div>
          ))}
        </div>

        {/* TFS endpoint */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>TFS Endpoint</div>
          <div style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, color: '#a5b4fc', wordBreak: 'break-all' }}>
            {q.tfsUrl || q.url || '—'}
          </div>
        </div>

        {/* WIQL query */}
        {q.wiqlQuery && (
          <div>
            <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>Full WIQL Query</div>
            <pre style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, padding: '12px 14px', fontFamily: 'monospace', fontSize: 11, color: '#86efac', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflowY: 'auto' }}>
              {q.wiqlQuery}
            </pre>
          </div>
        )}

        {!q.wiqlQuery && q.label && (
          <div>
            <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>WHERE Clause (excerpt)</div>
            <pre style={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, padding: '12px 14px', fontFamily: 'monospace', fontSize: 11, color: '#86efac', margin: 0, whiteSpace: 'pre-wrap' }}>
              {q.label}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [selectedQ, setSelectedQ] = useState(null);
  const [busting, setBusting] = useState(false);
  const [bustMsg, setBustMsg] = useState('');

  async function fetchMetrics() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/health/metrics', { credentials: 'include' });
      if (res.status === 401) { window.location.href = '/login'; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function bustCache() {
    setBusting(true);
    setBustMsg('');
    try {
      const res = await fetch('/api/full-reset', { method: 'POST', credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const scope = json.scope === 'all' ? 'all departments' : `dept: ${json.scope}`;
      setBustMsg(`✅ Cache cleared + circuits reset (${scope}). Fresh data on next request.`);
      await fetchMetrics();
    } catch (e) {
      setBustMsg(`❌ ${e.message}`);
    } finally {
      setBusting(false);
      setTimeout(() => setBustMsg(''), 6000);
    }
  }

  useEffect(() => {
    fetchMetrics();
    const iv = setInterval(fetchMetrics, 30_000);
    return () => clearInterval(iv);
  }, []);

  function exportToCsv() {
    if (!data) return;
    const cache    = data.cache    || {};
    const circuits = data.circuits || {};
    const slowQ    = data.slowQueries || [];
    const mem      = data.memory   || {};
    const rows     = [];
    const esc      = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

    // ── Section 1: Summary ────────────────────────────────────────────────────
    rows.push(['AV Dashboard — Observability Report']);
    rows.push([`Generated: ${new Date().toLocaleString()}`]);
    rows.push([`Server Uptime: ${Math.floor((data.uptime||0)/3600)}h ${Math.floor(((data.uptime||0)%3600)/60)}m`]);
    rows.push([]);

    rows.push(['CACHE STATISTICS']);
    rows.push(['Metric', 'Value']);
    rows.push(['Hit Rate',       cache.hitRate      ?? '—']);
    rows.push(['Hits',           cache.hits         ?? '—']);
    rows.push(['Misses',         cache.misses       ?? '—']);
    rows.push(['Active Entries', cache.activeEntries ?? '—']);
    rows.push(['Total Entries',  cache.entries      ?? '—']);
    rows.push(['Heap Used',      mem.heapUsed       ?? '—']);
    rows.push([]);

    rows.push(['CIRCUIT BREAKERS']);
    rows.push(['Origin', 'State', 'Failures', 'Opened At', 'Cooldown Remaining']);
    Object.entries(circuits).forEach(([origin, c]) => {
      rows.push([origin, c.state, c.failures, c.openedAt ? new Date(c.openedAt).toLocaleString() : '—', c.cooldownRemaining ?? '—']);
    });
    rows.push([]);

    // ── Section 2: Slow Queries ───────────────────────────────────────────────
    rows.push(['SLOW QUERIES (≥10s)']);
    rows.push(['Time', 'Duration (s)', 'API Route', 'User', 'Dept', 'Req ID', 'Method', 'WHERE Excerpt', 'Full WIQL Query', 'TFS URL']);
    [...slowQ].reverse().forEach(q => {
      rows.push([
        new Date(q.at).toLocaleString(),
        (q.ms / 1000).toFixed(2),
        q.apiRoute  || '—',
        q.user      || '—',
        q.deptId    || '—',
        q.reqId     || '—',
        q.method    || '—',
        q.label     || '—',
        q.wiqlQuery || '—',
        q.tfsUrl    || '—',
      ]);
    });

    const csv   = rows.map(r => r.map(esc).join(',')).join('\r\n');
    const blob  = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href      = url;
    a.download  = `observability-${new Date().toISOString().slice(0,16).replace('T','-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const cache          = data?.cache     || {};
  const circuits       = data?.circuits  || {};
  const slowQ          = data?.slowQueries || [];
  const mem            = data?.memory    || {};
  const hitRate        = cache.hitRate ?? '—';
  const circuitEntries = Object.entries(circuits);
  const stateColor     = (s) => s === 'CLOSED' ? '#4ade80' : s === 'OPEN' ? '#ef4444' : '#f59e0b';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {selectedQ && <SlowQueryDetail q={selectedQ} onClose={() => setSelectedQ(null)} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: COLORS.muted }}>
          Auto-refreshes every 30s{lastRefresh ? ` · Last: ${lastRefresh.toLocaleTimeString()}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportToCsv} disabled={!data} style={getButtonStyle('secondary', !data)}
            title="Download slow queries + metrics as CSV (opens in Excel)">
            ⬇ Export CSV
          </button>
          <button onClick={bustCache} disabled={busting} style={getButtonStyle('danger', busting)}
            title="Clear cache + reset circuit breakers — all endpoints fetch fresh data from TFS">
            {busting ? '…' : '🔄 Full Reset'}
          </button>
          <button onClick={fetchMetrics} disabled={loading} style={getButtonStyle('secondary', loading)}>
            {loading ? '…' : '↺ Refresh'}
          </button>
        </div>
      </div>
      {bustMsg && (
        <div style={{ padding: '8px 12px', background: bustMsg.startsWith('✅') ? '#14532d33' : '#7f1d1d33',
          border: `1px solid ${bustMsg.startsWith('✅') ? '#4ade80' : '#ef4444'}`, fontSize: 13, color: COLORS.text }}>
          {bustMsg}
        </div>
      )}


      {error && <Banner banner={{ type: 'error', message: error }} />}

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
        {[
          { label: 'Cache Hit Rate', val: hitRate,                                                          color: COLORS.success },
          { label: 'Cache Hits',     val: cache.hits          ?? '—',                                      color: COLORS.accent  },
          { label: 'Cache Misses',   val: cache.misses        ?? '—',                                      color: COLORS.warning },
          { label: 'Active Entries', val: `${cache.activeEntries ?? '—'} / ${cache.entries ?? '—'}`,       color: COLORS.muted   },
          { label: 'Heap Used',      val: mem.heapUsed        ?? '—',                                      color: COLORS.muted   },
          { label: 'Uptime',         val: data ? `${Math.floor((data.uptime||0)/3600)}h ${Math.floor(((data.uptime||0)%3600)/60)}m` : '—', color: COLORS.muted },
        ].map(k => (
          <div key={k.label} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, padding: '12px 14px' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Circuit breakers */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 0 }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${COLORS.border}`, fontWeight: 700, fontSize: 13 }}>⚡ Circuit Breakers</div>
        {circuitEntries.length === 0 ? (
          <div style={{ padding: '12px 16px', color: COLORS.muted, fontSize: 13 }}>No circuit data — no TFS calls made yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>{['Origin', 'State', 'Failures', 'Opened At', 'Cooldown'].map(h => (
                <th key={h} style={{ padding: '8px 16px', textAlign: 'left', color: COLORS.muted, fontWeight: 500, borderBottom: `1px solid ${COLORS.border}` }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {circuitEntries.map(([origin, c]) => (
                <tr key={origin} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '8px 16px', fontFamily: 'monospace', color: COLORS.text }}>{origin}</td>
                  <td style={{ padding: '8px 16px' }}>
                    <span style={{ padding: '2px 8px', background: `${stateColor(c.state)}22`, color: stateColor(c.state), fontWeight: 700, fontSize: 11 }}>{c.state}</span>
                  </td>
                  <td style={{ padding: '8px 16px', color: c.failures > 0 ? COLORS.danger : COLORS.muted }}>{c.failures}</td>
                  <td style={{ padding: '8px 16px', color: COLORS.muted }} title={c.lastFailure || ''}>{c.openedAt ? new Date(c.openedAt).toLocaleTimeString() : '—'}</td>
                  <td style={{ padding: '8px 16px', color: c.cooldownRemaining ? COLORS.warning : COLORS.muted }}>{c.cooldownRemaining ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Slow query log */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 0 }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${COLORS.border}`, fontWeight: 700, fontSize: 13 }}>
          🐌 Slow Queries <span style={{ fontSize: 11, fontWeight: 400, color: COLORS.muted }}>(≥10s · last 50 · click row for details)</span>
        </div>
        {slowQ.length === 0 ? (
          <div style={{ padding: '12px 16px', color: COLORS.muted, fontSize: 13 }}>✅ No slow queries recorded.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
              <thead>
                <tr>{['Time', 'Dur', 'API Route', 'User', 'Dept', 'WIQL / URL excerpt'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: COLORS.muted, fontWeight: 500, borderBottom: `1px solid ${COLORS.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {[...slowQ].reverse().map((q, i) => (
                  <tr key={i} onClick={() => setSelectedQ(q)}
                    style={{ borderBottom: `1px solid ${COLORS.border}`, cursor: 'pointer', transition: 'background .12s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.04)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '7px 12px', color: COLORS.muted, whiteSpace: 'nowrap' }}>{new Date(q.at).toLocaleTimeString()}</td>
                    <td style={{ padding: '7px 12px', color: q.ms > 20000 ? COLORS.danger : COLORS.warning, fontWeight: 700, whiteSpace: 'nowrap' }}>{(q.ms/1000).toFixed(1)}s</td>
                    <td style={{ padding: '7px 12px', color: COLORS.accent, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{q.apiRoute || '—'}</td>
                    <td style={{ padding: '7px 12px', color: COLORS.text, fontSize: 11, whiteSpace: 'nowrap' }}>{q.user || '—'}</td>
                    <td style={{ padding: '7px 12px', color: COLORS.muted, fontSize: 11 }}>{q.deptId || '—'}</td>
                    <td style={{ padding: '7px 12px', color: COLORS.text, fontFamily: 'monospace', fontSize: 11, maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {q.label || q.tfsUrl || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminSection() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isSuperAdmin = Boolean(user?.isSuperAdmin);

  const [activeTab, setActiveTab] = useState('departments');
  const [selectedDeptId, setSelectedDeptId] = useState('');  const [createForm, setCreateForm] = useState(EMPTY_CREATE_FORM);
  const [createIdTouched, setCreateIdTouched] = useState(false);
  const [deptConfigDrafts, setDeptConfigDrafts] = useState({});
  const [addUserForms, setAddUserForms] = useState({});
  const [cloneModalDept, setCloneModalDept] = useState(null);
  const [cloneForm, setCloneForm] = useState({ targetId: '', targetName: '' });
  const [editDeptModal, setEditDeptModal] = useState(null);
  const [editMetadataForm, setEditMetadataForm] = useState({ name: '', description: '' });
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const [deleteConfirmValue, setDeleteConfirmValue] = useState('');
  const { banners, showBanner } = useScopedBanners();
  const summaryQuery = useQuery({
    queryKey: ['admin', 'summary'],
    queryFn: () => apiFetch(toAbsoluteApiUrl('/api/admin/summary')),
    staleTime: 30000,
  });

  const departmentsQuery = useQuery({
    queryKey: ['admin', 'departments'],
    queryFn: () => apiFetch(toAbsoluteApiUrl('/api/departments')),
    staleTime: 30000,
  });

  const allUsersQuery = useQuery({
    queryKey: ['admin', 'users'],
    enabled: isSuperAdmin,
    queryFn: () => apiFetch(toAbsoluteApiUrl('/api/users')),
  });

  const createDepartmentMutation = useMutation({
    mutationFn: (payload) => apiFetch(toAbsoluteApiUrl('/api/departments'), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  });

  const updateMetadataMutation = useMutation({
    mutationFn: ({ deptId, payload }) => apiFetch(toAbsoluteApiUrl(`/api/departments/${encodeURIComponent(deptId)}`), {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  });

  const deleteDepartmentMutation = useMutation({
    mutationFn: (deptId) => apiFetch(toAbsoluteApiUrl(`/api/departments/${encodeURIComponent(deptId)}`), {
      method: 'DELETE',
    }),
  });

  const cloneDepartmentMutation = useMutation({
    mutationFn: ({ deptId, payload }) => apiFetch(toAbsoluteApiUrl(`/api/departments/${encodeURIComponent(deptId)}/clone`), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  });

  const addDeptUserMutation = useMutation({
    mutationFn: ({ deptId, payload }) => apiFetch(toAbsoluteApiUrl(`/api/departments/${encodeURIComponent(deptId)}/users`), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  });

  const updateDeptUserRoleMutation = useMutation({
    mutationFn: ({ deptId, userKey, role }) => apiFetch(toAbsoluteApiUrl(`/api/departments/${encodeURIComponent(deptId)}/users/${encodeURIComponent(userKey)}`), {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),
  });

  const removeDeptUserMutation = useMutation({
    mutationFn: ({ deptId, userKey }) => apiFetch(toAbsoluteApiUrl(`/api/departments/${encodeURIComponent(deptId)}/users/${encodeURIComponent(userKey)}`), {
      method: 'DELETE',
    }),
  });

  const toggleSuperAdminMutation = useMutation({
    mutationFn: ({ userKey, isSuperAdmin: nextValue }) => apiFetch(toAbsoluteApiUrl(`/api/users/${encodeURIComponent(userKey)}/superadmin`), {
      method: 'PUT',
      body: JSON.stringify({ isSuperAdmin: nextValue }),
    }),
  });

  const saveDeptConfigMutation = useMutation({
    mutationFn: ({ deptId, form }) => apiFetch(toAbsoluteApiUrl(`/api/d/${encodeURIComponent(deptId)}/config`), {
      method: 'POST',
      body: JSON.stringify({
        tfs: buildTfsPayload(form),
        ...(form.githubToken ? { github: { token: String(form.githubToken).trim() } } : {}),
      }),
    }),
  });

  const testConnectionMutation = useMutation({
    mutationFn: (deptId) => apiFetch(toAbsoluteApiUrl(`/api/departments/${encodeURIComponent(deptId)}/test-connection`), {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  });

  const departments = useMemo(
    () => normalizeDepartmentList(summaryQuery.data, departmentsQuery.data),
    [summaryQuery.data, departmentsQuery.data],
  );

  const effectiveSelectedDeptId = departments.some((dept) => dept.id === selectedDeptId)
    ? selectedDeptId
    : departments[0]?.id || '';

  const selectedDept = useMemo(
    () => departments.find((dept) => dept.id === effectiveSelectedDeptId) || null,
    [departments, effectiveSelectedDeptId],
  );

  const selectedDeptDetailQuery = useQuery({
    queryKey: ['admin', 'department', effectiveSelectedDeptId],
    enabled: Boolean(effectiveSelectedDeptId),
    queryFn: () => apiFetch(toAbsoluteApiUrl(`/api/departments/${encodeURIComponent(effectiveSelectedDeptId)}`)),
  });

  const deptUsersQuery = useQuery({
    queryKey: ['admin', 'department-users', effectiveSelectedDeptId],
    enabled: Boolean(effectiveSelectedDeptId),
    queryFn: () => apiFetch(toAbsoluteApiUrl(`/api/departments/${encodeURIComponent(effectiveSelectedDeptId)}/users`)),
  });

  const deptUsers = Array.isArray(deptUsersQuery.data?.users) ? deptUsersQuery.data.users : [];
  const deptConfigForm = deptConfigDrafts[effectiveSelectedDeptId] ?? toConfigForm(selectedDeptDetailQuery.data?.config);
  const addUserForm = addUserForms[effectiveSelectedDeptId] ?? EMPTY_ADD_USER_FORM;

  // Build role options from the SELECTED dept's custom roles (not the active dept's)
  const selectedDeptCustomRoles = selectedDeptDetailQuery.data?.config?.roles?.custom || [];
  const ROLE_OPTIONS = buildRoleOptions(selectedDeptCustomRoles);
  const allUsers = useMemo(() => normalizeAllUsers(allUsersQuery.data), [allUsersQuery.data]);
  const departmentNameById = useMemo(
    () => new Map(departments.map((dept) => [dept.id, dept.name || dept.id])),
    [departments],
  );

  function updateCreateName(value) {
    setCreateForm((current) => ({
      ...current,
      name: value,
      id: createIdTouched ? current.id : slugifyDepartmentId(value),
    }));
  }

  function updateCreateId(value) {
    setCreateIdTouched(true);
    setCreateForm((current) => ({
      ...current,
      id: slugifyDepartmentId(value),
    }));
  }

  function updateCreateField(field, value) {
    setCreateForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateDeptConfigField(field, value) {
    if (!effectiveSelectedDeptId) return;
    setDeptConfigDrafts((current) => ({
      ...current,
      [effectiveSelectedDeptId]: {
        ...(current[effectiveSelectedDeptId] || toConfigForm(selectedDeptDetailQuery.data?.config)),
        [field]: value,
      },
    }));
  }

  function updateAddUserForm(updater) {
    if (!effectiveSelectedDeptId) return;
    setAddUserForms((current) => {
      const base = current[effectiveSelectedDeptId] || EMPTY_ADD_USER_FORM;
      const next = typeof updater === 'function' ? updater(base) : updater;
      return {
        ...current,
        [effectiveSelectedDeptId]: next,
      };
    });
  }

  function openCloneModal(dept) {
    setCloneModalDept(dept);
    setCloneForm({
      targetId: slugifyDepartmentId(`${dept.id}-copy`),
      targetName: `${dept.name} Copy`,
    });
  }

  async function refreshDepartmentQueries(extraKeys = []) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'departments'] }),
      ...extraKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    ]);
  }

  async function refreshUserQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'department-users', effectiveSelectedDeptId] }),
    ]);
  }

  async function ensureDepartmentForConnectionTest() {
    const payload = buildDepartmentPayload(createForm);
    if (!payload.id || !payload.name) throw new Error('Department ID and Display Name are required.');
    const exists = departments.some((dept) => dept.id === payload.id);

    if (!exists) {
      await createDepartmentMutation.mutateAsync(payload);
      await refreshDepartmentQueries([
        ['admin', 'department', payload.id],
        ['admin', 'department-users', payload.id],
      ]);
      return payload.id;
    }

    await saveDeptConfigMutation.mutateAsync({ deptId: payload.id, form: createForm });
    await refreshDepartmentQueries([
      ['admin', 'department', payload.id],
    ]);
    return payload.id;
  }

  async function handleCreateDepartment(event) {
    event.preventDefault();
    try {
      const payload = buildDepartmentPayload(createForm);
      if (!payload.id || !payload.name) throw new Error('Department ID and Display Name are required.');
      await createDepartmentMutation.mutateAsync(payload);
      setSelectedDeptId(payload.id);
      await refreshDepartmentQueries([
        ['admin', 'department', payload.id],
        ['admin', 'department-users', payload.id],
      ]);
      showBanner('settings', 'success', `Department “${payload.name}” created successfully.`);
    } catch (error) {
      showBanner('settings', 'error', error.message || 'Failed to create department.');
    }
  }

  async function handleTestCreateDepartment() {
    try {
      const deptId = await ensureDepartmentForConnectionTest();
      setSelectedDeptId(deptId);
      const result = await testConnectionMutation.mutateAsync(deptId);
      if (result?.ok) {
        showBanner('settings', 'success', result.user ? `Connection successful: ${result.user}.` : 'Connection successful.');
      } else {
        showBanner('settings', 'error', result?.error || 'Connection failed.');
      }
    } catch (error) {
      showBanner('settings', 'error', error.message || 'Unable to test the connection.');
    }
  }

  async function handleSaveDeptConfig(event) {
    event.preventDefault();
    if (!effectiveSelectedDeptId) return;
    try {
      await saveDeptConfigMutation.mutateAsync({ deptId: effectiveSelectedDeptId, form: deptConfigForm });
      await refreshDepartmentQueries([
        ['admin', 'department', effectiveSelectedDeptId],
      ]);
      showBanner('settings', 'success', `Configuration saved for ${selectedDept?.name || effectiveSelectedDeptId}.`);
    } catch (error) {
      showBanner('settings', 'error', error.message || 'Failed to save department configuration.');
    }
  }

  async function handleSaveMetadata(event) {
    event.preventDefault();
    if (!editDeptModal) return;
    try {
      await updateMetadataMutation.mutateAsync({
        deptId: editDeptModal.id,
        payload: {
          name: String(editMetadataForm.name || '').trim(),
          description: String(editMetadataForm.description || '').trim(),
        },
      });
      await refreshDepartmentQueries([
        ['admin', 'department', editDeptModal.id],
      ]);
      setEditDeptModal(null);
      showBanner('departments', 'success', `Department “${editMetadataForm.name || editDeptModal.id}” updated.`);
    } catch (error) {
      showBanner('departments', 'error', error.message || 'Failed to update department metadata.');
    }
  }

  async function handleCloneDepartment(event) {
    event.preventDefault();
    if (!cloneModalDept) return;
    try {
      const payload = {
        targetId: String(cloneForm.targetId || '').trim(),
        targetName: String(cloneForm.targetName || '').trim(),
      };
      await cloneDepartmentMutation.mutateAsync({ deptId: cloneModalDept.id, payload });
      setSelectedDeptId(payload.targetId);
      await refreshDepartmentQueries([
        ['admin', 'department', payload.targetId],
        ['admin', 'department-users', payload.targetId],
      ]);
      setCloneModalDept(null);
      showBanner('departments', 'success', `Department “${payload.targetName}” cloned from ${cloneModalDept.name}.`);
    } catch (error) {
      showBanner('departments', 'error', error.message || 'Failed to clone department.');
    }
  }

  async function handleDeleteDepartment(dept) {
    try {
      await deleteDepartmentMutation.mutateAsync(dept.id);
      const fallbackDept = departments.find((item) => item.id !== dept.id);
      if (effectiveSelectedDeptId === dept.id) setSelectedDeptId(fallbackDept?.id || '');
      await refreshDepartmentQueries([
        ['admin', 'department', dept.id],
        ['admin', 'department-users', dept.id],
      ]);
      setDeleteTargetId(null);
      setDeleteConfirmValue('');
      showBanner('departments', 'success', `Department “${dept.name}” deleted.`);
    } catch (error) {
      showBanner('departments', 'error', error.message || 'Failed to delete department.');
    }
  }

  async function handleAddUser(event) {
    event.preventDefault();
    if (!effectiveSelectedDeptId) return;
    try {
      const payload = {
        key: String(addUserForm.key || '').trim(),
        displayName: '',
        email: '',
        role: addUserForm.role,
      };
      if (!payload.key) throw new Error('A user key is required.');
      await addDeptUserMutation.mutateAsync({ deptId: effectiveSelectedDeptId, payload });
      setAddUserForms((current) => ({
        ...current,
        [effectiveSelectedDeptId]: EMPTY_ADD_USER_FORM,
      }));
      await refreshUserQueries();
      showBanner('dept-users', 'success', `User ${payload.key} added to ${selectedDept?.name || effectiveSelectedDeptId}.`);
    } catch (error) {
      showBanner('dept-users', 'error', error.message || 'Failed to add the user.');
    }
  }

  async function handleRoleChange(userKey, role) {
    if (!effectiveSelectedDeptId) return;
    try {
      await updateDeptUserRoleMutation.mutateAsync({ deptId: effectiveSelectedDeptId, userKey, role });
      await refreshUserQueries();
      showBanner('dept-users', 'success', `Updated ${userKey} to ${role}.`);
    } catch (error) {
      showBanner('dept-users', 'error', error.message || 'Failed to update the user role.');
    }
  }

  async function handleRemoveUser(userKey) {
    if (!effectiveSelectedDeptId) return;
    try {
      await removeDeptUserMutation.mutateAsync({ deptId: effectiveSelectedDeptId, userKey });
      await refreshUserQueries();
      showBanner('dept-users', 'success', `Removed ${userKey} from ${selectedDept?.name || effectiveSelectedDeptId}.`);
    } catch (error) {
      showBanner('dept-users', 'error', error.message || 'Failed to remove the user.');
    }
  }

  async function handleToggleSuperAdmin(targetUser) {
    try {
      await toggleSuperAdminMutation.mutateAsync({
        userKey: targetUser.key,
        isSuperAdmin: !targetUser.isSuperAdmin,
      });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'summary'] });
      showBanner('users', 'success', `${targetUser.displayName || targetUser.key} updated.`);
    } catch (error) {
      showBanner('users', 'error', error.message || 'Failed to update super-admin access.');
    }
  }

  if (!isSuperAdmin) {
    return (
      <Panel title="⚙️ System Admin" subtitle="Super-admin access is required.">
        <EmptyState title="Access restricted" description="This panel is for super-admins only. Dept admins can manage their team via Settings → Members." />
      </Panel>
    );
  }

  const [deptSearch, setDeptSearch]       = useState('');
  const [deptDetailTab, setDeptDetailTab] = useState('members'); // 'members' | 'policies' | 'connection'
  const [addDeptOpen, setAddDeptOpen]     = useState(false);
  const [userSearch, setUserSearch]       = useState('');

  const tabs = [
    { id: 'departments', icon: '🏢', label: 'Departments' },
    { id: 'users',       icon: '👥', label: 'All Users' },
    { id: 'metrics',     icon: '📊', label: 'Observability' },
  ];

  const activeSummary = summaryQuery.data || {};
  const filteredDepts = departments.filter(d =>
    !deptSearch || (d.name || d.id).toLowerCase().includes(deptSearch.toLowerCase())
  );
  const filteredUsers = allUsers.filter(u =>
    !userSearch || (u.displayName || u.key || u.email || '').toLowerCase().includes(userSearch.toLowerCase())
  );

  const P = { padding: '12px 16px' };
  const headerStyle = { padding: '10px 16px', borderBottom: `1px solid ${COLORS.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
  const tabLineStyle = (active) => ({
    padding: '10px 18px', cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 400,
    color: active ? COLORS.accent : COLORS.muted, background: 'none', border: 'none',
    borderBottom: active ? `2px solid ${COLORS.accent}` : '2px solid transparent',
    outline: 'none', marginBottom: -1,
  });
  const chip = { padding: '4px 12px', borderRadius: 0, background: 'rgba(20,146,255,.12)', color: COLORS.accent, fontSize: 12, fontWeight: 700 };
  const inputStyle = { padding: '7px 10px', borderRadius: 0, border: `1px solid ${COLORS.border}`, background: COLORS.surface2, color: COLORS.text, fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' };

  return (
    <div style={{ padding: '4px 0 24px', color: COLORS.text }}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>⚙️ System Administration</div>
          <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 3 }}>Manage departments, users and global access controls</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { icon: '🏢', val: activeSummary.deptCount, lbl: 'Departments' },
            { icon: '👥', val: activeSummary.totalUsers, lbl: 'Users' },
            { icon: '🛡', val: activeSummary.superAdminCount, lbl: 'Super Admins' },
          ].map(s => (
            <div key={s.lbl} style={{ padding: '6px 14px', background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 0, textAlign: 'center', minWidth: 80 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.accent }}>{s.val ?? (summaryQuery.isLoading ? '…' : '0')}</div>
              <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 1 }}>{s.lbl}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Top tab nav ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${COLORS.border}`, marginBottom: 20 }}>
        {tabs.map(t => (
          <button key={t.id} style={tabLineStyle(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Departments tab ─────────────────────────────────────────────── */}
      {activeTab === 'departments' && (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' }}>

          {/* Left: dept list */}
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 0, overflow: 'hidden' }}>
            <div style={{ ...headerStyle, gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>Departments</span>
              <button onClick={() => { setAddDeptOpen(v => !v); setActiveTab('departments'); }}
                style={{ padding: '4px 10px', borderRadius: 0, border: `1px solid ${COLORS.accent}`, background: addDeptOpen ? COLORS.accent : 'transparent', color: addDeptOpen ? '#fff' : COLORS.accent, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {addDeptOpen ? '✕ Cancel' : '＋ New'}
              </button>
            </div>
            <div style={{ padding: '8px 12px' }}>
              <input style={inputStyle} placeholder="🔍 Search…" value={deptSearch} onChange={e => setDeptSearch(e.target.value)} />
            </div>
            <div style={{ maxHeight: 480, overflowY: 'auto' }}>
              {departmentsQuery.isLoading ? (
                <div style={{ padding: 16, color: COLORS.muted, fontSize: 13 }}>Loading…</div>
              ) : filteredDepts.length === 0 ? (
                <div style={{ padding: 16, color: COLORS.muted, fontSize: 13 }}>No departments found.</div>
              ) : filteredDepts.map(d => {
                const isSel = d.id === effectiveSelectedDeptId;
                return (
                  <button key={d.id} onClick={() => { setSelectedDeptId(d.id); setAddDeptOpen(false); setDeptDetailTab('members'); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', cursor: 'pointer', border: 'none', borderBottom: `1px solid ${COLORS.border}`, background: isSel ? 'rgba(20,146,255,.10)' : 'transparent', borderLeft: isSel ? `3px solid ${COLORS.accent}` : '3px solid transparent', transition: 'all .12s' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <div style={{ fontWeight: isSel ? 700 : 500, color: isSel ? COLORS.text : COLORS.text, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name || d.id}</div>
                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 0, background: d.hasPat ? 'rgba(6,132,67,.2)' : 'rgba(245,166,35,.2)', color: d.hasPat ? '#4ade80' : COLORS.warning, flexShrink: 0 }}>
                        {d.hasPat ? '✓ PAT' : '⚠ PAT'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 2 }}>
                      {d.id}{d.memberCount ? ` · ${d.memberCount} member${d.memberCount !== 1 ? 's' : ''}` : ''}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: detail panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Add dept form */}
            {addDeptOpen && (
              <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 0, overflow: 'hidden' }}>
                <div style={headerStyle}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>➕ New Department</span>
                </div>
                <div style={{ padding: 16 }}>
                  <Banner banner={banners.settings} />
                  <form onSubmit={handleCreateDepartment} style={{ display: 'grid', gap: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <Field label="Display Name"><TextInput value={createForm.name} onChange={e => updateCreateName(e.target.value)}                       placeholder="Healthcare IT" /></Field>
                      <Field label="Dept ID" hint="URL-safe slug"><TextInput value={createForm.id} onChange={e => updateCreateId(e.target.value)} placeholder="healthcare-it" /></Field>
                    </div>
                    <Field label="TFS Base URL"><TextInput type="url" value={createForm.baseUrl} onChange={e => updateCreateField('baseUrl', e.target.value)} placeholder="https://tfs.yourorg.com/tfs/…" /></Field>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <Field label="TFS Org"><TextInput value={createForm.organization} onChange={e => updateCreateField('organization', e.target.value)} placeholder="YourOrg" /></Field>
                      <Field label="TFS Project"><TextInput value={createForm.project} onChange={e => updateCreateField('project', e.target.value)} placeholder="YourProject" /></Field>
                    </div>
                    <Field label="PAT Token"><TextInput type="password" value={createForm.pat} onChange={e => updateCreateField('pat', e.target.value)} placeholder="Personal Access Token" /></Field>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <Field label="Area Path"><TextInput value={createForm.areaPath} onChange={e => updateCreateField('areaPath', e.target.value)} placeholder="YourProject\YourTeam" /></Field>
                      <Field label="Iteration Path"><TextInput value={createForm.iterationPath} onChange={e => updateCreateField('iterationPath', e.target.value)} placeholder="YourProject\YourTeam" /></Field>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button type="button" onClick={() => setAddDeptOpen(false)} style={getButtonStyle('secondary')}>Cancel</button>
                      <button type="submit" disabled={createDepartmentMutation.isPending} style={getButtonStyle('primary', createDepartmentMutation.isPending)}>
                        {createDepartmentMutation.isPending ? 'Creating…' : 'Create Department'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Selected dept detail */}
            {!addDeptOpen && !selectedDept && (
              <div style={{ padding: 40, textAlign: 'center', color: COLORS.muted, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 0 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🏢</div>
                <div style={{ fontWeight: 600, fontSize: 15, color: COLORS.text }}>Select a department</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>Choose a department from the list to view details, members and connection settings.</div>
              </div>
            )}

            {selectedDept && !addDeptOpen && (
              <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 0, overflow: 'hidden' }}>
                {/* Dept header */}
                <div style={{ ...headerStyle, padding: '14px 20px' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 17 }}>{selectedDept.name}</div>
                    <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
                      ID: <code style={{ color: COLORS.text }}>{selectedDept.id}</code>
                      &nbsp;·&nbsp;{selectedDept.memberCount || 0} members
                      &nbsp;·&nbsp;<span style={{ color: selectedDept.hasPat ? '#4ade80' : COLORS.warning }}>{selectedDept.hasPat ? '✓ PAT configured' : '⚠ PAT missing'}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setEditDeptModal(selectedDept); setEditMetadataForm({ name: selectedDept.name || '', description: selectedDept.description || '' }); }} style={getButtonStyle('secondary')}>✏️ Rename</button>
                    <button onClick={() => openCloneModal(selectedDept)} style={getButtonStyle('secondary')}>⎘ Clone</button>
                    {selectedDept.id !== 'default' && (
                      deleteTargetId === selectedDept.id ? (
                        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <TextInput style={{ width: 120, padding: '6px 8px', fontSize: 12 }} placeholder={`type "${selectedDept.id}"`} value={deleteConfirmValue} onChange={e => setDeleteConfirmValue(e.target.value)} />
                          <button onClick={() => handleDeleteDepartment({ preventDefault: () => {} })} disabled={deleteConfirmValue !== selectedDept.id || deleteDepartmentMutation.isPending} style={getButtonStyle('danger', deleteConfirmValue !== selectedDept.id)}>Confirm Delete</button>
                          <button onClick={() => { setDeleteTargetId(null); setDeleteConfirmValue(''); }} style={getButtonStyle('secondary')}>Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => setDeleteTargetId(selectedDept.id)} style={getButtonStyle('danger')}>🗑 Delete</button>
                      )
                    )}
                  </div>
                </div>

                {/* Detail sub-tabs */}
                <div style={{ display: 'flex', borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface2 }}>
                  {[{ id: 'members', label: '👥 Members' }, { id: 'policies', label: '🔒 Roles & Visibility' }, { id: 'connection', label: '🔌 Connection' }].map(t => (
                    <button key={t.id} style={tabLineStyle(deptDetailTab === t.id)} onClick={() => setDeptDetailTab(t.id)}>{t.label}</button>
                  ))}
                </div>

                {/* Members sub-tab */}
                {deptDetailTab === 'members' && (
                  <div style={P}>
                    <Banner banner={banners['dept-users']} />
                    {deptUsersQuery.error && <Banner banner={{ type: 'error', message: deptUsersQuery.error.message }} />}
                    {deptUsersQuery.isLoading ? (
                      <div style={{ color: COLORS.muted, fontSize: 13 }}>Loading members…</div>
                    ) : (
                      <>
                        {deptUsers.length > 0 && (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
                            <thead>
                              <tr>{['User', 'Key', 'Role', ''].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: COLORS.muted, fontWeight: 500, borderBottom: `1px solid ${COLORS.border}`, fontSize: 12 }}>{h}</th>)}</tr>
                            </thead>
                            <tbody>
                              {deptUsers.map(m => (
                                <tr key={m.key} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                                  <td style={{ padding: '9px 10px' }}>
                                    <div style={{ fontWeight: 600 }}>{m.displayName || '—'}</div>
                                    {m.email && <div style={{ fontSize: 11, color: COLORS.muted }}>{m.email}</div>}
                                  </td>
                                  <td style={{ padding: '9px 10px', color: COLORS.muted, fontSize: 11, fontFamily: 'monospace' }}>{m.key}</td>
                                  <td style={{ padding: '9px 10px' }}>
                                    <SelectInput value={m.role} disabled={updateDeptUserRoleMutation.isPending && updateDeptUserRoleMutation.variables?.userKey === m.key} onChange={e => handleRoleChange(m.key, e.target.value)} style={{ padding: '4px 8px', fontSize: 12 }}>
                                      {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                    </SelectInput>
                                  </td>
                                  <td style={{ padding: '9px 10px' }}>
                                    <button onClick={() => handleRemoveUser(m.key)} disabled={removeDeptUserMutation.isPending && removeDeptUserMutation.variables?.userKey === m.key} style={getButtonStyle('danger')}>Remove</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        <div style={{ borderTop: deptUsers.length > 0 ? `1px solid ${COLORS.border}` : 'none', paddingTop: deptUsers.length > 0 ? 14 : 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Add user to {selectedDept.name}</div>
                          <form onSubmit={handleAddUser} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <Field label="User Key" hint="e.g. tfs:domain\user">
                              <TextInput value={addUserForm.key} onChange={e => updateAddUserForm(f => ({ ...f, key: e.target.value }))} placeholder="tfs:domain\username" style={{ width: 220 }} />
                            </Field>
                            <Field label="Role">
                              <SelectInput value={addUserForm.role} onChange={e => updateAddUserForm(f => ({ ...f, role: e.target.value }))}>
                                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                              </SelectInput>
                            </Field>
                            <button type="submit" disabled={addDeptUserMutation.isPending} style={getButtonStyle('primary', addDeptUserMutation.isPending)}>
                              {addDeptUserMutation.isPending ? 'Adding…' : 'Add'}
                            </button>
                          </form>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Policies sub-tab */}
                {deptDetailTab === 'policies' && (
                  <DeptPoliciesTab key={selectedDept.id} deptId={selectedDept.id} />
                )}

                {/* Connection sub-tab */}
                {deptDetailTab === 'connection' && (
                  <div style={P}>
                    {!selectedDeptDetailQuery.data && selectedDeptDetailQuery.isLoading ? (
                      <div style={{ color: COLORS.muted, fontSize: 13 }}>Loading config…</div>
                    ) : (
                      <form onSubmit={handleSaveDeptConfig} style={{ display: 'grid', gap: 12 }}>
                        <Field label="TFS Base URL"><TextInput type="url" value={deptConfigForm.baseUrl} onChange={e => updateDeptConfigField('baseUrl', e.target.value)} placeholder="https://…" /></Field>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <Field label="TFS Organization"><TextInput value={deptConfigForm.organization} onChange={e => updateDeptConfigField('organization', e.target.value)} placeholder="YourOrg" /></Field>
                          <Field label="TFS Project"><TextInput value={deptConfigForm.project} onChange={e => updateDeptConfigField('project', e.target.value)} placeholder="YourProject" /></Field>
                        </div>
                        <Field label="New PAT Token" hint="Leave blank to keep current"><TextInput type="password" value={deptConfigForm.pat} onChange={e => updateDeptConfigField('pat', e.target.value)} placeholder="Enter to update PAT" /></Field>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <Field label="Area Path"><TextInput value={deptConfigForm.areaPath} onChange={e => updateDeptConfigField('areaPath', e.target.value)} placeholder="YourProject\YourTeam" /></Field>
                          <Field label="Iteration Path"><TextInput value={deptConfigForm.iterationPath} onChange={e => updateDeptConfigField('iterationPath', e.target.value)} placeholder="YourProject\YourTeam" /></Field>
                        </div>
                        <Field label="GitHub Token (for Test Coverage)" hint="Leave blank to keep current"><TextInput type="password" value={deptConfigForm.githubToken} onChange={e => updateDeptConfigField('githubToken', e.target.value)} placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" /></Field>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button type="button" disabled={saveDeptConfigMutation.isPending || testConnectionMutation.isPending} onClick={() => handleTestCreateDepartment({ preventDefault: () => {} })} style={getButtonStyle('secondary', testConnectionMutation.isPending)}>
                            {testConnectionMutation.isPending ? 'Testing…' : '⚡ Test Connection'}
                          </button>
                          <button type="submit" disabled={saveDeptConfigMutation.isPending} style={getButtonStyle('primary', saveDeptConfigMutation.isPending)}>
                            {saveDeptConfigMutation.isPending ? 'Saving…' : '💾 Save Connection'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── All Users tab ───────────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 0, overflow: 'hidden' }}>
          <div style={{ ...headerStyle, padding: '14px 20px' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>👥 All Users</div>
              <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>Audit access across all departments. Toggle super-admin privileges here.</div>
            </div>
            <input style={{ ...inputStyle, width: 220 }} placeholder="🔍 Search users…" value={userSearch} onChange={e => setUserSearch(e.target.value)} />
          </div>
          <Banner banner={banners.users} />
          {allUsersQuery.error && <div style={{ padding: '10px 20px', color: COLORS.danger, fontSize: 13 }}>{allUsersQuery.error.message}</div>}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
              <thead>
                <tr>{['User', 'Key', 'Departments', 'Super Admin', 'Last Login'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: COLORS.muted, fontWeight: 500, borderBottom: `1px solid ${COLORS.border}`, fontSize: 12 }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: '20px 16px', color: COLORS.muted }}>No users found.</td></tr>
                ) : filteredUsers.map(u => (
                  <tr key={u.key} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ fontWeight: 600 }}>{u.displayName || '—'}</div>
                      {u.email && <div style={{ fontSize: 11, color: COLORS.muted }}>{u.email}</div>}
                    </td>
                    <td style={{ padding: '10px 16px', color: COLORS.muted, fontSize: 11, fontFamily: 'monospace' }}>{u.key}</td>
                    <td style={{ padding: '10px 16px', fontSize: 12 }}>
                      {Array.isArray(u.departments) && u.departments.length > 0
                        ? u.departments.map(d => <span key={d.id} style={{ ...chip, marginRight: 4, display: 'inline-block', marginBottom: 2 }}>{departmentNameById.get(d.id) || d.id}</span>)
                        : <span style={{ color: COLORS.muted }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Toggle checked={Boolean(u.isSuperAdmin)} disabled={toggleSuperAdminMutation.isPending && toggleSuperAdminMutation.variables?.userKey === u.key} onClick={() => handleToggleSuperAdmin(u)} />
                        <span style={{ fontSize: 12, color: u.isSuperAdmin ? COLORS.accent : COLORS.muted }}>{u.isSuperAdmin ? 'Super Admin' : 'Regular'}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 16px', color: COLORS.muted, fontSize: 12 }}>{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Observability / Metrics tab ─────────────────────────────────── */}
      {activeTab === 'metrics' && <MetricsTab />}

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {cloneModalDept ? (
        <ModalFrame title="⎘ Clone Department" subtitle={`Copy ${cloneModalDept.name}'s TFS config into a new department.`} onClose={() => setCloneModalDept(null)}>
          <form onSubmit={handleCloneDepartment} style={{ display: 'grid', gap: 14 }}>
            <Field label="New Department ID"><TextInput value={cloneForm.targetId} onChange={e => setCloneForm(c => ({ ...c, targetId: slugifyDepartmentId(e.target.value) }))} placeholder="healthcare-it-copy" /></Field>
            <Field label="Display Name"><TextInput value={cloneForm.targetName} onChange={e => setCloneForm(c => ({ ...c, targetName: e.target.value }))} placeholder="Healthcare IT Copy" /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setCloneModalDept(null)} style={getButtonStyle('secondary')}>Cancel</button>
              <button type="submit" disabled={cloneDepartmentMutation.isPending} style={getButtonStyle('primary', cloneDepartmentMutation.isPending)}>{cloneDepartmentMutation.isPending ? 'Cloning…' : 'Clone'}</button>
            </div>
          </form>
        </ModalFrame>
      ) : null}

      {editDeptModal ? (
        <ModalFrame title="✏️ Rename Department" subtitle="Update the display name only. The ID cannot be changed." onClose={() => setEditDeptModal(null)}>
          <form onSubmit={handleSaveMetadata} style={{ display: 'grid', gap: 14 }}>
            <Field label="Display Name"><TextInput value={editMetadataForm.name} onChange={e => setEditMetadataForm(f => ({ ...f, name: e.target.value }))} placeholder="YourProject" /></Field>
            <Field label="Description (optional)"><TextArea value={editMetadataForm.description} onChange={e => setEditMetadataForm(f => ({ ...f, description: e.target.value }))} placeholder="Short description of this department" /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={() => setEditDeptModal(null)} style={getButtonStyle('secondary')}>Cancel</button>
              <button type="submit" disabled={updateMetadataMutation.isPending} style={getButtonStyle('primary', updateMetadataMutation.isPending)}>{updateMetadataMutation.isPending ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </ModalFrame>
      ) : null}
    </div>
  );
}
