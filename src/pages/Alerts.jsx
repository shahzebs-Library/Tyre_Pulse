import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, TrendingUp, AlertTriangle, Bell, ArrowRight, X, RefreshCw, CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import {
  detectAlerts, countAlertsBySeverity,
  SEVERITY_CONFIG, ALERT_TYPE_LABELS, ALERT_TYPES,
} from '../lib/alertEngine'
import PageHeader from '../components/ui/PageHeader'
import { cn } from '../lib/cn'

const TYPE_ICON_CONFIG = {
  [ALERT_TYPES.VEHICLE_INACTIVE]: { Icon: Clock,         color: 'text-orange-400', bg: 'bg-orange-500/10' },
  [ALERT_TYPES.HIGH_CPK]:         { Icon: TrendingUp,    color: 'text-red-400',    bg: 'bg-red-500/10'    },
  [ALERT_TYPES.DATA_QUALITY]:     { Icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
}

const SEV_STYLE = {
  critical: { ring: 'ring-red-500/30',    dot: 'bg-red-500',    text: 'text-red-400',    bar: 'bg-red-500',    label: 'Critical', pill: 'bg-red-500/15 text-red-300 border-red-500/20' },
  high:     { ring: 'ring-orange-500/30', dot: 'bg-orange-500', text: 'text-orange-400', bar: 'bg-orange-500', label: 'High',     pill: 'bg-orange-500/15 text-orange-300 border-orange-500/20' },
  medium:   { ring: 'ring-yellow-500/30', dot: 'bg-yellow-500', text: 'text-yellow-400', bar: 'bg-yellow-500', label: 'Medium',   pill: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/20' },
  info:     { ring: 'ring-blue-500/30',   dot: 'bg-blue-500',   text: 'text-blue-400',   bar: 'bg-blue-500',   label: 'Info',     pill: 'bg-blue-500/15 text-blue-300 border-blue-500/20'   },
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts"
        subtitle="Stock, budget, overdue actions, risk spikes and inspections"
        icon={Bell}
        badge={active.length > 0 ? `${active.length} active` : undefined}
        onRefresh={refresh}
        refreshing={loading}
        actions={dismissed.size > 0 && (
          <button onClick={clearDismissed} className="btn-secondary text-xs px-3 py-1.5">
            Restore {dismissed.size} dismissed
          </button>
        )}
      />

      {/* Severity summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { key: 'critical', label: 'Critical', count: counts.critical },
          { key: 'high',     label: 'High',     count: counts.high     },
          { key: 'medium',   label: 'Medium',   count: counts.medium   },
          { key: 'info',     label: 'Info',     count: counts.info     },
        ].map(({ key, label, count }, i) => {
          const s = SEV_STYLE[key]
          const isActive = filter === key
          return (
            <motion.button
              key={key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              onClick={() => setFilter(isActive ? 'all' : key)}
              className={cn(
                'card text-left transition-all duration-200',
                'hover:scale-[1.02] hover:-translate-y-0.5',
                isActive && `ring-1 ${s.ring} shadow-[0_0_20px_rgba(0,0,0,0.3)]`
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={cn('w-2 h-2 rounded-full', s.dot, count > 0 && 'animate-pulse')} />
                {isActive && <span className="text-[10px] text-muted font-medium">active</span>}
              </div>
              <p className={cn('text-2xl font-bold tabular-nums', s.text)}>{count}</p>
              <p className="text-xs text-muted mt-1 font-medium">{label}</p>
              <div className={cn('w-full h-0.5 rounded-full mt-3 opacity-50', s.bar)} />
            </motion.button>
          )
        })}
      </div>

      {/* Type filter pills */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted font-medium">Filter:</span>
        <button
          onClick={() => setFilter('all')}
          className={cn(
            'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
            filter === 'all'
              ? 'bg-brand text-white border-brand-600 shadow-[0_0_12px_rgba(22,163,74,0.3)]'
              : 'bg-surface-2 text-muted border-[var(--border-dim)] hover:border-brand-600/30 hover:text-white'
          )}
        >
          All ({active.length})
        </button>
        {Object.entries(ALERT_TYPES).map(([, type]) => {
          const cnt = active.filter(a => a.type === type).length
          if (cnt === 0) return null
          return (
            <button
              key={type}
              onClick={() => setFilter(filter === type ? 'all' : type)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                filter === type
                  ? 'bg-brand text-white border-brand-600 shadow-[0_0_12px_rgba(22,163,74,0.3)]'
                  : 'bg-surface-2 text-muted border-[var(--border-dim)] hover:border-brand-600/30 hover:text-white'
              )}
            >
              {ALERT_TYPE_LABELS[type]} ({cnt})
            </button>
          )
        })}
      </div>

      {/* List meta */}
      {!loading && visible.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted">
            {visible.length} alert{visible.length !== 1 ? 's' : ''}
            {lastRefresh && ` · Scanned ${lastRefresh.toLocaleTimeString()}`}
          </p>
          {visible.length > 1 && (
            <button onClick={dismissAll} className="text-xs text-muted hover:text-white transition-colors">
              Dismiss all
            </button>
          )}
        </div>
      )}

      {/* Alert cards */}
      {loading && active.length === 0 ? (
        <div className="card py-16 flex flex-col items-center gap-3 text-muted">
          <Loader2 className="w-6 h-6 animate-spin text-brand" />
          <span className="text-sm">Scanning fleet for alerts…</span>
        </div>
      ) : visible.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="card py-16 flex flex-col items-center gap-3"
        >
          <CheckCircle2 className="w-10 h-10 text-brand-bright opacity-60" />
          <p className="text-white font-semibold">All clear</p>
          <p className="text-muted text-sm">
            {filter !== 'all' ? 'No alerts in this category.' : 'No active alerts for your fleet.'}
          </p>
        </motion.div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {visible.map((alert, i) => {
              const sev = SEV_STYLE[alert.severity] || SEV_STYLE.info
              const typeCfg = TYPE_ICON_CONFIG[alert.type]
              return (
                <motion.div
                  key={alert.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8, scale: 0.97 }}
                  transition={{ delay: i * 0.025, duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    'flex items-start gap-4 p-4 rounded-2xl border transition-all duration-200',
                    'bg-surface-1 hover:bg-surface-2',
                    `ring-1 ${sev.ring}`
                  )}
                >
                  {/* Icon */}
                  <div className={cn(
                    'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
                    typeCfg?.bg || 'bg-surface-3'
                  )}>
                    {typeCfg
                      ? <typeCfg.Icon className={cn('w-4 h-4', typeCfg.color)} />
                      : <div className={cn('w-2.5 h-2.5 rounded-full', sev.dot)} />
                    }
                  </div>

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn('text-sm font-semibold', sev.text)}>{alert.title}</span>
                      <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium', sev.pill)}>
                        {sev.label}
                      </span>
                      <span className="text-xs bg-surface-3 text-muted px-2 py-0.5 rounded-full border border-[var(--border-dim)]">
                        {ALERT_TYPE_LABELS[alert.type] || alert.type}
                      </span>
                    </div>
                    <p className="text-sm text-gray-300 mt-1 leading-relaxed">{alert.message}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {alert.link && (
                      <button
                        onClick={() => navigate(alert.link)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-surface-3 text-gray-300 hover:bg-brand hover:text-white border border-[var(--border-dim)] hover:border-brand-600 transition-all duration-150"
                      >
                        View <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={() => dismiss(alert.id)}
                      className="flex items-center gap-1 text-xs text-muted hover:text-white transition-colors"
                    >
                      <X className="w-3 h-3" /> Dismiss
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
