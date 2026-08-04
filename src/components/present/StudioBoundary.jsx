/**
 * StudioBoundary - a local error boundary around the Presentation Studio.
 *
 * WHY: the Chart Builder is an ADDITIVE section on pages that already work
 * (Expenses, Cost per M3, Board Overview). If anything inside the studio throws
 * during render, React unwinds to the nearest boundary - without this, that is
 * the whole page, so a studio glitch would blank Expenses/CPK ("many things
 * failed to load"). This confines any studio failure to the studio card and
 * shows a calm notice, leaving the rest of the page untouched.
 */
import { Component } from 'react'

export default class StudioBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    // Best-effort, never re-throw: the host page must keep working.
    try {
      if (typeof window !== 'undefined' && import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[ChartBuilder] contained render error:', error)
      }
    } catch { /* ignore */ }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="card text-sm text-[var(--text-muted)]">
          The chart builder could not render for the current selection. The rest
          of this page is unaffected - try a different chart or reload.
        </div>
      )
    }
    return this.props.children
  }
}
