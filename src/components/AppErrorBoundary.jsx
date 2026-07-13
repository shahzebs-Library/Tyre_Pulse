import { Component } from 'react'
import { RefreshCw, ChevronDown } from 'lucide-react'
import { captureError } from '../lib/monitoring'
import { Illustration } from './illustrations'

/**
 * Root application error boundary.
 *
 * Catches render-time crashes anywhere in the tree, reports them to
 * monitoring (no-op when no Sentry DSN is configured), and shows a
 * theme-token-styled fallback with a reload action and collapsible
 * technical details. Styled entirely with CSS variables from index.css
 * so it respects light/dark themes.
 */
export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, componentStack: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    this.setState({ componentStack: info?.componentStack ?? null })
    captureError(error, {
      boundary: 'app-root',
      componentStack: info?.componentStack ?? null,
    })
    console.error('[AppErrorBoundary]', error, info)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const message = this.state.error?.message || String(this.state.error ?? 'Unknown error')
    const stack = this.state.componentStack?.trim()

    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-5 py-8"
        style={{ background: 'var(--bg-base)' }}
        role="alert"
      >
        <div className="mb-5">
          <Illustration name="state/error" size={220} title="Something went wrong" />
        </div>

        <h1 className="text-h2 text-center mb-2">Something went wrong</h1>
        <p className="text-body text-center max-w-sm mb-6">
          TyrePulse hit an unexpected error. Reloading usually fixes it. Your
          data is safe and nothing was lost.
        </p>

        <button type="button" className="btn-primary" onClick={this.handleReload}>
          <span className="inline-flex items-center gap-2">
            <RefreshCw size={15} />
            Reload page
          </span>
        </button>

        {/*
          Technical details (raw error message + React component stack) are a
          potential information-disclosure vector, so they are shown ONLY in
          development. Production users see the friendly message above; the
          error is still captured to monitoring in componentDidCatch.
        */}
        {import.meta.env.DEV && (
          <details className="mt-6 w-full max-w-md group">
            <summary
              className="text-caption cursor-pointer select-none inline-flex items-center gap-1"
              style={{ color: 'var(--text-muted)' }}
            >
              <ChevronDown size={13} className="transition-transform group-open:rotate-180" />
              Technical details
            </summary>
            <pre
              className="mt-2 rounded-xl p-3 text-left overflow-auto"
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--border-dim)',
                color: 'var(--text-secondary)',
                fontSize: 11,
                lineHeight: 1.5,
                maxHeight: 220,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {message}
              {stack ? `\n\n${stack.split('\n').slice(0, 10).join('\n')}` : ''}
            </pre>
          </details>
        )}
      </div>
    )
  }
}
