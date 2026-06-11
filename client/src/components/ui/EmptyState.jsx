export default function EmptyState({ icon, title, message, action }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '48px 32px',
      gap: 12,
      textAlign: 'center',
      color: 'var(--muted)',
    }}>
      {icon && <div style={{ opacity: 0.5, marginBottom: 4 }}>{icon}</div>}
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {message && <div style={{ fontSize: 13, maxWidth: 320, lineHeight: 1.6 }}>{message}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
