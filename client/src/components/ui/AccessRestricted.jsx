export default function AccessRestricted({ section, adminEmail, onGoBack }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '60vh',
      gap: 16,
      textAlign: 'center',
      padding: 32,
    }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ color: 'var(--muted)' }}>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
          Access Restricted
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 13, maxWidth: 380 }}>
          You don&apos;t have permission to view <strong style={{ color: 'var(--text)' }}>{section}</strong>. Contact your administrator to request access.
        </div>
      </div>
      {adminEmail && (
        <a
          href={`mailto:${adminEmail}?subject=Access Request — ${section}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(20,146,255,0.1)',
            border: '1px solid rgba(20,146,255,0.3)',
            color: 'var(--primary)',
            padding: '8px 16px',
            borderRadius: 6,
            fontSize: 13,
            textDecoration: 'none',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,12 2,6" />
          </svg>
          Email Admin
        </a>
      )}
      <button
        onClick={onGoBack}
        style={{
          background: 'none',
          border: '1px solid var(--border)',
          color: 'var(--muted)',
          padding: '6px 14px',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        ← Go Back
      </button>
    </div>
  );
}
