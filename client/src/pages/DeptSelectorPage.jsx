import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import useStore from '../store/useStore.js';
import { switchDeptApi } from '../api/apiClient.js';

function DeptCard({ dept, onEnter, loading }) {
  const roleColor = { admin: '#1492ff', editor: '#f5a623', viewer: '#4caf50' };
  const roleIcon  = { admin: '🛡', editor: '✏️', viewer: '👁' };
  const role = dept.userRole || 'viewer';

  return (
    <div
      style={{
        background: 'var(--surface, #161620)',
        border: '1px solid var(--border, #2a2a3a)',
        borderRadius: 12,
        padding: '28px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        cursor: 'pointer',
        transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.15s',
        position: 'relative',
        overflow: 'hidden',
      }}
      onClick={() => !loading && onEnter(dept)}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--accent, #1492ff)';
        e.currentTarget.style.boxShadow   = '0 0 0 1px var(--accent, #1492ff), 0 8px 32px rgba(20,146,255,.15)';
        e.currentTarget.style.transform   = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border, #2a2a3a)';
        e.currentTarget.style.boxShadow   = '';
        e.currentTarget.style.transform   = '';
      }}
    >
      {/* Accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, var(--accent, #1492ff) 0%, transparent 100%)`,
        borderRadius: '12px 12px 0 0',
      }} />

      {/* Dept name */}
      <div style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.3, marginTop: 4 }}>
        {dept.name || dept.id}
      </div>

      {/* Description */}
      {dept.description && (
        <div style={{ fontSize: 13, color: 'var(--text-muted, #888)', lineHeight: 1.5 }}>
          {dept.description}
        </div>
      )}

      {/* TFS org pill */}
      {dept.tfsOrg && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, color: 'var(--text-muted, #888)',
          background: 'var(--surface2, #1e1e2e)', borderRadius: 4,
          padding: '3px 8px', alignSelf: 'flex-start',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <path d="M8 12h8M12 8v8"/>
          </svg>
          {dept.tfsOrg}
        </div>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Footer row: role + Enter btn */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{
          fontSize: 12, fontWeight: 600,
          color: roleColor[role] || '#888',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <span>{roleIcon[role] || '👤'}</span>
          {role.charAt(0).toUpperCase() + role.slice(1)}
        </span>

        <button
          disabled={loading}
          style={{
            background: 'var(--accent, #1492ff)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.6 : 1,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
          onClick={e => { e.stopPropagation(); !loading && onEnter(dept); }}
        >
          {loading ? '…' : <>Enter <span style={{ fontSize: 16, lineHeight: 1 }}>→</span></>}
        </button>
      </div>
    </div>
  );
}

export default function DeptSelectorPage({ onSelected }) {
  const setActiveDept = useStore(s => s.setActiveDept);
  const branding      = useStore(s => s.branding);
  const [entering, setEntering] = useState(null);
  const [error, setError]       = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['auth-departments'],
    queryFn: () => fetch('/api/auth/departments').then(r => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  const depts = data?.departments || [];

  async function handleEnter(dept) {
    setEntering(dept.id);
    setError('');
    try {
      if (dept.id !== 'default') {
        await switchDeptApi(dept.id);
      }
      setActiveDept(dept);
      // Update URL path to /d/:deptId/
      const search = window.location.search;
      const newPath = dept.id === 'default' ? `/${search}` : `/d/${dept.id}/${search}`;
      window.history.pushState(null, '', newPath);
      onSelected?.(dept);
    } catch (err) {
      setError(err.message || 'Failed to switch department');
    } finally {
      setEntering(null);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg, #0d0d0d)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.5px', marginBottom: 8 }}>
          {branding.companyName && (
            <span style={{ color: 'var(--text-muted, #888)', fontWeight: 400, fontSize: 22, marginRight: 8 }}>
              {branding.companyName} ·
            </span>
          )}
          {branding.appName || 'AV Dashboard'}
        </div>
        <div style={{ color: 'var(--text-muted, #888)', fontSize: 15 }}>
          Select a department to continue
        </div>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20, width: '100%', maxWidth: 900 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{
              background: 'var(--surface, #161620)', borderRadius: 12,
              height: 180, opacity: 0.4,
              animation: 'pulse 1.4s ease-in-out infinite',
            }} />
          ))}
        </div>
      )}

      {/* Dept cards */}
      {!isLoading && depts.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: depts.length === 1 ? '320px' : 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 20,
          width: '100%',
          maxWidth: 900,
        }}>
          {depts.map(dept => (
            <DeptCard
              key={dept.id}
              dept={dept}
              loading={entering === dept.id}
              onEnter={handleEnter}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && depts.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted, #888)', fontSize: 14 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏢</div>
          <div>No departments available.</div>
          <div style={{ marginTop: 6, fontSize: 12 }}>Contact your administrator.</div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          marginTop: 24, padding: '10px 20px',
          background: 'rgba(230,55,55,.15)', border: '1px solid rgba(230,55,55,.4)',
          borderRadius: 6, color: '#e63737', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
