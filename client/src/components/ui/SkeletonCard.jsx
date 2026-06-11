export function SkeletonLine({ width = '100%', height = 12 }) {
  return (
    <div style={{
      width,
      height,
      borderRadius: 4,
      background: 'linear-gradient(90deg, var(--surface, #161b22) 25%, var(--surface2, #1c2230) 50%, var(--surface, #161b22) 75%)',
      backgroundSize: '200% 100%',
      animation: 'skeleton-shimmer 1.5s infinite',
    }} />
  );
}

export function SkeletonCard({ rows = 4, height = 120 }) {
  return (
    <div style={{
      background: 'var(--surface, #161b22)',
      border: '1px solid var(--border, #30363d)',
      borderRadius: 8,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      height,
    }}>
      <SkeletonLine width="60%" height={14} />
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonLine key={i} width={`${60 + (i * 9) % 35}%`} />
      ))}
    </div>
  );
}

export function SkeletonSection() {
  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[1, 2, 3, 4].map(i => <SkeletonCard key={i} height={80} rows={2} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <SkeletonCard height={200} rows={5} />
        <SkeletonCard height={200} rows={5} />
      </div>
    </div>
  );
}
