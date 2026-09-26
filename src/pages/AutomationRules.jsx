import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Zap, Plus, Edit2, Trash2, X, Loader2, Search, Filter,
  ToggleLeft, ToggleRight, XCircle, Bell, Clock, History, AlertTriangle, CheckCircle,
  PauseCircle, Ban, FileSpreadsheet, FileText, RefreshCw, Activity,
} from 'lucide-react'
import * as businessRules from '../lib/api/businessRules'
import { toUserMessage } from '../lib/safeError'
import { formatDistanceToNow } from 'date-fns'
import { formatDateTime } from '../lib/formatters'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import {
  EXECUTION_SAMPLE_LIMIT, EXECUTION_STATUS_LABEL, DORMANT_DAYS,
  automationKpis, filterRules, ruleEventTypes, ruleTableRows, executionStatusBreakdown,
  activityLabel, ruleExportRows, RULE_EXPORT_COLS, RULE_EXPORT_HEADERS,
} from '../lib/automationRulesAnalytics'

// ─── Constants ────────────────────────────────────────────────────────────────

const EXECUTION_STATUS = {
  actioned:           { badge: 'bg-green-500/20 text-green-400',   icon: CheckCircle },
  conditions_not_met: { badge: 'bg-gray-600/40 text-gray-400',     icon: Filter },
  skipped_cooldown:   { badge: 'bg-yellow-500/20 text-yellow-400', icon: Clock },
  error:              { badge: 'bg-red-500/20 text-red-400',       icon: AlertTriangle },
}

const BAR_TONE = {
  actioned: 'bg-green-500/70',
  conditions_not_met: 'bg-gray-500/70',
  skipped_cooldown: 'bg-yellow-500/70',
  error: 'bg-red-500/70',
}

const ACTIVITY_TONE = {
  never: 'bg-gray-700 text-gray-300',
  dormant: 'bg-yellow-500/20 text-yellow-400',
  recent: 'bg-green-500/20 text-green-400',
  fired: 'bg-blue-500/20 text-blue-300',
}

function relativeTime(ts) {
  if (!ts) return null
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }) }
  catch { return null }
}

