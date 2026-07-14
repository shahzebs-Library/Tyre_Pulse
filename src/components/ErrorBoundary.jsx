import { Component } from 'react'
import { RefreshCw } from 'lucide-react'
import { captureError } from '../lib/monitoring'

/**
 * Generate a short, human-quotable error reference id (e.g. "ERR-1A2B3C4D").
 * Time + randomness sourced, uppercase base36, resilient — never throws.
 */
function makeReferenceId() {
  try {
    const rand = Math.random().toString(36).slice(2)
    const time = Date.now().toString(36)
    const raw = (time + rand).replace(/[^a-z0-9]/gi, '')
    return 'ERR-' + raw.slice(-8).toUpperCase().padStart(8, '0')
  } catch {
    return 'ERR-00000000'
  }
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, componentStack: null, referenceId: null, copied: false }
  }

  static getDerivedStateFromError(error) {
    // Reference id is generated here so it exists even if componentDidCatch
    // is skipped; never throws.
    return { hasError: true, error, referenceId: makeReferenceId() }
  }

  componentDidCatch(error, info) {
    const componentStack = info?.componentStack ?? null
    const referenceId = this.state.referenceId || makeReferenceId()
    this.setState({ componentStack, referenceId })
    try {
      captureError(error, { boundary: 'page', componentStack, referenceId })
    } catch { /* monitoring must never break the boundary */ }
    console.error('[ErrorBoundary]', referenceId, error, info)
  }

  handleCopy = () => {
    const id = this.state.referenceId
    if (!id) return
    try {
      navigator.clipboard?.writeText(id)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2000)
    } catch { /* copy is best-effort */ }
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
        <h2 style={{ color:'var(--panel-ink)', fontSize: 18, fontWeight: 700, margin: '0 0 8px', textAlign: 'center' }}>
          Something went wrong
        </h2>
        <p style={{ color:'var(--text-muted)', fontSize: 13, textAlign: 'center', maxWidth: 320, lineHeight: 1.6, margin: '0 0 20px' }}>
          TyrePulse encountered an unexpected error. Please reload to continue, and quote the reference below if you contact support.
        </p>
        {this.state.referenceId && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10, padding: '10px 14px', marginBottom: 24,
            maxWidth: 360, width: '100%',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
              <span style={{ color:'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Reference ID
              </span>
              <code style={{ color:'var(--panel-ink)', fontSize: 14, fontWeight: 700, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                {this.state.referenceId}
              </code>
            </div>
            <button
              onClick={this.handleCopy}
              style={{
                padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)',
                color:'var(--panel-ink)', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
              }}
            >
              {this.state.copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
        {import.meta.env.DEV === true && this.state.error && (
          <pre style={{
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: 10, padding: '10px 14px', fontSize: 11, color: '#fca5a5',
            maxWidth: 360, width: '100%', overflow: 'auto', marginBottom: 12,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', textAlign: 'left',
          }}>
            {this.state.error.message || String(this.state.error)}
          </pre>
        )}
        {import.meta.env.DEV === true && this.state.componentStack && (
          <pre style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 10, padding: '10px 14px', fontSize: 9, color:'var(--text-muted)',
            maxWidth: 360, width: '100%', overflow: 'auto', marginBottom: 20,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', textAlign: 'left',
          }}>
            {this.state.componentStack.trim().split('\n').slice(0, 8).join('\n')}
          </pre>
        )}
        <button
          onClick={() => window.location.reload()}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '11px 24px', borderRadius: 12, border: 'none',
            background: 'linear-gradient(135deg, #16a34a, #15803d)',
            color:'var(--panel-ink)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
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
