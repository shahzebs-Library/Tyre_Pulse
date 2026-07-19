import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Zap, Plus, Edit2, Trash2, X, Loader2, Search, Filter,
  ToggleLeft, ToggleRight, XCircle, ChevronRight, ChevronDown,
  Bell, Clock, History, AlertTriangle, CheckCircle,
} from 'lucide-react'
import * as businessRules from '../lib/api/businessRules'
import { toUserMessage } from '../lib/safeError'
import { formatDistanceToNow } from 'date-fns'
import { formatDateTime } from '../lib/formatters'

// ─── Constants ────────────────────────────────────────────────────────────────

const OPERATORS = [
  { value: 'lt',       label: '<',        text: 'less than' },
  { value: 'lte',      label: '≤',        text: 'less than or equal' },
  { value: 'gt',       label: '>',        text: 'greater than' },
  { value: 'gte',      label: '≥',        text: 'greater than or equal' },
  { value: 'eq',       label: '=',        text: 'equals' },
  { value: 'neq',      label: '≠',        text: 'not equal' },
  { value: 'contains', label: 'contains', text: 'contains' },
]

const ROLES = [
  { value: 'admin',    label: 'Admin' },
  { value: 'manager',  label: 'Manager' },
  { value: 'director', label: 'Director' },
]

const EXECUTION_STATUS = {
  actioned:           { label: 'Actioned',       badge: 'bg-green-500/20 text-green-400',  icon: CheckCircle },
  conditions_not_met: { label: 'Conditions not met', badge: 'bg-gray-600/40 text-gray-400', icon: Filter },
  skipped_cooldown:   { label: 'Cooldown',       badge: 'bg-yellow-500/20 text-yellow-400', icon: Clock },
  error:              { label: 'Error',          badge: 'bg-red-500/20 text-red-400',      icon: AlertTriangle },
}

function opSymbol(op) { return OPERATORS.find(o => o.value === op)?.label || op }

function conditionSummary(conditions) {
  if (!Array.isArray(conditions) || conditions.length === 0) return 'Always (no conditions)'
  return conditions.map(c => `${c.field} ${opSymbol(c.operator)} ${c.value}`).join(' AND ')
}

function actionSummary(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return '—'
  return actions.map(a =>
    a.type === 'notify_role'
      ? `Notify ${ROLES.find(r => r.value === a.role)?.label || a.role}`
      : `Emit rule.${a.event_type}`,
  ).join(' · ')
}

function relativeTime(ts) {
  if (!ts) return null
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }) }
  catch { return null }
}

// ─── Rule card ────────────────────────────────────────────────────────────────

