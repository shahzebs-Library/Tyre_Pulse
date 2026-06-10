import { Component } from 'react'
import { RefreshCw } from 'lucide-react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info)
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#020704',
          padding: '24px 20px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{
          width: 56, height: 56, borderRadius: 16, marginBottom: 20,
          background: 'rgba(239,68,68,0.1)', border: '1.5px solid rgba(239,68,68,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 28 }}>⚠️</span>
        </div>
        <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: '0 0 8px', textAlign: 'center' }}>
          Something went wrong
        </h2>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', maxWidth: 300, lineHeight: 1.6, margin: '0 0 24px' }}>
          TyrePulse encountered an unexpected error. Reload to continue.
        </p>
        {import.meta.env.DEV && this.state.error && (
          <pre style={{
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: 10, padding: '10px 14px', fontSize: 11, color: '#fca5a5',
            maxWidth: 360, overflow: 'auto', marginBottom: 20, whiteSpace: 'pre-wrap',
          }}>
            {this.state.error.message}
          </pre>
        )}
        <button
          onClick={() => window.location.reload()}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '11px 24px', borderRadius: 12, border: 'none',
            background: 'linear-gradient(135deg, #16a34a, #15803d)',
            color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(22,163,74,0.35)',
          }}
        >
          <RefreshCw size={15} />
          Reload App
        </button>
      </div>
    )
  }
}
