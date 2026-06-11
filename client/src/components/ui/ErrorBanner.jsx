export default function ErrorBanner({ message, onClose }) {
  if (!message) return null;
  return (
    <div style={{ background: '#c0392b', color: '#fff', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, flexShrink: 0 }}>
      <span>❌ {message}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16 }}>✕</button>
    </div>
  );
}
