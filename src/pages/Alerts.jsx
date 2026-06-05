import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, TrendingUp, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import {
  detectAlerts, countAlertsBySeverity,
  SEVERITY_CONFIG, ALERT_TYPE_LABELS, ALERT_TYPES,
} from '../lib/alertEngine'

const TYPE_ICON_CONFIG = {
  [ALERT_TYPES.VEHICLE_INACTIVE]: { Icon: Clock,         color: 'text-orange-400' },
  [ALERT_TYPES.HIGH_CPK]:         { Icon: TrendingUp,    color: 'text-red-400'    },
  [ALERT_TYPES.DATA_QUALITY]:     { Icon: AlertTriangle, color: 'text-yellow-400' },
}

export default function Alerts() {
  const navigate = useNavigate()
  const { activeCountry } = useSettings()
  const [alerts, setAlerts]   = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('all')
  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('tp_dismissed_alerts') || '[]')) }
    catch { return new Set() }
  })
  const [lastRefresh, setLastRefresh] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const country = activeCountry !== 'All' ? activeCountry : null
    const found = await detectAlerts(supabase, country)
    setAlerts(found)
    setLastRefresh(new Date())
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { refresh() }, [refresh, activeCountry])

  function dismiss(id) {
    setDismissed(prev => {
      const next = new Set(prev)
      next.add(id)
      localStorage.setItem('tp_dismissed_alerts', JSON.stringify([...next]))
      return next
    })
  }

  function dismissAll() {
    const ids = visible.map(a => a.id)
    setDismissed(prev => {
      const next = new Set(prev)
      ids.forEach(id => next.add(id))
      localStorage.setItem('tp_dismissed_alerts', JSON.stringify([...next]))
      return next
    })
  }

  function clearDismissed() {
    setDismissed(new Set())
    localStorage.removeItem('tp_dismissed_alerts')
  }

  const active   = alerts.filter(a => !dismissed.has(a.id))
  const counts   = countAlertsBySeverity(active)
  const filtered = filter === 'all'
    ? active
    : active.filter(a =>
        filter === 'dismissed' ? dismissed.has(a.id)
        : a.severity === filter || a.type === filter
      )
  const visible  = filtered

  const FILTER_TABS = [
    { id: 'all',      label: 'All',        count: active.length },
    { id: 'critical', label: 'Critical',   count: counts.critical },
    { id: 'high',     label: 'High',       count: counts.high },
    { id: 'medium',   label: 'Medium',     count: counts.medium },
    { id: 'info',     label: 'Info',       count: counts.info },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Alerts</h1>
          <p className="text-gray-400 text-sm mt-1">
            Stock, budget, overdue actions, risk spikes and inspections
          </p>
        </div>
        <div className="flex gap-2">
          {dismissed.size > 0 && (
            <button onClick={clearDismissed} className="btn-secondary text-xs px-3">
              Restore {dismissed.size} dismissed
            </button>
          )}
          <button onClick={refresh} disabled={loading} className="btn-secondary text-sm disabled:opacity-50">
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Critical', count: counts.critical, cfg: SEVERITY_CONFIG.critical },
          { label: 'High',     count: counts.high,     cfg: SEVERITY_CONFIG.high },
          { label: 'Medium',   count: counts.medium,   cfg: SEVERITY_CONFIG.medium },
          { label: 'Info',     count: counts.info,     cfg: SEVERITY_CONFIG.info },
        ].map(({ label, count, cfg }) => (
          <button
            key={label}
            onClick={() => setFilter(label.toLowerCase())}
            className={`card text-left transition-all hover:scale-[1.02] ${filter === label.toLowerCase() ? `border ${cfg.border}` : ''}`}
          >
            <p className={`text-2xl font-bold ${cfg.color}`}>{count}</p>
            <p className="text-gray-400 text-sm mt-1">{label}</p>
            <div className={`w-full h-1 rounded-full mt-3 ${cfg.badge}`} />
          </button>
        ))}
      </div>

      {/* Alert type breakdown */}
      <div className="card">
        <p className="text-xs text-gray-400 mb-3">By type:</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(ALERT_TYPES).map(([key, type]) => {
            const cnt = active.filter(a => a.type === type).length
            return (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  filter === type
                    ? 'bg-green-700 text-white border-green-600'
                    : 'bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-500'
                }`}
              >
                {ALERT_TYPE_LABELS[type]} ({cnt})
              </button>
            )
          })}
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filter === 'all' ? 'bg-green-700 text-white border-green-600' : 'bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-500'
            }`}
          >
            All ({active.length})
          </button>
        </div>
      </div>

      {/* Alerts list */}
      {loading && active.length === 0 ? (
        <div className="card text-center text-gray-400 py-12">Scanning for alerts…</div>
      ) : visible.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-white font-semibold">No alerts</p>
          <p className="text-gray-400 text-sm mt-2">
            {filter !== 'all' ? 'No alerts in this category.' : 'Everything looks good!'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {visible.length} alert{visible.length !== 1 ? 's' : ''}
              {lastRefresh && ` · Last checked ${lastRefresh.toLocaleTimeString()}`}
            </p>
            {visible.length > 1 && (
              <button onClick={dismissAll} className="text-xs text-gray-500 hover:text-gray-300">
                Dismiss all visible
              </button>
            )}
          </div>

          {visible.map(alert => {
            const cfg = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info
            return (
              <div
                key={alert.id}
                className={`rounded-xl border p-4 flex items-start gap-4 ${cfg.bg} ${cfg.border}`}
              >
                <AlertIcon type={alert.type} severity={alert.severity} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-semibold ${cfg.color}`}>{alert.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full text-white font-medium ${cfg.badge}`}>
                      {SEVERITY_CONFIG[alert.severity]?.label}
                    </span>
                    <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full border border-gray-700">
                      {ALERT_TYPE_LABELS[alert.type] || alert.type}
                    </span>
                  </div>
                  <p className="text-gray-300 text-sm mt-1">{alert.message}</p>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  {alert.link && (
                    <button
                      onClick={() => navigate(alert.link)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 transition-colors whitespace-nowrap"
                    >
                      View →
                    </button>
                  )}
                  <button
                    onClick={() => dismiss(alert.id)}
                    className="text-xs text-gray-600 hover:text-gray-400"
                    title="Dismiss"
                  >
                    ✕ Dismiss
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AlertIcon({ type, severity }) {
  const typeCfg = TYPE_ICON_CONFIG[type]
  if (typeCfg) {
    const { Icon, color } = typeCfg
    return <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${color}`} />
  }
  return <SeverityIcon severity={severity} />
}

function SeverityIcon({ severity }) {
  const icons = {
    critical: '🔴',
    high:     '🟠',
    medium:   '🟡',
    info:     '🔵',
  }
  return <span className="text-xl flex-shrink-0">{icons[severity] || '⚪'}</span>
}
