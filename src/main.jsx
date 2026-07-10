import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ThemeProvider } from './contexts/ThemeContext'
import AppErrorBoundary from './components/AppErrorBoundary'
import { initMonitoring } from './lib/monitoring'
import { initAnalytics } from './lib/analytics'
import { Chart as ChartJS } from 'chart.js'
import { chartVarResolverPlugin } from './lib/chartVarPlugin'

// Resolve CSS theme tokens (var(--…)) inside every Chart.js canvas globally.
ChartJS.register(chartVarResolverPlugin)

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
