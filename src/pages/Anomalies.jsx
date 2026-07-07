import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import {
  detectAnomalies, summariseAnomalies,
  ANOMALY_TYPES, ANOMALY_TYPE_LABELS, ANOMALY_TYPE_DESC,
} from '../lib/anomalyEngine'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { formatCurrencyCompact } from '../lib/formatters'
import { fetchAllPages } from '../lib/fetchAll'
import { Download, FileText, Search, AlertTriangle } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'

const SEVERITY_STYLE = {
  critical:  { badge: 'bg-red-500/15 text-red-200 border-red-500/40',       icon: '🔴', label: 'Critical' },
  high:      { badge: 'bg-orange-500/15 text-orange-200 border-orange-500/40', icon: '🟠', label: 'High' },
  medium:    { badge: 'bg-yellow-500/15 text-yellow-200 border-yellow-500/35', icon: '🟡', label: 'Medium' },
  low:       { badge: 'bg-blue-500/15 text-blue-300 border-blue-500/35',     icon: '🔵', label: 'Low' },
  dismissed: { badge: 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]',    icon: '⚪', label: 'Dismissed' },
  unknown:   { badge: 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]',    icon: '⚪', label: 'Unknown' },
}

const TYPE_ICON = {
  [ANOMALY_TYPES.SHORT_INTERVAL]:   '⏱',
  [ANOMALY_TYPES.SAME_DAY_BURST]:   '💥',
  [ANOMALY_TYPES.RAPID_RECURRENCE]: '🔁',
  [ANOMALY_TYPES.COST_SPIKE]:       '💸',
  [ANOMALY_TYPES.SERIAL_REUSE]:     '🔀',
  [ANOMALY_TYPES.DUPLICATE_ENTRY]:  '📋',
}

const ANOMALY_CONFIGS = [
  { key: 'shortIntervalDays',     label: 'Short interval threshold (days)',   default: 7  },
  { key: 'warnIntervalDays',      label: 'Warn interval threshold (days)',    default: 30 },
  { key: 'sameDayBurstThreshold', label: 'Same-day burst count (tyres)',      default: 3  },
  { key: 'rapidRecurrenceWindow', label: 'Rapid recurrence window (days)',    default: 30 },
  { key: 'rapidRecurrenceCount',  label: 'Rapid recurrence count (events)',   default: 3  },
  { key: 'costSpikeZScore',       label: 'Cost spike Z-score threshold',      default: 3  },
]