function RuleCard({ rule, onEdit, onDelete, onToggle }) {
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [executions, setExecutions] = useState(null)   // null = not loaded
  const [execError, setExecError] = useState(null)

  async function handleDelete() {
    if (!window.confirm(`Delete rule "${rule.name}"? Its execution history will also be removed.`)) return
    setDeleting(true)
    await onDelete(rule.id)
    setDeleting(false)
  }

  async function handleToggle() {
    setToggling(true)
    await onToggle(rule.id, !rule.active)
    setToggling(false)
  }

  async function toggleDrawer() {
    const opening = !drawerOpen
    setDrawerOpen(opening)
    if (opening && executions === null) {
      try {
        const rows = await businessRules.listRuleExecutions({ ruleId: rule.id, limit: 20 })
        setExecutions(rows || [])
      } catch (err) {
        setExecError(toUserMessage(err, 'Failed to load executions'))
        setExecutions([])
      }
    }
  }

  const triggered = relativeTime(rule.last_triggered_at)

  return (
    <div className="relative bg-gray-800 rounded-xl border border-gray-700 border-l-4 border-l-purple-500 overflow-hidden hover:border-gray-600 transition-all">
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="shrink-0 mt-0.5 p-2 rounded-lg bg-purple-500/20 text-purple-400">
              <Zap className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm truncate">{rule.name}</p>
              {rule.description && <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{rule.description}</p>}
            </div>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggling}
            title={rule.active ? 'Disable' : 'Enable'}
            className="shrink-0 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            {toggling
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : rule.active ? <ToggleRight className="w-6 h-6 text-orange-500" /> : <ToggleLeft className="w-6 h-6" />}
          </button>
        </div>

        {/* Event type chips */}
        <div className="flex flex-wrap gap-1.5 mt-2.5 ml-11">
          {(rule.event_types || []).map(ev => (
            <span key={ev} className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 text-[10px] font-mono">{ev}</span>
          ))}
        </div>

        {/* Condition + action summaries */}
        <div className="mt-3 ml-11 space-y-1.5">
          <div className="flex items-start gap-1.5 text-xs">
            <Filter className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-gray-300 font-mono text-[11px] leading-relaxed">{conditionSummary(rule.conditions)}</p>
          </div>
          <div className="flex items-start gap-1.5 text-xs">
            <Bell className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" />
            <p className="text-gray-300 text-[11px] leading-relaxed">{actionSummary(rule.actions)}</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-2.5 border-t border-gray-700/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
          <span>
            {rule.triggered_count > 0
              ? `Triggered ${rule.triggered_count} time${rule.triggered_count !== 1 ? 's' : ''}`
              : 'Never triggered'}
          </span>
          {triggered && <span className="text-gray-600">· {triggered}</span>}
          {rule.cooldown_minutes > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 text-[10px]">
              <Clock className="w-2.5 h-2.5" /> {rule.cooldown_minutes}m cooldown
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleDrawer}
            className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
              drawerOpen ? 'text-orange-300 bg-orange-500/15' : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
            title="Recent executions"
          >
            <History className="w-3.5 h-3.5" /> Runs
            {drawerOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          <button onClick={() => onEdit(rule)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-all" title="Edit">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleDelete} disabled={deleting} className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50" title="Delete">
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Executions drawer */}
      {drawerOpen && (
        <div className="px-4 py-3 border-t border-gray-700/60 bg-gray-900/50">
          <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-widest mb-2">Recent executions</p>
          {executions === null ? (
            <div className="py-2 flex justify-center"><Loader2 className="w-4 h-4 text-orange-500 animate-spin" /></div>
          ) : execError ? (
            <p className="text-red-400 text-xs">{execError}</p>
          ) : executions.length === 0 ? (
            <p className="text-gray-600 text-xs">No executions recorded yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {executions.map(ex => {
                const meta = EXECUTION_STATUS[ex.status] || EXECUTION_STATUS.error
                const Icon = meta.icon
                return (
                  <li key={ex.id} className="flex items-center gap-2.5 text-xs">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${meta.badge}`}>
                      <Icon className="w-2.5 h-2.5" /> {meta.label}
                    </span>
                    <span className="text-gray-400">{formatDateTime(ex.created_at)}</span>
                    {ex.event_id && <span className="text-gray-600 font-mono text-[10px]">event #{ex.event_id}</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {!rule.active && !drawerOpen && <div className="absolute inset-0 bg-gray-900/40 rounded-xl pointer-events-none" />}
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
  const [search, setSearch]   = useState('')
  const [filterActive, setFilterActive] = useState('all')

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await businessRules.listBusinessRules()
      setRules(rows || [])
    } catch (err) { setError(toUserMessage(err, 'Failed to load rules')) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetch() }, [fetch])

  const q = search.trim().toLowerCase()
  const visible = rules.filter(r => {
    const matchSearch = !q
      || (r.name || '').toLowerCase().includes(q)
      || (r.description || '').toLowerCase().includes(q)
      || (r.event_types || []).some(ev => ev.toLowerCase().includes(q))
    const matchActive = filterActive === 'all' || (filterActive === 'active' ? r.active : !r.active)
    return matchSearch && matchActive
  })

  async function handleDelete(id) {
    setError(null)
    try {
      await businessRules.deleteBusinessRule(id)
      setRules(prev => prev.filter(r => r.id !== id))
    } catch (err) { setError(toUserMessage(err, 'Delete failed')) }
  }

  async function handleToggle(id, active) {
    setError(null)
    try {
      await businessRules.updateBusinessRule(id, { active })
      setRules(prev => prev.map(r => r.id === id ? { ...r, active } : r))
    } catch (err) { setError(toUserMessage(err, 'Update failed')) }
  }

  const activeCount = rules.filter(r => r.active).length
  const triggeredTotal = rules.reduce((s, r) => s + (r.triggered_count || 0), 0)

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
        <button
          onClick={() => navigate('/automation-rules/builder')}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-lg shadow-orange-500/25 transition-all whitespace-nowrap self-start"
        >
          <Plus className="w-4 h-4" /> New Rule
        </button>
      </div>

      {/* ── Stats ── */}
      {rules.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: 'Total Rules',     value: rules.length,   icon: Zap,         color: 'text-purple-400' },
            { label: 'Active',          value: activeCount,     icon: CheckCircle, color: 'text-green-400' },
            { label: 'Total Triggered', value: triggeredTotal,  icon: Bell,        color: 'text-yellow-400' },
          ].map(s => {
            const Icon = s.icon
            return (
              <div key={s.label} className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 flex items-center gap-3">
                <Icon className={`w-5 h-5 ${s.color} shrink-0`} />
                <div>
                  <p className="text-white font-bold text-xl leading-none">{s.value}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{s.label}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Filters ── */}
      {rules.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search rules..."
              className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white" aria-label="Clear search">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select
            value={filterActive}
            onChange={e => setFilterActive(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all appearance-none cursor-pointer"
          >
            <option value="all">All Status</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2.5 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={fetch}
            className="ml-auto shrink-0 px-3 py-1 text-xs font-semibold text-red-300 bg-red-500/15 hover:bg-red-500/25 rounded-lg border border-red-500/30 transition-all"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-44 rounded-xl bg-gray-800 border border-gray-700 animate-pulse" />)}
        </div>
      )}

      {/* ── Empty ── */}
      {!loading && rules.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 gap-6">
          <div className="w-20 h-20 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
            <Zap className="w-9 h-9 text-gray-500" />
          </div>
          <div className="text-center max-w-md">
            <p className="text-gray-300 text-lg font-medium">No automation rules yet</p>
            <p className="text-gray-500 text-sm mt-1">
              React to fleet events automatically, e.g. notify managers when an inspection records tread depth
              below 3&nbsp;mm at a specific site, or emit follow-up events for webhooks.
            </p>
            <button
              onClick={() => navigate('/automation-rules/builder')}
              className="mt-4 inline-flex items-center gap-2 text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors"
            >
              Create your first rule <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Grid ── */}
      {!loading && rules.length > 0 && (
        visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Filter className="w-8 h-8 text-gray-600" />
            <p className="text-gray-400 text-sm">No rules match your filters.</p>
            <button onClick={() => { setSearch(''); setFilterActive('all') }} className="text-orange-400 text-xs hover:text-orange-300 transition-colors">
              Clear filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {visible.map(r => (
              <RuleCard
                key={r.id}
                rule={r}
                onEdit={rule => navigate(`/automation-rules/builder/${rule.id}`)}
                onDelete={handleDelete}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )
      )}
    </div>
  )
}
