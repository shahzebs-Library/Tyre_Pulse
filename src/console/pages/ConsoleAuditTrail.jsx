import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ShieldCheck, Search, RefreshCw, Download, ChevronRight, ChevronDown, Info,
} from 'lucide-react'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  AUDIT_SOURCES, listDataAudit, listAccessAudit, listConsoleAudit,
} from '../../lib/api/auditTrail'
import { exportToExcel } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

// Read-only unified audit viewer (Module 6). Reads three independently-owned
// audit tables (data changes, access control, console actions) through the
// auditTrail service, which normalises every row to one common shape. No writes.

const SINCE_OPTIONS = [
  { key: '24h', label: 'Last 24 hours', days: 1 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: 'all', label: 'All time', days: null },
]

// Per-source list function + plain-English help shown under the header.
const SOURCE_META = {
  audit_log_v2: {
    list: listDataAudit,
    help: 'Row level changes to operational records: who edited, created or deleted a row, and the before and after values.',
  },
  access_audit: {
    list: listAccessAudit,
    help: 'Access control history: role changes, permission grants and other privileged account changes.',
  },
  console_sessions: {
    list: listConsoleAudit,
    help: 'Console administrator actions such as sign in, account lock and configuration changes.',
  },
}

function sinceIso(key) {
  const opt = SINCE_OPTIONS.find((o) => o.key === key)
  if (!opt || opt.days == null) return undefined
  return new Date(Date.now() - opt.days * 86400000).toISOString()
}

function fmtWhen(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString()
}

