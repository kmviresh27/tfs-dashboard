import { Component } from 'react';

export default class SectionErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[SectionErrorBoundary]', this.props.section, error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const { section = 'section', onRetry } = this.props;
    const msg = this.state.error?.message || 'Unknown error';

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '60vh', gap: 16, padding: 32, textAlign: 'center',
      }}>
        <div style={{ fontSize: 48 }}>⚠️</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--danger, #eb3f3f)' }}>
          {section} failed to load
        </div>
        <div style={{
          fontSize: 13, color: 'var(--text-muted, #888)', maxWidth: 480,
          fontFamily: 'Consolas, monospace', background: 'var(--surface2, #1e1e2e)',
          padding: '10px 16px', borderRadius: 4, wordBreak: 'break-all',
        }}>
          {msg}
        </div>
        <button
          className="btn-primary"
          onClick={() => {
            this.setState({ hasError: false, error: null });
            onRetry?.();
          }}
        >
          ↻ Retry
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-muted, #888)' }}>
          Check the browser console for full details.
        </span>
      </div>
    );
  }
}