function AnomalyTypeGroup({ typeName, items }) {
  const [open, setOpen] = useState(true)
  const maxSev = items.some(i => i.severity === 'high') ? 'high' : 'medium'
  const sevColour = maxSev === 'high' ? 'text-red-400' : 'text-yellow-400'
  const sevBg = maxSev === 'high' ? 'bg-red-900/20 border-red-700/30' : 'bg-yellow-900/20 border-yellow-700/30'

  return (
    <div className="card overflow-hidden mb-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={`font-semibold text-sm ${sevColour}`}>
            {typeName.replace(/_/g, ' ')}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${sevBg} ${sevColour}`}>
            {maxSev}
          </span>
          <span className="text-xs text-[var(--text-muted)]">{items.length} instance{items.length !== 1 ? 's' : ''}</span>
        </div>
        <span className="text-[var(--text-muted)] text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && items.map((anomaly, idx) => (
        <div key={anomaly.id ?? idx} className="border-t border-white/5 px-4 py-3">
          <p className="text-sm text-[var(--text-secondary)] mb-2">{anomaly.message}</p>
          {anomaly.detail && <p className="text-xs text-[var(--text-muted)] mb-2">{anomaly.detail}</p>}
          {anomaly.records && anomaly.records.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[var(--text-muted)] border-b border-white/5">
                    <th className="text-left pb-1 pr-3">Date</th>
                    <th className="text-left pb-1 pr-3">Brand</th>
                    <th className="text-left pb-1 pr-3">Serial</th>
                    <th className="text-left pb-1 pr-3">Site</th>
                    <th className="text-left pb-1">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {anomaly.records.map((r, ri) => (
                    <tr key={ri} className="border-b border-white/5 last:border-0">
                      <td className="py-1 pr-3 text-[var(--text-secondary)]">{r.issue_date ?? '-'}</td>
                      <td className="py-1 pr-3 text-[var(--text-secondary)]">{r.brand ?? '-'}</td>
                      <td className="py-1 pr-3 text-[var(--text-secondary)] font-mono">{r.serial_no ?? '-'}</td>
                      <td className="py-1 pr-3 text-[var(--text-secondary)]">{r.site ?? '-'}</td>
                      <td className="py-1 text-[var(--text-secondary)]">{r.cost_per_tyre ? formatCurrencyCompact(r.cost_per_tyre) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function Anomalies() {
  const { activeCountry, activeCurrency } = useSettings()
  const [records, setRecords]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [running, setRunning]   = useState(false)
  const [anomalies, setAnomalies] = useState([])
  const [hasRun, setHasRun]     = useState(false)
  const [filterType, setFilterType]     = useState('all')
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterSite, setFilterSite]     = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [showConfig, setShowConfig] = useState(false)
  const [config, setConfig] = useState({
    shortIntervalDays:    7,
    warnIntervalDays:     30,
    sameDayBurstThreshold: 3,
    rapidRecurrenceWindow: 30,
    rapidRecurrenceCount: 3,
    costSpikeZScore:      3,
  })
  const [assetSearch, setAssetSearch] = useState('')
  const [viewMode, setViewMode] = useState('search') // 'search' | 'all'

  // Dismissed anomalies (local)
  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('tp_dismissed_anomalies') || '[]')) }
    catch { return new Set() }
  })

  // Persist dismissals via an effect — never inside a setState updater
  // (StrictMode double-invokes updaters, which would double-write).
  useEffect(() => {
    try { localStorage.setItem('tp_dismissed_anomalies', JSON.stringify([...dismissed])) }
    catch { /* storage disabled */ }
  }, [dismissed])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchAllPages((from, to) => {
      let q = supabase
        .from('tyre_records')
        .select('id,issue_date,asset_no,serial_no,brand,site,risk_level,cost_per_tyre,qty,description')
        .order('issue_date', { ascending: true })
      if (activeCountry !== 'All') q = q.or(`country.eq.${activeCountry},country.is.null`)
      return q.range(from, to)
    })
      .then(({ data }) => { if (cancelled) return; setRecords(data || []); setHasRun(false); setAnomalies([]) })
      .catch(() => { if (!cancelled) setRecords([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeCountry])

  function runDetection() {
    setRunning(true)
    // Run in next tick so UI updates first
    setTimeout(() => {
      const found = detectAnomalies(records, config)
      setAnomalies(found)
      setHasRun(true)
      setRunning(false)
    }, 10)
  }

  function dismiss(id) {
    setDismissed(prev => new Set(prev).add(id))
  }

  function clearDismissed() {
    setDismissed(new Set())
  }

  const active = useMemo(() => anomalies.filter(a => !dismissed.has(a.id)), [anomalies, dismissed])
  const summary = useMemo(() => summariseAnomalies(active), [active])

  const sites = useMemo(() => {
    const s = new Set(active.map(a => a.site).filter(Boolean))
    return [...s].sort()
  }, [active])

  const visible = useMemo(() => {
    let arr = active
    if (filterType !== 'all')     arr = arr.filter(a => a.type === filterType)
    if (filterSeverity !== 'all') arr = arr.filter(a => a.severity === filterSeverity)
    if (filterSite !== 'all')     arr = arr.filter(a => a.site === filterSite)
    return arr
  }, [active, filterType, filterSeverity, filterSite])

  // ── Header (always rendered) ───────────────────────────────────────────────
  const header = (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <PageHeader
        title="Anomaly Detection"
        subtitle="Detect short intervals, same-day bursts, rapid recurrence, cost spikes and duplicates"
        icon={AlertTriangle}
      />
      <div className="flex gap-2">
        {dismissed.size > 0 && (
          <button onClick={clearDismissed} className="btn-secondary text-xs px-3">
            Restore {dismissed.size} dismissed
          </button>
        )}
        <button onClick={() => setShowConfig(!showConfig)} className="btn-secondary text-sm">
          ⚙ Thresholds
        </button>
        <button
          onClick={runDetection}
          disabled={running || loading}
          className="btn-primary text-sm disabled:opacity-50 min-w-36"
        >
          {running ? 'Scanning...' : hasRun ? '↻ Re-scan' : '▶ Run Scan'}
        </button>
        {hasRun && (
          <>
            <button
              onClick={() => exportToExcel(
                anomalies.map(a => ({ type: ANOMALY_TYPE_LABELS[a.type] ?? a.type, severity: a.severity, asset_no: a.asset_no ?? '', site: a.site ?? '', description: a.message ?? '', detected_at: a.date ?? '' })),
                ['type','severity','asset_no','site','description','detected_at'],
                ['Type','Severity','Asset No','Site','Description','Detected At'],
                'TyrePulse_Anomalies'
              )}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
            >
              <Download size={14}/> Excel
            </button>
            <button
              onClick={() => exportToPdf(
                anomalies.map(a => ({ type: ANOMALY_TYPE_LABELS[a.type] ?? a.type, severity: a.severity, asset_no: a.asset_no ?? '', site: a.site ?? '', description: a.message ?? '', detected_at: a.date ?? '' })),
                [{key:'type',header:'Type'},{key:'severity',header:'Severity'},{key:'asset_no',header:'Asset No'},{key:'site',header:'Site'},{key:'description',header:'Description'},{key:'detected_at',header:'Detected At'}],
                'Anomaly Detection Report',
                'TyrePulse_Anomalies',
                'landscape'
              )}
              className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
            >
              <FileText size={14}/> PDF
            </button>
          </>
        )}
      </div>
    </div>
  )

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-[var(--surface-2)] h-20 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      {header}

      {/* What this scans - info cards */}
      {!hasRun && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(ANOMALY_TYPES).map(([key, type]) => (
            <div key={type} className="card flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">{TYPE_ICON[type]}</span>
              <div>
                <p className="text-[var(--text-primary)] text-sm font-semibold">{ANOMALY_TYPE_LABELS[type]}</p>
                <p className="text-[var(--text-secondary)] text-xs mt-1">{ANOMALY_TYPE_DESC[type]}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Config panel */}
      {showConfig && (
        <div className="card border border-yellow-700/50">
          <p className="text-sm font-medium text-yellow-400 mb-4">Detection Thresholds</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {ANOMALY_CONFIGS.map(({ key, label, default: def }) => (
              <div key={key}>
                <label className="label text-xs">{label}</label>
                <input
                  type="number"
                  className="input"
                  value={config[key] ?? def}
                  min={1}
                  onChange={e => setConfig(prev => ({ ...prev, [key]: parseFloat(e.target.value) || def }))}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-3">Changes apply on next scan.</p>
        </div>
      )}

      {/* Summary after scan */}
      {hasRun && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'High',   count: summary.bySeverity.high,   style: SEVERITY_STYLE.high },
            { label: 'Medium', count: summary.bySeverity.medium, style: SEVERITY_STYLE.medium },
            { label: 'Total',  count: summary.total,             style: { badge: 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]', icon: '⚪' } },
          ].map(({ label, count, style }) => (
            <div key={label} className={`card border ${style.badge}`}>
              <p className="text-2xl font-bold">{count}</p>
              <p className="text-sm mt-1 text-[var(--text-secondary)]">{label} anomalies</p>
            </div>
          ))}
        </div>
      )}

      {/* Search + mode toggle */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={assetSearch}
            onChange={e => { setAssetSearch(e.target.value); setViewMode('search') }}
            placeholder="Search by asset number to see its anomalies..."
            className="input pl-9 w-full"
          />
          {assetSearch && (
            <button onClick={() => setAssetSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">✕</button>
          )}
        </div>
        <button
          onClick={() => setViewMode(m => m === 'all' ? 'search' : 'all')}
          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${viewMode === 'all' ? 'bg-green-700/20 border-green-600/40 text-green-400' : 'border-white/10 text-[var(--text-secondary)] hover:text-white'}`}
        >
          {viewMode === 'all' ? '✓ Viewing All' : 'View All Anomalies'}
        </button>
      </div>

      {/* Content area */}
      {viewMode === 'search' && !assetSearch && hasRun && (
        <p className="text-[var(--text-muted)] text-sm">Type an asset number above to see its anomalies, or click "View All Anomalies".</p>
      )}

      {viewMode === 'search' && assetSearch && hasRun && (() => {
        const filtered = anomalies.filter(a => (a.asset_no ?? '').toLowerCase().includes(assetSearch.toLowerCase()))
        if (filtered.length === 0) return <p className="text-[var(--text-muted)] text-sm">No anomalies found for "{assetSearch}".</p>
        const grouped = filtered.reduce((acc, a) => {
          const t = a.type ?? 'OTHER'
          if (!acc[t]) acc[t] = []
          acc[t].push(a)
          return acc
        }, {})
        return (
          <div>
            <p className="text-xs text-[var(--text-muted)] mb-4">{filtered.length} anomal{filtered.length !== 1 ? 'ies' : 'y'} found for <span className="text-[var(--text-primary)] font-medium">{assetSearch}</span></p>
            {Object.entries(grouped).map(([type, items]) => (
              <AnomalyTypeGroup key={type} typeName={type} items={items} />
            ))}
          </div>
        )
      })()}

      {/* View All mode */}
      {viewMode === 'all' && hasRun && (
        <>
          {/* Type breakdown pills */}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setFilterType('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                filterType === 'all' ? 'bg-green-700 text-white border-green-600' : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)] hover:border-gray-500'
              }`}>
              All ({active.length})
            </button>
            {Object.entries(ANOMALY_TYPES).map(([, type]) => {
              const cnt = active.filter(a => a.type === type).length
              if (cnt === 0) return null
              return (
                <button
                  key={type}
                  onClick={() => setFilterType(filterType === type ? 'all' : type)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex items-center gap-1 ${
                    filterType === type ? 'bg-green-700 text-white border-green-600' : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)] hover:border-gray-500'
                  }`}
                >
                  {TYPE_ICON[type]} {ANOMALY_TYPE_LABELS[type]} ({cnt})
                </button>
              )
            })}
          </div>

          {/* Filters row */}
          <div className="flex flex-wrap gap-3">
            <div className="flex gap-1">
              {['all', 'high', 'medium'].map(s => (
                <button key={s} onClick={() => setFilterSeverity(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    filterSeverity === s
                      ? s === 'high' ? 'bg-red-600 text-white border-red-500'
                        : s === 'medium' ? 'bg-yellow-600 text-white border-yellow-500'
                        : 'bg-[var(--surface-3)] text-[var(--text-primary)] border-[var(--border-bright)]'
                      : 'bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-bright)]'
                  }`}>
                  {s === 'all' ? 'All Severity' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            {sites.length > 0 && (
              <select className="input w-48 text-sm" value={filterSite} onChange={e => setFilterSite(e.target.value)}>
                <option value="all">All Sites</option>
                {sites.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>

          {/* Results */}
          {visible.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-4xl mb-3">✅</p>
              <p className="text-[var(--text-primary)] font-semibold">No anomalies found</p>
              <p className="text-[var(--text-secondary)] text-sm mt-2">
                {filterType !== 'all' || filterSeverity !== 'all' || filterSite !== 'all'
                  ? 'No anomalies match your current filters.'
                  : `All ${records.length} records passed the configured detection rules.`}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-muted)]">
                {visible.length} anomal{visible.length !== 1 ? 'ies' : 'y'} detected across {records.length} records
              </p>

              {visible.map(a => {
                const sev    = SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.low
                const isOpen = expanded === a.id
                return (
                  <div key={a.id} className={`rounded-xl border overflow-hidden ${a.severity === 'high' ? 'border-red-800/50' : 'border-yellow-800/40'}`}>
                    {/* Summary row */}
                    <div
                      className={`flex items-start gap-3 p-4 cursor-pointer hover:bg-[var(--surface-2)] transition-colors`}
                      onClick={() => setExpanded(isOpen ? null : a.id)}
                    >
                      <span className="text-xl flex-shrink-0 mt-0.5">{TYPE_ICON[a.type]}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-semibold ${a.severity === 'high' ? 'text-red-300' : 'text-yellow-300'}`}>
                            {a.message}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${sev.badge}`}>
                            {sev.icon} {sev.label}
                          </span>
                          <span className="text-xs bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border-bright)] px-2 py-0.5 rounded-full">
                            {ANOMALY_TYPE_LABELS[a.type]}
                          </span>
                        </div>
                        <p className="text-[var(--text-secondary)] text-xs mt-1">{a.detail}</p>
                        {a.site && <p className="text-[var(--text-muted)] text-xs mt-0.5">📍 {a.site}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={e => { e.stopPropagation(); dismiss(a.id) }}
                          className="text-xs text-[var(--text-dim)] hover:text-[var(--text-secondary)]"
                        >
                          ✕
                        </button>
                        <span className="text-[var(--text-dim)] text-xs">{isOpen ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isOpen && (
                      <div className="border-t border-[var(--border-dim)] bg-[var(--surface-1)] p-4">
                        <AnomalyDetail anomaly={a} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AnomalyDetail({ anomaly: a }) {
  const { activeCurrency } = useSettings()
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-secondary)] font-medium">Affected Records ({a.records.length})</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[var(--text-muted)] border-b border-[var(--border-dim)]">
              <th className="pb-1.5 pr-3 text-left">Date</th>
              <th className="pb-1.5 pr-3 text-left">Asset</th>
              <th className="pb-1.5 pr-3 text-left">Serial</th>
              <th className="pb-1.5 pr-3 text-left">Brand</th>
              <th className="pb-1.5 pr-3 text-left">Site</th>
              <th className="pb-1.5 pr-3 text-left">Risk</th>
              <th className="pb-1.5 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {a.records.map(r => (
              <tr key={r.id} className="border-b border-[var(--border-dim)]">
                <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{r.issue_date || '-'}</td>
                <td className="py-1.5 pr-3 font-mono text-blue-400">{r.asset_no || '-'}</td>
                <td className="py-1.5 pr-3 font-mono text-[var(--text-secondary)]">{r.serial_no || '-'}</td>
                <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{r.brand || '-'}</td>
                <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{r.site || '-'}</td>
                <td className="py-1.5 pr-3">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${
                    r.risk_level === 'High' ? 'bg-red-900/40 text-red-400' :
                    r.risk_level === 'Medium' ? 'bg-yellow-900/40 text-yellow-400' :
                    'bg-[var(--surface-2)] text-[var(--text-secondary)]'
                  }`}>{r.risk_level || '?'}</span>
                </td>
                <td className="py-1.5 text-right text-[var(--text-secondary)]">
                  {r.cost_per_tyre ? formatCurrencyCompact(r.cost_per_tyre, activeCurrency) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Type-specific context */}
      {a.type === ANOMALY_TYPES.SHORT_INTERVAL && (
        <div className="bg-red-900/10 border border-red-800/30 rounded-lg p-3">
          <p className="text-xs text-red-300 font-medium mb-1">Why this matters</p>
          <p className="text-xs text-[var(--text-secondary)]">
            Replacing a tyre only <strong className="text-[var(--text-primary)]">{a.daysDiff} day{a.daysDiff !== 1 ? 's' : ''}</strong> after the previous replacement on Asset {a.asset_no} is unusual.
            This could indicate: premature failure, wrong tyre type for duty, vehicle misuse, or a data entry error on the date.
          </p>
        </div>
      )}
      {a.type === ANOMALY_TYPES.SAME_DAY_BURST && (
        <div className="bg-orange-900/10 border border-orange-800/30 rounded-lg p-3">
          <p className="text-xs text-orange-300 font-medium mb-1">Why this matters</p>
          <p className="text-xs text-[var(--text-secondary)]">
            <strong className="text-[var(--text-primary)]">{a.count} records</strong> (total qty: {a.totalQty}) on Asset {a.asset_no} on {a.date}.
            Could be a full axle replacement (legitimate), a batch entry error, or a vehicle involved in an incident.
          </p>
        </div>
      )}
      {a.type === ANOMALY_TYPES.RAPID_RECURRENCE && (
        <div className="bg-red-900/10 border border-red-800/30 rounded-lg p-3">
          <p className="text-xs text-red-300 font-medium mb-1">Why this matters</p>
          <p className="text-xs text-[var(--text-secondary)]">
            Asset {a.asset_no} had <strong className="text-[var(--text-primary)]">{a.count} high-risk failures in {a.days} days</strong>.
            This asset may require mechanical inspection, route review, or driver behaviour assessment.
          </p>
        </div>
      )}
      {a.type === ANOMALY_TYPES.COST_SPIKE && (
        <div className="bg-yellow-900/10 border border-yellow-800/30 rounded-lg p-3">
          <p className="text-xs text-yellow-300 font-medium mb-1">Why this matters</p>
          <p className="text-xs text-[var(--text-secondary)]">
            Cost {formatCurrencyCompact(a.cost, activeCurrency)} is <strong className="text-[var(--text-primary)]">{a.zScore?.toFixed(1)}σ</strong> from the fleet average ({formatCurrencyCompact(a.fleetAvg, activeCurrency)}).
            Verify the price entry is correct or check for special tyre procurement.
          </p>
        </div>
      )}
      {a.type === ANOMALY_TYPES.SERIAL_REUSE && (
        <div className="bg-purple-900/10 border border-purple-800/30 rounded-lg p-3">
          <p className="text-xs text-purple-300 font-medium mb-1">Why this matters</p>
          <p className="text-xs text-[var(--text-secondary)]">
            Serial <strong className="text-[var(--text-primary)]">{a.serial}</strong> appears on assets: {a.assets?.join(', ')}.
            Either the serial was mis-typed, or a tyre was transferred between vehicles without a proper record.
          </p>
        </div>
      )}
      {a.type === ANOMALY_TYPES.DUPLICATE_ENTRY && (
        <div className="bg-red-900/10 border border-red-800/30 rounded-lg p-3">
          <p className="text-xs text-red-300 font-medium mb-1">Why this matters</p>
          <p className="text-xs text-[var(--text-secondary)]">
            The exact same asset, serial and date combination has been entered <strong className="text-[var(--text-primary)]">{a.count} times</strong>.
            These are likely duplicate uploads and one or more records should be deleted.
          </p>
        </div>
      )}
    </div>
  )
}
