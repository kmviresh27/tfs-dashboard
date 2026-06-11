/**
 * Centralized loading components.
 * PageLoader  – full-section centered spinner (use for top-level isLoading guards)
 * CardLoader  – compact spinner inside a card/panel
 */

export function PageLoader({ label = 'Loading…' }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      height: '60vh', gap: 16,
    }}>
      <div className="loading-spinner" />
      <span className="loading-text">{label}</span>
    </div>
  );
}

export function CardLoader({ label = 'Loading…' }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '32px 16px', gap: 12,
    }}>
      <div className="loading-spinner" style={{ width: 28, height: 28, borderWidth: 2 }} />
      <span className="loading-text" style={{ fontSize: 12 }}>{label}</span>
    </div>
  );
}
