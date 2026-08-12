import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ThemeProvider } from './contexts/ThemeContext'
import AppErrorBoundary from './components/AppErrorBoundary'
import { installChunkRecovery, markAppRendered } from './lib/chunkRecovery'

// Registered FIRST, before anything else can fail. A stale service worker can
// leave this document pointing at chunks that no longer exist; without this the
// page simply paints nothing and only a manual refresh recovers it.
installChunkRecovery()

// Resolve CSS theme tokens (var(--…)) inside every Chart.js canvas globally.
//
// Imported DYNAMICALLY on purpose. A static import here put all 213 kB of
// chart.js into the eager startup graph, so every user - including one sitting
// on the login form - downloaded and parsed a charting library before the first
// pixel. Every page that actually draws a chart is lazy, so this now loads
// alongside them instead of ahead of everyone.
//
// The fetch is kicked off here at module scope rather than on idle so that it
// is already in flight long before any chart page can be reached (login, auth
// round trip and a route chunk all have to happen first). Chart.js applies a
// registered plugin to charts created after registration, and the first Chart
// instance cannot be constructed until one of those lazy pages renders.
Promise.all([import('chart.js'), import('./lib/chartVarPlugin')])
  .then(([{ Chart }, { chartVarResolverPlugin }]) => Chart.register(chartVarResolverPlugin))
  .catch(() => { /* charts still render, just without token resolution */ })

// ── Pre-init error buffer ────────────────────────────────────────────────────
// Monitoring is initialised AFTER first paint (below), which opens a short
// window where Sentry is not installed yet and an error would simply vanish.
// These two listeners are registered SYNCHRONOUSLY, before anything can throw,
// and hold what they catch until Sentry is up. Deliberately tiny and bounded:
// a boot loop must not grow memory, and this must never itself throw.
const PENDING_ERRORS = []
const MAX_PENDING_ERRORS = 20

function bufferError(err) {
  if (err && PENDING_ERRORS.length < MAX_PENDING_ERRORS) PENDING_ERRORS.push(err)
}
// `error` also fires for failed image/script loads, which carry no .error -
// keep those out rather than reporting an empty exception.
const onWindowError = (e) => bufferError(e?.error || (e?.message ? new Error(e.message) : null))
const onRejection = (e) => bufferError(e?.reason instanceof Error ? e.reason : new Error(String(e?.reason)))

window.addEventListener('error', onWindowError)
window.addEventListener('unhandledrejection', onRejection)

/** Run `fn` once the browser is idle, with a timeout so it always runs. */
function onIdle(fn) {
  let done = false
  const once = () => { if (!done) { done = true; fn() } }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(once, { timeout: 2000 })
  } else {
    setTimeout(once, 200)
  }
}

// Sentry + PostHog init is real main-thread work: PostHog registers
// document-wide autocapture listeners, touches localStorage+cookie and opens a
// network request; Sentry installs browser tracing and session replay, patching
// fetch/XHR/history. None of it is needed to paint the first screen, so it runs
// after render instead of before it. Both are env-gated no-ops without a key.
//
// This defers the WORK. Deferring the BYTES took a second change, in the two
// modules themselves: they used to `import * as Sentry from '@sentry/react'`
// and `import posthog from 'posthog-js'` at module scope, and because
// AuthContext and both error boundaries import THEM statically, 205.7 kB raw /
// 68.0 kB gz of SDK sat in an eagerly modulepreloaded chunk no matter what this
// file did. A dynamic import here cannot undo a static one over there. Both are
// now loaded on demand inside initMonitoring / initAnalytics.
//
// monitoring.js queues errors, breadcrumbs and user context raised while its
// SDK is still in flight and replays them on arrival, so making it lazy did not
// open a window where a boot error is reported nowhere. analytics.js
// deliberately does NOT queue - a lost analytics event is a rounding error, a
// lost error is not.
function startTelemetry() {
  import('./lib/monitoring')
    .then(({ initMonitoring, captureError }) =>
      // AWAITED: initMonitoring now returns a promise, because the SDK itself is
      // fetched on demand and it cannot report success for something that has
      // not downloaded yet. The listeners below are removed only AFTER it
      // settles - detaching them while the SDK was still in flight would leave a
      // window covered by neither the buffer nor Sentry.
      initMonitoring().then((active) => ({ active, captureError })))
    .then(({ active, captureError }) => {
      // Sentry is live from here on and its own global handlers now cover us,
      // so stop buffering - otherwise every uncaught error is reported twice.
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onRejection)
      if (!active || PENDING_ERRORS.length === 0) {
        PENDING_ERRORS.length = 0
        return
      }
      // Replayed through monitoring's own captureError, NOT a direct
      // import('@sentry/react'). Measured: a namespace import of the SDK here
      // defeats tree-shaking and pulls every Sentry integration into the eager
      // vendor-react chunk (+462 kB raw). The cost of going through captureError
      // is that a replayed error is also mirrored into system_logs, which an
      // error boundary may already have written - a possible duplicate row for
      // an error in the first moments of boot, which is the cheaper trade.
      for (const err of PENDING_ERRORS.splice(0)) {
        try { captureError(err, { boundary: 'pre-init' }) } catch { /* never break boot */ }
      }
    })
    .catch(() => {
      // Monitoring could not load; drop the buffer rather than hold it forever.
      PENDING_ERRORS.length = 0
    })

  import('./lib/analytics')
    .then(({ initAnalytics }) => initAnalytics())
    .catch(() => { /* analytics must never break the app */ })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </AppErrorBoundary>
  </React.StrictMode>
)

// We got far enough to render, so this document is healthy: release the
// one-shot guard so a chunk failure later in the session can recover too.
markAppRendered()

// Telemetry last, and only once the browser is idle.
onIdle(startTelemetry)
