import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Clock, TrendingUp, AlertTriangle, Bell, ArrowRight, X, RefreshCw,
  CheckCircle2, Search, Download, FileText, SlidersHorizontal,
  ChevronDown, ChevronUp, Eye, EyeOff,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import {
  detectAlerts, countAlertsBySeverity,
  SEVERITY_CONFIG, ALERT_TYPE_LABELS, ALERT_TYPES,
} from '../lib/alertEngine'
import PageHeader from '../components/ui/PageHeader'
import Skeleton from '../components/ui/Skeleton'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { cn } from '../lib/cn'

// ── Style maps ─────────────────────────────────────────────────────────────────
const TYPE_ICON_CONFIG = {
  [ALERT_TYPES.VEHICLE_INACTIVE]: { Icon: Clock,         color: 'text-orange-400', bg: 'bg-orange-500/10' },
  [ALERT_TYPES.HIGH_CPK]:         { Icon: TrendingUp,    color: 'text-red-400',    bg: 'bg-red-500/10'    },
  [ALERT_TYPES.DATA_QUALITY]:     { Icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
}

const SEV_STYLE = {
  critical: { ring: 'ring-red-500/30',    dot: 'bg-red-500',    text: 'text-red-400',    bar: 'bg-red-500',    label: 'Critical', pill: 'bg-red-500/15 text-red-300 border-red-500/20',    order: 0 },
  high:     { ring: 'ring-orange-500/30', dot: 'bg-orange-500', text: 'text-orange-400', bar: 'bg-orange-500', label: 'High',     pill: 'bg-orange-500/15 text-orange-300 border-orange-500/20', order: 1 },
  medium:   { ring: 'ring-yellow-500/30', dot: 'bg-yellow-500', text: 'text-yellow-400', bar: 'bg-yellow-500', label: 'Medium',   pill: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/20', order: 2 },
  info:     { ring: 'ring-blue-500/30',   dot: 'bg-blue-500',   text: 'text-blue-400',   bar: 'bg-blue-500',   label: 'Info',     pill: 'bg-blue-500/15 text-blue-300 border-blue-500/20',    order: 3 },
}

const SEV_SORT_ORDER = { critical: 0, high: 1, medium: 2, info: 3 }

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Alerts() {
  const navigate = useNavigate()
  const { activeCountry } = useSettings()
  const { t } = useLanguage()
  const sevLabel = (key) => t(`alerts.severity.${key}`)

  const [alerts, setAlerts]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)

  const [sevFilter, setSevFilter]   = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch]         = useState('')
  const [sortBy, setSortBy]         = useState('severity')
  const [showDismissed, setShowDismissed] = useState(false)
  const [showFilters, setShowFilters]     = useState(false)

  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('tp_dismissed_alerts') || '[]')) }
    catch { return new Set() }
  })

  const refresh = useCallback(async () => {
    setLoading(true)
    const country = activeCountry !== 'All' ? activeCountry : null
    const found   = await detectAlerts(supabase, country)
    setAlerts(found)
    setLastRefresh(new Date())
    setLoading(false)
  }, [activeCountry])

  useEffect(() => { refresh() }, [refresh])

  // Persist dismissals via an effect — never inside a setState updater (React
  // StrictMode double-invokes updaters, which would double-write).
  useEffect(() => {
    try { localStorage.setItem('tp_dismissed_alerts', JSON.stringify([...dismissed])) }
    catch { /* storage disabled */ }
  }, [dismissed])

  // ── Dismiss helpers ───────────────────────────────────────────────────────────
  function dismiss(id) {
    setDismissed(prev => new Set(prev).add(id))
  }

  function undismiss(id) {
    setDismissed(prev => { const next = new Set(prev); next.delete(id); return next })
  }

  function dismissFiltered() {
    setDismissed(prev => { const next = new Set(prev); visible.forEach(a => next.add(a.id)); return next })
  }

  function clearAllDismissed() {
    setDismissed(new Set())
  }

  // ── Derived data ──────────────────────────────────────────────────────────────
  const active   = useMemo(() => alerts.filter(a => !dismissed.has(a.id)), [alerts, dismissed])
  const dismissedAlerts = useMemo(() => alerts.filter(a => dismissed.has(a.id)), [alerts, dismissed])
  const counts   = useMemo(() => countAlertsBySeverity(active), [active])

  const visible = useMemo(() => {
    let arr = active

    if (sevFilter !== 'all')  arr = arr.filter(a => a.severity === sevFilter)
    if (typeFilter !== 'all') arr = arr.filter(a => a.type === typeFilter)

    if (search) {
      const q = search.toLowerCase()
      arr = arr.filter(a =>
        a.title?.toLowerCase().includes(q) ||
        a.message?.toLowerCase().includes(q) ||
        (ALERT_TYPE_LABELS[a.type] ?? '').toLowerCase().includes(q)
      )
    }

    return [...arr].sort((a, b) => {
      if (sortBy === 'severity') return (SEV_SORT_ORDER[a.severity] ?? 4) - (SEV_SORT_ORDER[b.severity] ?? 4)
      if (sortBy === 'type')     return (a.type ?? '').localeCompare(b.type ?? '')
      return 0
    })
  }, [active, sevFilter, typeFilter, search, sortBy])

  const typesPresent = useMemo(() => {
    const m = {}
    active.forEach(a => { m[a.type] = (m[a.type] ?? 0) + 1 })
    return m
  }, [active])

  // ── Exports ───────────────────────────────────────────────────────────────────
  function doExcelExport() {
    exportToExcel(
      visible.map(a => ({ severity: SEV_STYLE[a.severity]?.label ?? a.severity, type: ALERT_TYPE_LABELS[a.type] ?? a.type, title: a.title, message: a.message })),
      ['severity','type','title','message'],
      ['Severity','Type','Alert','Message'],
      'TyrePulse_Alerts'
    )
  }

  function doPdfExport() {
    exportToPdf(
      visible.map(a => ({ severity: SEV_STYLE[a.severity]?.label ?? a.severity, type: ALERT_TYPE_LABELS[a.type] ?? a.type, title: a.title, message: a.message })),
      [
        { key: 'severity', header: 'Severity' },
        { key: 'type',     header: 'Type' },
        { key: 'title',    header: 'Alert' },
        { key: 'message',  header: 'Message' },
      ],
      'Active Alerts Report',
      'TyrePulse_Alerts',
      'landscape'
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('alerts.header.title')}
        subtitle={t('alerts.header.subtitle')}
        icon={Bell}
        badge={active.length > 0 ? t('alerts.header.badge', { count: active.length }) : undefined}
      />

      {/* Severity KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(['critical','high','medium','info']).map((key, i) => {
          const s     = SEV_STYLE[key]
          const count = counts[key] ?? 0
          const isActive = sevFilter === key
          return (
            <motion.button
              key={key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              onClick={() => setSevFilter(isActive ? 'all' : key)}
              className={cn(
                'card text-left transition-all duration-200',
                'hover:scale-[1.02] hover:-translate-y-0.5',
                isActive && `ring-1 ${s.ring} shadow-[0_0_20px_rgba(0,0,0,0.3)]`
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={cn('w-2 h-2 rounded-full', s.dot, count > 0 && 'animate-pulse')} />
                {isActive && <span className="text-[10px] text-muted font-medium">{t('alerts.card.filtered')}</span>}
              </div>
              <p className={cn('text-2xl font-bold tabular-nums', s.text)}>{count}</p>
              <p className="text-xs text-muted mt-1 font-medium">{sevLabel(key)}</p>
              <div className={cn('w-full h-0.5 rounded-full mt-3 opacity-40', s.bar)} />
            </motion.button>
          )
        })}
      </div>

      {/* Toolbar */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="input pl-8 text-sm"
              placeholder={t('alerts.toolbar.searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'flex items-center gap-1.5 text-sm px-3 py-1.5 border rounded-lg transition-colors',
              showFilters ? 'bg-blue-900/30 text-blue-300 border-blue-700/50' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
            )}
          >
            <SlidersHorizontal size={13} /> {t('alerts.toolbar.filters')}
            {(sevFilter !== 'all' || typeFilter !== 'all') && (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 ml-0.5" />
            )}
          </button>

          <div className="ml-auto flex items-center gap-2">
            {/* Refresh */}
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-1.5 btn-secondary text-sm px-3 py-1.5"
              title={lastRefresh ? t('alerts.toolbar.lastScanned', { time: lastRefresh.toLocaleTimeString() }) : t('alerts.toolbar.scanTooltip')}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              {loading ? t('alerts.toolbar.scanning') : t('alerts.toolbar.refresh')}
            </button>

            {/* Exports */}
            <button onClick={doExcelExport} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
              <Download size={13} /> {t('alerts.toolbar.excel')}
            </button>
            <button onClick={doPdfExport} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
              <FileText size={13} /> {t('alerts.toolbar.pdf')}
            </button>
          </div>
        </div>

        {/* Expanded filters */}
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="card py-3 px-4 flex flex-wrap gap-3 items-center">
              {/* Type pills */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-gray-500 font-medium">{t('alerts.filters.type')}</span>
                <button
                  onClick={() => setTypeFilter('all')}
                  className={cn('px-2.5 py-1 rounded-full text-xs font-medium border transition-all',
                    typeFilter === 'all' ? 'bg-gray-700 text-white border-gray-600' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white')}
                >
                  {t('alerts.filters.all', { count: active.length })}
                </button>
                {Object.entries(typesPresent).map(([type, cnt]) => (
                  <button key={type}
                    onClick={() => setTypeFilter(typeFilter === type ? 'all' : type)}
                    className={cn('px-2.5 py-1 rounded-full text-xs font-medium border transition-all',
                      typeFilter === type ? 'bg-gray-700 text-white border-gray-600' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white')}
                  >
                    {ALERT_TYPE_LABELS[type] || type} ({cnt})
                  </button>
                ))}
              </div>

              {/* Sort */}
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-gray-500">{t('alerts.filters.sort')}</span>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="input text-xs py-1 w-32">
                  <option value="severity">{t('alerts.filters.sortSeverity')}</option>
                  <option value="type">{t('alerts.filters.sortType')}</option>
                </select>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* List meta */}
      {!loading && visible.length > 0 && (
        <div className="flex items-center justify-between text-xs">
          <p className="text-muted">
            {t('alerts.list.count', { count: visible.length })}
            {lastRefresh && ` · ${t('alerts.list.scannedAt', { time: lastRefresh.toLocaleTimeString() })}`}
          </p>
          {visible.length > 1 && (
            <button onClick={dismissFiltered} className="text-muted hover:text-white transition-colors flex items-center gap-1">
              <EyeOff size={11} /> {t('alerts.list.dismissAllVisible')}
            </button>
          )}
        </div>
      )}

      {/* Alert list */}
      {loading && active.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] w-full rounded-2xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="card py-16 flex flex-col items-center gap-3"
        >
          <CheckCircle2 className="w-10 h-10 text-brand-bright opacity-60" />
          <p className="text-white font-semibold">
            {sevFilter !== 'all' || typeFilter !== 'all' || search ? t('alerts.states.noMatch') : t('alerts.states.allClear')}
          </p>
          <p className="text-muted text-sm">
            {sevFilter !== 'all' || typeFilter !== 'all' || search
              ? t('alerts.states.noMatchDesc')
              : t('alerts.states.allClearDesc')}
          </p>
          {(sevFilter !== 'all' || typeFilter !== 'all' || search) && (
            <button
              onClick={() => { setSevFilter('all'); setTypeFilter('all'); setSearch('') }}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors mt-1"
            >
              {t('alerts.states.clearFilters')}
            </button>
          )}
        </motion.div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {visible.map((alert, i) => {
              const sev     = SEV_STYLE[alert.severity] ?? SEV_STYLE.info
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
                  {/* Type icon */}
                  <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', typeCfg?.bg || 'bg-surface-3')}>
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
                        {sevLabel(alert.severity)}
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
                        {t('alerts.item.view')} <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={() => dismiss(alert.id)}
                      className="flex items-center gap-1 text-xs text-muted hover:text-white transition-colors"
                    >
                      <X className="w-3 h-3" /> {t('alerts.item.dismiss')}
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Dismissed section */}
      {dismissedAlerts.length > 0 && (
        <div className="border-t border-gray-800 pt-4">
          <button
            onClick={() => setShowDismissed(!showDismissed)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-300 transition-colors w-full"
          >
            {showDismissed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <EyeOff size={13} />
            {t('alerts.dismissed.count', { count: dismissedAlerts.length })}
            <span className="ml-auto text-xs text-gray-600 hover:text-red-400 transition-colors" onClick={e => { e.stopPropagation(); clearAllDismissed() }}>
              {t('alerts.dismissed.restoreAll')}
            </span>
          </button>

          {showDismissed && (
            <div className="mt-3 space-y-1.5">
              {dismissedAlerts.map(alert => {
                const sev = SEV_STYLE[alert.severity] ?? SEV_STYLE.info
                return (
                  <div key={alert.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-gray-800 bg-gray-900/40 opacity-60 hover:opacity-90 transition-opacity">
                    <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', sev.dot)} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-400">{alert.title}</span>
                      <span className="text-xs text-gray-600 ml-2">{ALERT_TYPE_LABELS[alert.type] || alert.type}</span>
                    </div>
                    <button
                      onClick={() => undismiss(alert.id)}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-400 transition-colors flex-shrink-0"
                    >
                      <Eye size={11} /> {t('alerts.dismissed.restore')}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