const fmtNum = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())
const fmtPct = (v) => (v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`)

function Kpi({ icon: Icon, label, value, hint, tone = 'text-orange-400', loading, onClick, active }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`text-left bg-gray-800 border rounded-xl px-4 py-3 ${active ? 'border-orange-500' : 'border-gray-700'} ${onClick ? 'hover:border-gray-500 transition-colors' : ''}`}
    >
      <div className="flex items-center gap-2 text-gray-400 text-xs"><Icon className={`w-4 h-4 ${tone}`} /> {label}</div>
      {loading
        ? <div className="h-7 mt-1.5 w-16 rounded bg-gray-700/60 animate-pulse" />
        : <p className="text-white font-bold text-xl mt-1">{value}</p>}
      {hint && !loading && <p className="text-gray-500 text-[11px] mt-0.5">{hint}</p>}
    </Tag>
  )
}

// ─── Rule detail (recent runs of one rule) ────────────────────────────────────

function RuleDetail({ rule, onClose }) {
  const [executions, setExecutions] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setExecutions(null)
    setError(null)
    try {
      const rows = await businessRules.listRuleExecutions({ ruleId: rule.id, limit: 20 })
      setExecutions(rows || [])
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load executions'))
    }
  }, [rule.id])

  useEffect(() => { load() }, [load])

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-white font-semibold text-sm">{rule.name}</h2>
          {rule.description && <p className="text-gray-500 text-xs mt-0.5">{rule.description}</p>}
        </div>
        <button onClick={onClose} aria-label="Close rule detail" className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid sm:grid-cols-2 gap-3 text-xs">
        <div className="flex items-start gap-1.5">
          <Filter className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-gray-300 font-mono text-[11px]">{rule.conditionText}</p>
        </div>
        <div className="flex items-start gap-1.5">
          <Bell className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" />
          <p className="text-gray-300 text-[11px]">{rule.actionText}</p>
        </div>
      </div>
      <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-widest">Recent executions</p>
      {error ? (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <XCircle className="w-4 h-4" /> {error}
          <button onClick={load} className="ml-auto px-2 py-1 rounded bg-red-500/15 text-red-300 border border-red-500/30">Retry</button>
        </div>
      ) : executions === null ? (
        <div className="py-2 flex justify-center"><Loader2 className="w-4 h-4 text-orange-500 animate-spin" /></div>
      ) : executions.length === 0 ? (
        <p className="text-gray-500 text-xs">No executions recorded yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {executions.map(ex => {
            const meta = EXECUTION_STATUS[ex.status] || EXECUTION_STATUS.error
            const Icon = meta.icon
            return (
              <li key={ex.id} className="flex items-center gap-2.5 text-xs flex-wrap">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${meta.badge}`}>
                  <Icon className="w-2.5 h-2.5" /> {EXECUTION_STATUS_LABEL[ex.status] || 'Error'}
                </span>
                <span className="text-gray-400">{formatDateTime(ex.created_at)}</span>
                {ex.event_id && <span className="text-gray-600 font-mono text-[10px]">event #{ex.event_id}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ─── Builder is a routed page (RuleBuilder, /automation-rules/builder) ─────────
// The former RuleModal was extracted verbatim into src/pages/RuleBuilder.jsx per
// the app-wide "large modals become dedicated pages" rule. This page navigates
// there for create/edit instead of mounting an in-page modal.

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AutomationRules() {
  const navigate = useNavigate()
  const [rules, setRules]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [actionError, setActionError] = useState(null)
  const [executions, setExecutions] = useState(null)   // null = not read
  const [execLoading, setExecLoading] = useState(true)
  const [execError, setExecError] = useState(null)
  const [search, setSearch]   = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [activity, setActivity] = useState('all')
  const [eventType, setEventType] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [busyId, setBusyId]   = useState(null)
  const [now, setNow]         = useState(() => new Date())

  const fetchRules = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await businessRules.listBusinessRules()
      setRules(rows || [])
      setNow(new Date())
    } catch (err) { setError(toUserMessage(err, 'Failed to load rules')) }
    finally { setLoading(false) }
  }, [])

  const fetchExecutions = useCallback(async () => {
    setExecLoading(true)
    setExecError(null)
    try {
      const rows = await businessRules.listRuleExecutions({ limit: EXECUTION_SAMPLE_LIMIT })
      setExecutions(rows || [])
    } catch (err) {
      setExecutions(null)
      setExecError(toUserMessage(err, 'Failed to load rule executions'))
    } finally { setExecLoading(false) }
  }, [])

  useEffect(() => { fetchRules() }, [fetchRules])
  useEffect(() => { fetchExecutions() }, [fetchExecutions])

  const kpis = useMemo(() => automationKpis({ rules, executions, now }), [rules, executions, now])
  const breakdown = useMemo(() => executionStatusBreakdown(executions || []), [executions])
  const eventTypes = useMemo(() => ruleEventTypes(rules), [rules])
  const tableRows = useMemo(() => ruleTableRows(
    filterRules(rules, { search, status: statusFilter, activity, eventType, now }),
    executions || [], { now },
  ), [rules, executions, search, statusFilter, activity, eventType, now])
  const selected = selectedId ? ruleTableRows(rules.filter((r) => r.id === selectedId), executions || [], { now })[0] : null

  const hasFilters = !!search.trim() || statusFilter !== 'all' || activity !== 'all' || eventType !== 'all'
  function clearFilters() { setSearch(''); setStatusFilter('all'); setActivity('all'); setEventType('all') }

  async function handleDelete(rule) {
    if (!window.confirm(`Delete rule "${rule.name}"? Its execution history will also be removed.`)) return
    setActionError(null)
    setBusyId(rule.id)
    try {
      await businessRules.deleteBusinessRule(rule.id)
      setRules(prev => prev.filter(r => r.id !== rule.id))
      if (selectedId === rule.id) setSelectedId(null)
    } catch (err) { setActionError(toUserMessage(err, 'Delete failed')) }
    finally { setBusyId(null) }
  }

  async function handleToggle(rule) {
    setActionError(null)
    setBusyId(rule.id)
    try {
      await businessRules.updateBusinessRule(rule.id, { active: !rule.active })
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, active: !rule.active } : r))
    } catch (err) { setActionError(toUserMessage(err, 'Update failed')) }
    finally { setBusyId(null) }
  }

  const columns = useMemo(() => [
    {
      id: 'name',
      header: 'Rule',
      accessorKey: 'name',
      cell: ({ row }) => (
        <div className="min-w-[180px]">
          <p className="text-white text-sm font-medium">{row.original.name}</p>
          <p className="text-gray-500 text-[11px] font-mono truncate max-w-[260px]" title={row.original.conditionText}>{row.original.conditionText}</p>
        </div>
      ),
    },
    {
      id: 'active',
      header: 'Status',
      accessorFn: (r) => (r.active ? 'Active' : 'Paused'),
      cell: ({ row }) => (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${row.original.active ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
          {row.original.active ? 'Active' : 'Paused'}
        </span>
      ),
    },
    {
      id: 'event_types',
      header: 'Event Types',
      accessorFn: (r) => (r.event_types || []).join(', '),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1 max-w-[220px]">
          {(row.original.event_types || []).map(ev => (
            <span key={ev} className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 text-[10px] font-mono">{ev}</span>
          ))}
          {!(row.original.event_types || []).length && <span className="text-gray-500 text-xs">N/A</span>}
        </div>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      accessorKey: 'actionText',
      cell: ({ getValue }) => <span className="text-gray-300 text-xs">{getValue()}</span>,
    },
    {
      id: 'triggered',
      header: 'Triggered',
      accessorFn: (r) => r.triggered ?? -1,
      meta: { align: 'right' },
      cell: ({ row }) => <span className="text-gray-300 text-xs">{fmtNum(row.original.triggered)}</span>,
    },
    {
      id: 'last',
      header: 'Last Fired',
      accessorFn: (r) => r.lastTriggeredMs ?? 0,
      cell: ({ row }) => (
        <span className="text-gray-400 text-xs whitespace-nowrap">
          {row.original.last_triggered_at ? relativeTime(row.original.last_triggered_at) : 'Never'}
        </span>
      ),
    },
    {
      id: 'activity',
      header: 'Activity',
      accessorFn: (r) => activityLabel(r.activity),
      cell: ({ row }) => (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${ACTIVITY_TONE[row.original.activity] || ACTIVITY_TONE.never}`}>
          {activityLabel(row.original.activity)}
        </span>
      ),
    },
    {
      id: 'runs',
      header: 'Recent Runs',
      accessorFn: (r) => r.sampleRuns,
      meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="text-xs text-gray-300">
          {row.original.sampleRuns}
          {row.original.sampleErrors > 0 && <span className="text-red-400"> ({row.original.sampleErrors} errors)</span>}
        </span>
      ),
    },
    {
      id: 'controls',
      header: '',
      enableSorting: false,
      meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        const busy = busyId === r.id
        return (
          <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => handleToggle(r)} disabled={busy} title={r.active ? 'Pause rule' : 'Activate rule'} aria-label={r.active ? 'Pause rule' : 'Activate rule'} className="p-1 text-gray-400 hover:text-white disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : r.active ? <ToggleRight className="w-5 h-5 text-orange-500" /> : <ToggleLeft className="w-5 h-5" />}
            </button>
            <button onClick={() => setSelectedId(r.id)} title="Recent runs" aria-label="Recent runs" className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700">
              <History className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => navigate(`/automation-rules/builder/${r.id}`)} title="Edit" aria-label="Edit rule" className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => handleDelete(r)} disabled={busy} title="Delete" aria-label="Delete rule" className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      },
    },
  // handleToggle/handleDelete close over state setters only; busyId drives the spinner.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [busyId, navigate])

  const exportRows = ruleExportRows(tableRows)
  const fileBase = reportFileName('Automation Rules', hasFilters ? 'filtered' : '')
  const doExcel = () => exportToExcel(exportRows, RULE_EXPORT_COLS, RULE_EXPORT_HEADERS, fileBase, 'Rules')
  const doPdf = () => exportToPdf(
    exportRows,
    RULE_EXPORT_COLS.map((k, i) => ({ key: k, header: RULE_EXPORT_HEADERS[i] })),
    'Automation Rules', fileBase, 'landscape',
  )

  const runsHint = kpis.runs == null
    ? 'Executions unavailable'
    : `${kpis.sampleTruncated ? 'Latest ' : ''}${kpis.runs.toLocaleString()} run${kpis.runs === 1 ? '' : 's'}`

  return (
    <div className="text-white space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-2 rounded-lg bg-orange-500/20">
              <Zap className="w-5 h-5 text-orange-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Automation Rules</h1>
          </div>
          <p className="text-gray-400 text-sm ml-11">If-this-then-that rules evaluated on every domain event</p>
        </div>
        <div className="flex flex-wrap gap-2 self-start">
          <button onClick={doExcel} disabled={loading || tableRows.length === 0} className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-50">
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </button>
          <button onClick={doPdf} disabled={loading || tableRows.length === 0} className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-50">
            <FileText className="w-4 h-4" /> PDF
          </button>
          <button onClick={() => { fetchRules(); fetchExecutions() }} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            onClick={() => navigate('/automation-rules/builder')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-lg shadow-orange-500/25 transition-all whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> New Rule
          </button>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={Zap} label="Active rules" value={`${kpis.active} of ${kpis.total}`} tone="text-green-400" loading={loading}
          onClick={() => setStatusFilter(statusFilter === 'active' ? 'all' : 'active')} active={statusFilter === 'active'} hint="Click to filter" />
        <Kpi icon={PauseCircle} label="Paused" value={fmtNum(kpis.paused)} tone="text-gray-400" loading={loading}
          onClick={() => setStatusFilter(statusFilter === 'paused' ? 'all' : 'paused')} active={statusFilter === 'paused'} hint="Click to filter" />
        <Kpi icon={Bell} label="Times triggered" value={fmtNum(kpis.triggeredTotal)} tone="text-yellow-400" loading={loading} hint="All time, all rules" />
        <Kpi icon={Activity} label="Run success rate" value={fmtPct(kpis.successRate)} tone="text-green-400" loading={execLoading} hint={runsHint} />
        <Kpi icon={AlertTriangle} label="Run failure rate" value={fmtPct(kpis.failureRate)} tone="text-red-400" loading={execLoading}
          hint={kpis.errors == null ? 'Executions unavailable' : `${kpis.errors.toLocaleString()} errors`} />
        <Kpi icon={Ban} label="Never fired" value={fmtNum(kpis.neverFired)} tone="text-purple-400" loading={loading}
          onClick={() => setActivity(activity === 'never' ? 'all' : 'never')} active={activity === 'never'}
          hint={`${kpis.dormant} active but silent over ${DORMANT_DAYS} days`} />
      </div>

      {/* ── Execution breakdown ── */}
      {execError ? (
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{execError}</p>
          <button onClick={fetchExecutions} className="ml-auto px-3 py-1 text-xs font-semibold text-red-300 bg-red-500/15 rounded-lg border border-red-500/30">Retry</button>
        </div>
      ) : !execLoading && kpis.runs > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="text-sm font-semibold text-white">Recent run outcomes</h2>
            <span className="text-[11px] text-gray-500">
              {kpis.sampleTruncated ? `Newest ${kpis.runs.toLocaleString()} runs only` : `All ${kpis.runs.toLocaleString()} recorded runs`}
            </span>
          </div>
          <div className="flex h-3 rounded overflow-hidden bg-gray-700">
            {breakdown.filter((b) => b.count > 0).map((b) => (
              <div key={b.status} className={BAR_TONE[b.status]} style={{ width: `${(b.share || 0) * 100}%` }} title={`${b.label}: ${b.count}`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs text-gray-400">
            {breakdown.map((b) => (
              <span key={b.status} className="inline-flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-sm ${BAR_TONE[b.status]}`} /> {b.label}: {b.count.toLocaleString()} ({fmtPct(b.share)})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search rules by name, description or event type..."
            aria-label="Search rules"
            className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white" aria-label="Clear search">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Rule status" className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white cursor-pointer">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </select>
        <select value={activity} onChange={e => setActivity(e.target.value)} aria-label="Rule activity" className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white cursor-pointer">
          <option value="all">All activity</option>
          <option value="recent">Recently fired</option>
          <option value="dormant">Dormant (active, silent)</option>
          <option value="never">Never fired</option>
          <option value="fired">Fired (paused or undated)</option>
        </select>
        <select value={eventType} onChange={e => setEventType(e.target.value)} aria-label="Event type" className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white cursor-pointer">
          <option value="all">All event types</option>
          {eventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="px-3 py-2.5 rounded-xl text-sm text-orange-400 border border-gray-700 bg-gray-800">Clear filters</button>
        )}
      </div>

      {actionError && (
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{actionError}</p>
          <button onClick={() => setActionError(null)} aria-label="Dismiss" className="ml-auto text-red-300"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ── Empty (no rules at all) ── */}
      {!loading && !error && rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-6">
          <div className="w-20 h-20 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
            <Zap className="w-9 h-9 text-gray-500" />
          </div>
          <div className="text-center max-w-md">
            <p className="text-gray-300 text-lg font-medium">No automation rules yet</p>
            <p className="text-gray-500 text-sm mt-1">
              React to fleet events automatically, for example notify managers when an inspection records tread depth
              below 3&nbsp;mm at a specific site, or emit follow-up events for webhooks.
            </p>
            <button
              onClick={() => navigate('/automation-rules/builder')}
              className="mt-4 inline-flex items-center gap-2 text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" /> Create your first rule
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <EnterpriseTable
            columns={columns}
            data={tableRows}
            getRowId={(r) => String(r.id)}
            loading={loading}
            error={error}
            onRetry={fetchRules}
            emptyMessage="No rules match your filters"
            emptyIcon={<Filter className="w-7 h-7 text-gray-500" />}
            enableGlobalFilter={false}
            enableExport={false}
            initialPageSize={25}
            onRowClick={(r) => setSelectedId((cur) => (cur === r.id ? null : r.id))}
          />
          {selected && <RuleDetail key={selected.id} rule={selected} onClose={() => setSelectedId(null)} />}
        </div>
      )}
    </div>
  )
}