/** Pretty JSON block or an honest empty note. */
function JsonBlock({ label, value }) {
  const empty = value == null || (typeof value === 'object' && Object.keys(value).length === 0)
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">{label}</p>
      {empty ? (
        <p className="text-xs text-gray-600 italic">No values</p>
      ) : (
        <pre className="text-[11px] text-gray-300 bg-gray-800 rounded-lg p-2.5 overflow-x-auto max-h-56">
          {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  )
}

export default function ConsoleAuditTrail() {
  useConsoleAuth() // gate: rendered only inside the super-admin console shell

  const [sourceKey, setSourceKey] = useState('audit_log_v2')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [since, setSince] = useState('7d')
  const [expanded, setExpanded] = useState(null)

  const meta = SOURCE_META[sourceKey] || SOURCE_META.audit_log_v2

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setExpanded(null)
    try {
      const data = await meta.list({
        action: actionFilter || undefined,
        since: sinceIso(since),
        limit: 200,
      })
      setRows(Array.isArray(data) ? data : [])
    } catch {
      setRows([])
      setError('Could not load audit entries. Please try again.')
    } finally {
      setLoading(false)
    }
    // meta is derived from sourceKey; depend on the primitive instead.
  }, [sourceKey, actionFilter, since]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  // Reset action filter + expansion when switching source (actions differ).
  function switchSource(key) {
    if (key === sourceKey) return
    setSourceKey(key)
    setActionFilter('')
    setExpanded(null)
  }

  // Distinct actions in the loaded set drive the action dropdown.
  const actionOptions = useMemo(
    () => [...new Set(rows.map((r) => r.action).filter(Boolean))].sort(),
    [rows],
  )

  // Free-text search across actor / action / target / detail.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      (r.actor || '').toLowerCase().includes(q) ||
      (r.action || '').toLowerCase().includes(q) ||
      (r.target || '').toLowerCase().includes(q) ||
      (r.detail || '').toLowerCase().includes(q),
    )
  }, [rows, search])

  const canDiff = sourceKey === 'audit_log_v2'
  const hasFilters = !!(search || actionFilter || since !== '7d')

  async function onExport() {
    if (filtered.length === 0) return
    const cols = ['when', 'actor', 'action', 'target', 'detail', 'source']
    const headers = ['Time', 'Actor', 'Action', 'Target', 'Detail', 'Source']
    const exportRows = filtered.map((r) => ({
      when: fmtWhen(r.when),
      actor: r.actor || '',
      action: r.action || '',
      target: r.target || '',
      detail: r.detail || '',
      source: r.source || '',
    }))
    const label = AUDIT_SOURCES.find((s) => s.key === sourceKey)?.label || 'Audit'
    try {
      await exportToExcel(exportRows, cols, headers, `Audit Trail ${label}`, 'Audit')
    } catch (err) {
      setError(toUserMessage(err, 'Could not export. Please try again.'))
    }
  }

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck size={18} className="text-orange-400" /> Audit Trail
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Read only history across data changes, access control and console actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onExport} disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 disabled:opacity-40 transition-colors">
            <Download size={12} /> Export Excel
          </button>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 disabled:opacity-50 transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Source segmented control */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-gray-900/60 border border-gray-800 w-fit">
        {AUDIT_SOURCES.map((s) => (
          <button key={s.key} onClick={() => switchSource(s.key)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              sourceKey === s.key
                ? 'bg-orange-500 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Plain-English source help */}
      <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-900/40 border border-gray-800 rounded-lg px-3 py-2">
        <Info size={13} className="mt-0.5 flex-shrink-0 text-gray-600" />
        <span>{meta.help}</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actor, action, target, detail..."
            className="w-full h-9 bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-orange-500" />
        </div>
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}
          className="h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:outline-none focus:border-orange-500">
          <option value="">All actions</option>
          {actionOptions.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={since} onChange={(e) => setSince(e.target.value)}
          className="h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:outline-none focus:border-orange-500">
          {SINCE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        {hasFilters && (
          <button onClick={() => { setSearch(''); setActionFilter(''); setSince('7d') }}
            className="h-9 px-3 rounded-lg text-xs text-gray-500 hover:text-white bg-gray-800 border border-gray-700 transition-colors">
            Clear
          </button>
        )}
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-500">
          <p className="text-sm mb-3">{error}</p>
          <button onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:text-white text-xs border border-gray-700 transition-colors">
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-600">
          <ShieldCheck size={32} className="mb-2 opacity-30" />
          <p className="text-sm">No audit entries for these filters</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-gray-900/60 border-b border-gray-800">
            <p className="text-[11px] text-gray-500">{filtered.length.toLocaleString()} entries</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/60">
                  {canDiff && <th className="w-8 px-3 py-3" />}
                  <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Time</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Actor</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Action</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Target</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider">Detail</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const key = `${r.source}-${r.id ?? i}`
                  const isOpen = expanded === key
                  return (
                    <FragmentRow
                      key={key}
                      row={r}
                      rowKey={key}
                      isOpen={isOpen}
                      canDiff={canDiff}
                      onToggle={() => setExpanded(isOpen ? null : key)}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function FragmentRow({ row, rowKey, isOpen, canDiff, onToggle }) {
  const clickable = canDiff
  return (
    <>
      <tr
        className={`border-b border-gray-800/60 hover:bg-gray-800/20 transition-colors ${clickable ? 'cursor-pointer' : ''}`}
        onClick={clickable ? onToggle : undefined}>
        {canDiff && (
          <td className="px-3 py-2.5 text-gray-600">
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </td>
        )}
        <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{fmtWhen(row.when)}</td>
        <td className="px-4 py-2.5 text-gray-300 max-w-[220px] truncate" title={row.actor || ''}>
          {row.actor || 'N/A'}
          {row.role && <span className="ml-1.5 text-[10px] text-gray-600">({row.role})</span>}
        </td>
        <td className="px-4 py-2.5">
          <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded border font-semibold capitalize whitespace-nowrap bg-gray-800 text-gray-300 border-gray-700">
            {(row.action || 'N/A').replace(/_/g, ' ')}
          </span>
        </td>
        <td className="px-4 py-2.5 text-gray-400 max-w-[220px] truncate" title={row.target || ''}>
          {row.target || 'N/A'}
        </td>
        <td className="px-4 py-2.5 text-gray-500 max-w-xs truncate" title={row.detail || ''}>
          {row.detail || 'N/A'}
        </td>
      </tr>
      {canDiff && isOpen && (
        <tr key={`${rowKey}-exp`} className="border-b border-gray-800/40 bg-gray-900/30">
          <td colSpan={6} className="px-6 py-3">
            <div className="flex flex-col sm:flex-row gap-4">
              <JsonBlock label="Before" value={row.old} />
              <JsonBlock label="After" value={row.new} />
            </div>
            {row.id != null && <p className="text-[10px] text-gray-700 mt-2">Entry ID: {String(row.id)}</p>}
          </td>
        </tr>
      )}
    </>
  )
}
