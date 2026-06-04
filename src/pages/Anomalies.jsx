import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  detectAnomalies, summariseAnomalies,
  ANOMALY_TYPES, ANOMALY_TYPE_LABELS, ANOMALY_TYPE_DESC,
} from '../lib/anomalyEngine'

const SEVERITY_STYLE = {
  high:   { badge: 'bg-red-900/40 text-red-400 border-red-700/50',    icon: '🔴', label: 'High' },
  medium: { badge: 'bg-yellow-900/40 text-yellow-400 border-yellow-700/50', icon: '🟡', label: 'Medium' },
  low:    { badge: 'bg-blue-900/40 text-blue-400 border-blue-700/50', icon: '🔵', label: 'Low' },
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

export default function Anomalies() {
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

  // Dismissed anomalies (local)
  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('tp_dismissed_anomalies') || '[]')) }
    catch { return new Set() }
  })

  useEffect(() => {
    supabase
      .from('tyre_records')
      .select('id,issue_date,asset_no,serial_no,brand,site,risk_level,cost_per_tyre,qty,description')
      .order('issue_date', { ascending: true })
      .then(({ data }) => { setRecords(data || []); setLoading(false) })
  }, [])

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
    setDismissed(prev => {
      const next = new Set(prev)
      next.add(id)
      localStorage.setItem('tp_dismissed_anomalies', JSON.stringify([...next]))
      return next
    })
  }

  function clearDismissed() {
    setDismissed(new Set())
    localStorage.removeItem('tp_dismissed_anomalies')
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

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading tyre records…</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Anomaly Detection</h1>
          <p className="text-gray-400 text-sm mt-1">
            Detect short intervals, same-day bursts, rapid recurrence, cost spikes and duplicates
          </p>
        </div>
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
            {running ? 'Scanning…' : hasRun ? '↻ Re-scan' : '▶ Run Scan'}
          </button>
        </div>
      </div>

      {/* What this scans — info cards */}
      {!hasRun && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(ANOMALY_TYPES).map(([key, type]) => (
            <div key={type} className="card flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">{TYPE_ICON[type]}</span>
              <div>
                <p className="text-white text-sm font-semibold">{ANOMALY_TYPE_LABELS[type]}</p>
                <p className="text-gray-400 text-xs mt-1">{ANOMALY_TYPE_DESC[type]}</p>
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
          <p className="text-xs text-gray-500 mt-3">Changes apply on next scan.</p>
        </div>
      )}

      {/* Summary after scan */}
      {hasRun && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'High',   count: summary.bySeverity.high,   style: SEVERITY_STYLE.high },
              { label: 'Medium', count: summary.bySeverity.medium, style: SEVERITY_STYLE.medium },
              { label: 'Total',  count: summary.total,             style: { badge: 'bg-gray-800 text-gray-300 border-gray-700', icon: '⚪' } },
            ].map(({ label, count, style }) => (
              <div key={label} className={`card border ${style.badge}`}>
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-sm mt-1 text-gray-400">{label} anomalies</p>
              </div>
            ))}
          </div>

          {/* Type breakdown pills */}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setFilterType('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                filterType === 'all' ? 'bg-blue-600 text-white border-blue-500' : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500'
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
                    filterType === type ? 'bg-blue-600 text-white border-blue-500' : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500'
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
                        : 'bg-gray-700 text-white border-gray-600'
                      : 'bg-gray-800 text-gray-400 border-gray-700'
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
              <p className="text-white font-semibold">No anomalies found</p>
              <p className="text-gray-400 text-sm mt-2">
                {filterType !== 'all' || filterSeverity !== 'all' || filterSite !== 'all'
                  ? 'No anomalies match your current filters.'
                  : `All ${records.length} records passed the configured detection rules.`}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                {visible.length} anomal{visible.length !== 1 ? 'ies' : 'y'} detected across {records.length} records
              </p>

              {visible.map(a => {
                const sev    = SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.low
                const isOpen = expanded === a.id
                return (
                  <div key={a.id} className={`rounded-xl border overflow-hidden ${a.severity === 'high' ? 'border-red-800/50' : 'border-yellow-800/40'}`}>
                    {/* Summary row */}
                    <div
                      className={`flex items-start gap-3 p-4 cursor-pointer hover:bg-gray-800/20 transition-colors`}
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
                          <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 px-2 py-0.5 rounded-full">
                            {ANOMALY_TYPE_LABELS[a.type]}
                          </span>
                        </div>
                        <p className="text-gray-400 text-xs mt-1">{a.detail}</p>
                        {a.site && <p className="text-gray-500 text-xs mt-0.5">📍 {a.site}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={e => { e.stopPropagation(); dismiss(a.id) }}
                          className="text-xs text-gray-600 hover:text-gray-400"
                        >
                          ✕
                        </button>
                        <span className="text-gray-600 text-xs">{isOpen ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isOpen && (
                      <div className="border-t border-gray-800 bg-gray-900/50 p-4">
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
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 font-medium">Affected Records ({a.records.length})</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
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
              <tr key={r.id} className="border-b border-gray-800/40">
                <td className="py-1.5 pr-3 text-gray-300">{r.issue_date || '—'}</td>
                <td className="py-1.5 pr-3 font-mono text-blue-400">{r.asset_no || '—'}</td>
                <td className="py-1.5 pr-3 font-mono text-gray-400">{r.serial_no || '—'}</td>
                <td className="py-1.5 pr-3 text-gray-300">{r.brand || '—'}</td>
                <td className="py-1.5 pr-3 text-gray-400">{r.site || '—'}</td>
                <td className="py-1.5 pr-3">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${
                    r.risk_level === 'High' ? 'bg-red-900/40 text-red-400' :
                    r.risk_level === 'Medium' ? 'bg-yellow-900/40 text-yellow-400' :
                    'bg-gray-800 text-gray-400'
                  }`}>{r.risk_level || '?'}</span>
                </td>
                <td className="py-1.5 text-right text-gray-400">
                  {r.cost_per_tyre ? `SAR ${r.cost_per_tyre.toLocaleString()}` : '—'}
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
          <p className="text-xs text-gray-400">
            Replacing a tyre only <strong className="text-white">{a.daysDiff} day{a.daysDiff !== 1 ? 's' : ''}</strong> after the previous replacement on Asset {a.asset_no} is unusual.
            This could indicate: premature failure, wrong tyre type for duty, vehicle misuse, or a data entry error on the date.
          </p>
        </div>
      )}
      {a.type === ANOMALY_TYPES.SAME_DAY_BURST && (
        <div className="bg-orange-900/10 border border-orange-800/30 rounded-lg p-3">
          <p className="text-xs text-orange-300 font-medium mb-1">Why this matters</p>
          <p className="text-xs text-gray-400">
            <strong className="text-white">{a.count} records</strong> (total qty: {a.totalQty}) on Asset {a.asset_no} on {a.date}.
            Could be a full axle replacement (legitimate), a batch entry error, or a vehicle involved in an incident.
          </p>
        </div>
      )}
      {a.type === ANOMALY_TYPES.RAPID_RECURRENCE && (
        <div className="bg-red-900/10 border border-red-800/30 rounded-lg p-3">
          <p className="text-xs text-red-300 font-medium mb-1">Why this matters</p>
          <p className="text-xs text-gray-400">
            Asset {a.asset_no} had <strong className="text-white">{a.count} high-risk failures in {a.days} days</strong>.
            This asset may require mechanical inspection, route review, or driver behaviour assessment.
          </p>
        </div>
      )}
      {a.type === ANOMALY_TYPES.COST_SPIKE && (
        <div className="bg-yellow-900/10 border border-yellow-800/30 rounded-lg p-3">
          <p className="text-xs text-yellow-300 font-medium mb-1">Why this matters</p>
          <p className="text-xs text-gray-400">
            Cost SAR {a.cost?.toLocaleString()} is <strong className="text-white">{a.zScore?.toFixed(1)}σ</strong> from the fleet average (SAR {a.fleetAvg?.toLocaleString()}).
            Verify the price entry is correct or check for special tyre procurement.
          </p>
        </div>
      )}
      {a.type === ANOMALY_TYPES.SERIAL_REUSE && (
        <div className="bg-purple-900/10 border border-purple-800/30 rounded-lg p-3">
          <p className="text-xs text-purple-300 font-medium mb-1">Why this matters</p>
          <p className="text-xs text-gray-400">
            Serial <strong className="text-white">{a.serial}</strong> appears on assets: {a.assets?.join(', ')}.
            Either the serial was mis-typed, or a tyre was transferred between vehicles without a proper record.
          </p>
        </div>
      )}
      {a.type === ANOMALY_TYPES.DUPLICATE_ENTRY && (
        <div className="bg-red-900/10 border border-red-800/30 rounded-lg p-3">
          <p className="text-xs text-red-300 font-medium mb-1">Why this matters</p>
          <p className="text-xs text-gray-400">
            The exact same asset, serial and date combination has been entered <strong className="text-white">{a.count} times</strong>.
            These are likely duplicate uploads and one or more records should be deleted.
          </p>
        </div>
      )}
    </div>
  )
}
