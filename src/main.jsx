import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ThemeProvider } from './contexts/ThemeContext'
import AppErrorBoundary from './components/AppErrorBoundary'
import { initMonitoring } from './lib/monitoring'
import { initAnalytics } from './lib/analytics'
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

initMonitoring()
initAnalytics()

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
