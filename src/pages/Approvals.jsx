import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  CheckSquare, X, Search, Clock, Inbox, Filter, AlertTriangle,
  ClipboardList, CheckCircle2, XCircle, Undo2, Timer, RefreshCw,
  ChevronRight, ServerCrash,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import * as workflows from '../lib/api/workflows'
import { useAuth } from '../contexts/AuthContext'
import { formatDistanceToNow } from 'date-fns'
import PageHeader from '../components/ui/PageHeader'
import ApprovalStatusBadge from '../components/workflow/ApprovalStatusBadge'
import ApprovalAction from '../components/workflow/ApprovalAction'
import ApprovalTrail from '../components/workflow/ApprovalTrail'
import { stepRequirements } from '../lib/workflow/stepRequirements'

// ─── Bucket + metric definitions ───────────────────────────────────────────────

const BUCKETS = [
  { key: 'pending',            label: 'Pending',           icon: Clock,         tone: 'amber'  },
  { key: 'overdue',            label: 'Overdue',           icon: AlertTriangle, tone: 'red'    },
  { key: 'returned',           label: 'Returned',          icon: Undo2,         tone: 'orange' },
  { key: 'rejected',           label: 'Rejected',          icon: XCircle,       tone: 'red'    },
  { key: 'recently_approved',  label: 'Recently Approved', icon: CheckCircle2,  tone: 'green'  },
]

const EMPTY_BUCKETS = {
  pending: [], overdue: [], returned: [], rejected: [], recently_approved: [],
}

const TONE_TEXT = {
  amber:  'text-amber-400',
  red:    'text-red-400',
  orange: 'text-orange-400',
  green:  'text-green-400',
  blue:   'text-blue-400',
  gray:   'text-gray-400',
}

const TONE_TAB_ACTIVE = {
  amber:  'bg-amber-500/15 text-amber-300 border-amber-500/40',
  red:    'bg-red-500/15 text-red-300 border-red-500/40',
  orange: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  green:  'bg-green-500/15 text-green-300 border-green-500/40',
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function relTime(ts) {
  if (!ts) return null
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }) }
  catch { return null }
}

/** Milliseconds since a timestamp, or null. */
function ageMs(ts) {
  if (!ts) return null
  const t = new Date(ts).getTime()
  return Number.isNaN(t) ? null : Math.max(0, Date.now() - t)
}

function currentStepOf(instance) {
  const steps = Array.isArray(instance?.steps) ? instance.steps : []
  const idx = Math.min(Math.max(instance?.current_step ?? 0, 0), Math.max(steps.length - 1, 0))
  return { step: steps[idx] || null, idx, total: steps.length }
}

function entityLabelOf(i) {
  return i?.entity_label
    || (i?.entity_type ? `${i.entity_type}${i.entity_id ? ` #${i.entity_id}` : ''}` : '—')
}

/** SLA state for a pending-style instance from its current step's sla_hours. */
function slaState(instance) {
  const { step } = currentStepOf(instance)
  const slaHours = Number(step?.sla_hours)
  const started = instance?.step_started_at || instance?.started_at
  const elapsed = ageMs(started)
  if (!slaHours || elapsed == null) return { overdue: false, dueLabel: null }
  const dueMs = slaHours * 3600 * 1000
  return {
    overdue: elapsed > dueMs,
    dueLabel: elapsed > dueMs
      ? `Overdue by ${formatDistanceToNow(new Date(Date.now() - (elapsed - dueMs)))}`
      : `SLA in ${formatDistanceToNow(new Date(Date.now() + (dueMs - elapsed)))}`,
  }
}

/**
 * Normalise the metrics object into the six headline stats. The RPC shape is
 * server-owned; we defensively read several likely key names so the strip stays
 * populated regardless of minor naming (counts fall back to bucket lengths).
 */
function deriveMetrics(metrics, buckets) {
  const m = metrics && typeof metrics === 'object' ? metrics : {}
  const pick = (...keys) => {
    for (const k of keys) {
      const v = m[k]
      if (v != null && v !== '') return v
    }
    return null
  }
  const avgRaw = pick('avg_approval_time_hours', 'avg_approval_hours', 'avg_approval_time')
  const avgLabel = avgRaw == null
    ? '—'
    : (typeof avgRaw === 'number' ? `${avgRaw.toFixed(1)}h` : String(avgRaw))
  return {
    total_pending:      pick('total_pending', 'pending') ?? buckets.pending.length,
    overdue:            pick('overdue') ?? buckets.overdue.length,
    returned:           pick('returned') ?? buckets.returned.length,
    rejected:           pick('rejected') ?? buckets.rejected.length,
    recently_approved:  pick('recently_approved', 'approved_recent') ?? buckets.recently_approved.length,
    avg_approval:       avgLabel,
  }
}

// ─── Metric strip ───────────────────────────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, tone, loading }) {
  return (
    <div className="card border border-gray-800 bg-gray-900/40">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
        <Icon className={`w-4 h-4 ${TONE_TEXT[tone] || 'text-gray-400'}`} />
      </div>
      {loading ? (
        <div className="mt-2 h-8 w-16 rounded bg-gray-800/60 animate-pulse" />
      ) : (
        <p className={`mt-1 text-2xl font-bold ${TONE_TEXT[tone] || 'text-white'}`}>{value ?? 0}</p>
      )}
    </div>
  )
}

function MetricStrip({ metrics, loading }) {
  const cards = [
    { key: 'total_pending',     label: 'Pending',           tone: 'amber',  icon: Clock },
    { key: 'overdue',           label: 'Overdue',           tone: 'red',    icon: AlertTriangle },
    { key: 'returned',          label: 'Returned',          tone: 'orange', icon: Undo2 },
    { key: 'rejected',          label: 'Rejected',          tone: 'red',    icon: XCircle },
    { key: 'recently_approved', label: 'Recently Approved', tone: 'green',  icon: CheckCircle2 },
    { key: 'avg_approval',      label: 'Avg Approval Time', tone: 'blue',   icon: Timer },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map(c => (
        <MetricCard
          key={c.key}
          icon={c.icon}
          label={c.label}
          tone={c.tone}
          loading={loading}
          value={metrics?.[c.key]}
        />
      ))}
    </div>
  )
}

// ─── Instance row ───────────────────────────────────────────────────────────────

function InstanceRow({ instance, bucketKey, onOpen }) {
  const { step, idx, total } = currentStepOf(instance)
  const sla = bucketKey === 'pending' || bucketKey === 'overdue' ? slaState(instance) : null
  const overdue = bucketKey === 'overdue' || sla?.overdue
  const timeRef = bucketKey === 'recently_approved'
    ? instance.completed_at
    : instance.step_started_at || instance.started_at

  return (
    <button
      onClick={() => onOpen(instance)}
      className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border transition-all hover:border-gray-600 ${
        overdue ? 'border-red-800/60 bg-red-950/20' : 'border-gray-800 bg-gray-900/40'
      }`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium truncate">{entityLabelOf(instance)}</p>
        <p className="text-gray-500 text-xs truncate mt-0.5">
          {instance.definition_name || 'Workflow'}
          {instance.entity_type && <span className="text-gray-600"> · {instance.entity_type}</span>}
          {step && (
            <span className="text-gray-400"> · Step {idx + 1}/{total}: {step.name}</span>
          )}
        </p>
      </div>

      <div className="hidden md:flex flex-col items-end gap-1 shrink-0">
        <span className={`text-xs whitespace-nowrap ${overdue ? 'text-red-400 font-semibold' : 'text-gray-500'}`}>
          {overdue && <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />}
          {sla?.dueLabel || relTime(timeRef) || '—'}
        </span>
      </div>

      <ApprovalStatusBadge status={instance.status} />
      <ChevronRight className="w-4 h-4 text-gray-600 shrink-0" />
    </button>
  )
}

// ─── Detail drawer ──────────────────────────────────────────────────────────────

function DetailDrawer({ instance, actionable, onClose, onActed }) {
  const [events, setEvents] = useState(null)
  const [trailErr, setTrailErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null) // { kind: 'success'|'error', text }

  const { step, idx, total } = currentStepOf(instance)
  const requirements = useMemo(() => stepRequirements(step), [step])

  const loadTrail = useCallback(async () => {
    setEvents(null)
    setTrailErr(null)
    try {
      const rows = await workflows.listStepEvents(instance.id)
      setEvents(rows || [])
    } catch (err) {
      setTrailErr(err?.message || 'Failed to load approval history')
    }
  }, [instance.id])

  useEffect(() => { loadTrail() }, [loadTrail])

  async function handleAct(action, payload) {
    setBusy(true)
    setFeedback(null)
    try {
      if (action === 'return') await workflows.returnWorkflow(instance.id, payload)
      else await workflows.actOnWorkflow(instance.id, action, payload)
      setFeedback({
        kind: 'success',
        text: `Workflow ${action === 'return' ? 'returned for correction' : `${action}d`} successfully.`,
      })
      await loadTrail()
      onActed?.()
    } catch (err) {
      setFeedback({ kind: 'error', text: err?.message || `Failed to ${action} the workflow.` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-xl h-full overflow-y-auto border-l shadow-2xl"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--border-dim)' }}
        role="dialog"
        aria-label="Approval detail"
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 py-4 border-b bg-gray-900/95 backdrop-blur"
          style={{ borderColor: 'var(--border-dim)' }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-white font-semibold text-sm truncate">{entityLabelOf(instance)}</h2>
              <ApprovalStatusBadge status={instance.status} />
            </div>
            <p className="text-gray-500 text-xs truncate">
              {instance.definition_name || 'Workflow'}
              {step && <span> · Step {idx + 1}/{total}: {step.name}</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Feedback banner */}
          {feedback && (
            <div className={`flex items-center gap-2.5 p-3 rounded-xl border text-sm ${
              feedback.kind === 'success'
                ? 'bg-green-500/10 border-green-500/30 text-green-300'
                : 'bg-red-500/10 border-red-500/30 text-red-300'
            }`}>
              {feedback.kind === 'success'
                ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                : <XCircle className="w-4 h-4 shrink-0" />}
              <span>{feedback.text}</span>
            </div>
          )}

          {/* Action panel (only when actionable by this user) */}
          {actionable && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <ClipboardList className="w-3.5 h-3.5" /> Decision
              </h3>
              <ApprovalAction requirements={requirements} onAct={handleAct} busy={busy} />
            </section>
          )}

          {/* Trail */}
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Approval History
            </h3>
            {trailErr ? (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
                <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-red-400 text-sm flex-1">{trailErr}</p>
                <button
                  onClick={loadTrail}
                  className="shrink-0 px-2.5 py-1 text-xs font-semibold text-red-300 bg-red-500/15 hover:bg-red-500/25 rounded-lg border border-red-500/30"
                >
                  Retry
                </button>
              </div>
            ) : (
              <ApprovalTrail events={events || []} loading={events == null} />
            )}
          </section>
        </div>
      </motion.aside>
    </div>
  )
}

// ─── Error state (RPC not provisioned) ──────────────────────────────────────────

function EngineUnavailable({ message, onRetry, retrying }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
        <ServerCrash className="w-7 h-7 text-amber-400" />
      </div>
      <div>
        <p className="text-white text-sm font-semibold">Approval engine not yet provisioned</p>
        <p className="text-gray-500 text-xs mt-1 max-w-md">
          The approval dashboard service is unavailable. This usually means the workflow
          engine migrations (V116–V118) have not been applied to this environment yet.
        </p>
        {message && (
          <p className="text-gray-600 text-[11px] mt-2 font-mono break-all max-w-md">{message}</p>
        )}
      </div>
      <button
        onClick={onRetry}
        disabled={retrying}
        className="btn-secondary text-sm flex items-center gap-2 disabled:opacity-50"
      >
        <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} /> Retry
      </button>
    </div>
  )
}

// ─── Main page ──────────────────────────────────────────────────────────────────

export default function Approvals() {
  // Auth context is consumed for session/role gating; the dashboard is org-scoped
  // server-side, so no explicit profile field is needed here today.
  useAuth()

  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [metricsRaw, setMetricsRaw] = useState(null)
  const [buckets, setBuckets]   = useState(EMPTY_BUCKETS)
  const [actionableIds, setActionableIds] = useState(() => new Set())
  const [updatedAt, setUpdatedAt] = useState(null)

  const [activeBucket, setActiveBucket] = useState('pending')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [selected, setSelected] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dash, mine] = await Promise.all([
        workflows.getApprovalDashboard(),
        // My actionable queue — used to decide which rows expose an action panel.
        // Failure here is non-fatal (dashboard still renders read-only).
        workflows.myPendingApprovals().catch(() => []),
      ])
      const nextBuckets = { ...EMPTY_BUCKETS, ...(dash?.buckets || {}) }
      setBuckets(nextBuckets)
      setMetricsRaw(dash?.metrics ?? null)
      setActionableIds(new Set((mine || []).map(r => r.id)))
      setUpdatedAt(new Date())
    } catch (err) {
      setError(err?.message || 'Failed to load approval dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const metrics = useMemo(() => deriveMetrics(metricsRaw, buckets), [metricsRaw, buckets])

  // Entity-type options across every bucket.
  const entityTypes = useMemo(() => {
    const set = new Set()
    Object.values(buckets).forEach(list => (list || []).forEach(i => i.entity_type && set.add(i.entity_type)))
    return Array.from(set).sort()
  }, [buckets])

  const q = search.trim().toLowerCase()
  const filterRow = useCallback((i) => {
    if (typeFilter !== 'all' && i.entity_type !== typeFilter) return false
    if (!q) return true
    return (entityLabelOf(i).toLowerCase().includes(q))
      || (i.definition_name || '').toLowerCase().includes(q)
      || (i.entity_type || '').toLowerCase().includes(q)
  }, [typeFilter, q])

  const activeList = useMemo(
    () => (buckets[activeBucket] || []).filter(filterRow),
    [buckets, activeBucket, filterRow],
  )

  const isActionable = useCallback(
    (instance) => actionableIds.has(instance?.id)
      && ['pending', 'in_review', 'returned'].includes(String(instance?.status || '').toLowerCase()),
    [actionableIds],
  )

  const totalPending = metrics.total_pending

  return (
    <div className="text-white space-y-6">
      <PageHeader
        title="Approval Dashboard"
        subtitle="Every workflow awaiting a decision across your organisation"
        icon={CheckSquare}
        badge={loading ? undefined : (totalPending ? `${totalPending} pending` : undefined)}
        onRefresh={load}
        refreshing={loading}
        updatedAt={updatedAt}
      />

      {error ? (
        <EngineUnavailable message={error} onRetry={load} retrying={loading} />
      ) : (
        <>
          {/* Metrics */}
          <MetricStrip metrics={metrics} loading={loading} />

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search entity or workflow…"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-9 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                aria-label="Filter by entity type"
                className="appearance-none bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-8 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
              >
                <option value="all">All entity types</option>
                {entityTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Bucket tabs */}
          <div className="flex flex-wrap gap-2 border-b border-gray-800 pb-3">
            {BUCKETS.map(b => {
              const count = (buckets[b.key] || []).length
              const active = activeBucket === b.key
              const Icon = b.icon
              return (
                <button
                  key={b.key}
                  onClick={() => setActiveBucket(b.key)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    active
                      ? (TONE_TAB_ACTIVE[b.tone] || 'bg-orange-500/15 text-orange-300 border-orange-500/40')
                      : 'bg-gray-800/60 text-gray-400 border-gray-700 hover:text-white hover:border-gray-600'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {b.label}
                  <span className={`ml-0.5 px-1.5 rounded-full text-[10px] ${active ? 'bg-black/30' : 'bg-gray-700/60'}`}>
                    {loading ? '·' : count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Bucket list */}
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-gray-800/60 border border-gray-800 animate-pulse" />
              ))}
            </div>
          ) : activeList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
                {activeBucket === 'recently_approved'
                  ? <CheckCircle2 className="w-7 h-7 text-green-500" />
                  : <Inbox className="w-7 h-7 text-gray-500" />}
              </div>
              <div>
                <p className="text-gray-300 text-sm font-medium">
                  {q || typeFilter !== 'all'
                    ? 'No workflows match your filters'
                    : `Nothing in ${BUCKETS.find(b => b.key === activeBucket)?.label}`}
                </p>
                <p className="text-gray-500 text-xs mt-1">
                  {q || typeFilter !== 'all'
                    ? 'Try a different search term or entity type.'
                    : activeBucket === 'overdue'
                      ? 'No approvals have breached their SLA. Nicely on top of it.'
                      : 'Workflows will appear here as they move through the engine.'}
                </p>
                {(q || typeFilter !== 'all') && (
                  <button
                    onClick={() => { setSearch(''); setTypeFilter('all') }}
                    className="mt-3 text-orange-400 text-xs hover:text-orange-300 inline-flex items-center gap-1"
                  >
                    <Filter className="w-3 h-3" /> Clear filters
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {activeList.map(inst => (
                <InstanceRow
                  key={inst.id}
                  instance={inst}
                  bucketKey={activeBucket}
                  onOpen={setSelected}
                />
              ))}
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {selected && (
          <DetailDrawer
            key={selected.id}
            instance={selected}
            actionable={isActionable(selected)}
            onClose={() => setSelected(null)}
            onActed={load}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
