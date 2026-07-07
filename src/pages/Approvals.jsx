import { useState, useEffect, useCallback } from 'react'
import {
  CheckSquare, CheckCircle, XCircle, X, Loader2, Search, Clock,
  ChevronDown, ChevronRight, Inbox, ThumbsUp, ThumbsDown, Ban,
  ChevronLeft, ListChecks, User, ArrowRight, Filter,
} from 'lucide-react'
import * as workflows from '../lib/api/workflows'
import { useAuth } from '../contexts/AuthContext'
import { formatDistanceToNow } from 'date-fns'
import { formatDateTime } from '../lib/formatters'

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25

const STATUS_META = {
  pending:   { label: 'Pending',   badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  approved:  { label: 'Approved',  badge: 'bg-green-500/20 text-green-400 border-green-500/30' },
  rejected:  { label: 'Rejected',  badge: 'bg-red-500/20 text-red-400 border-red-500/30' },
  cancelled: { label: 'Cancelled', badge: 'bg-gray-600/40 text-gray-400 border-gray-600/50' },
}

const ACTION_META = {
  started:   { label: 'Started',   color: 'text-blue-400' },
  approved:  { label: 'Approved',  color: 'text-green-400' },
  rejected:  { label: 'Rejected',  color: 'text-red-400' },
  escalated: { label: 'Escalated', color: 'text-yellow-400' },
  cancelled: { label: 'Cancelled', color: 'text-gray-400' },
}

const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', director: 'Director' }

function relativeTime(ts) {
  if (!ts) return null
  try { return formatDistanceToNow(new Date(ts), { addSuffix: true }) }
  catch { return null }
}

function stepInfo(instance) {
  const steps = Array.isArray(instance.steps) ? instance.steps : []
  const idx = Math.min(instance.current_step ?? 0, Math.max(steps.length - 1, 0))
  return { steps, idx, current: steps[idx] || null, total: steps.length }
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.pending
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold ${meta.badge}`}>
      {meta.label}
    </span>
  )
}

// ─── Comment modal (reject / cancel) ─────────────────────────────────────────

function CommentModal({ title, confirmLabel, tone = 'red', requireComment, onConfirm, onClose, busy }) {
  const [comment, setComment] = useState('')
  const [err, setErr] = useState(null)

  function submit(e) {
    e.preventDefault()
    if (requireComment && !comment.trim()) { setErr('A comment is required'); return }
    onConfirm(comment.trim() || null)
  }

  const toneBtn = tone === 'red'
    ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 shadow-red-500/20'
    : 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 shadow-orange-500/20'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-white font-semibold text-sm">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-800" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="px-5 py-4">
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              Comment {requireComment ? <span className="text-orange-500">*</span> : <span className="text-gray-600 font-normal normal-case">(optional)</span>}
            </label>
            <textarea
              value={comment}
              onChange={e => { setComment(e.target.value); setErr(null) }}
              rows={3}
              autoFocus
              placeholder="Explain the decision..."
              className={`w-full bg-gray-800 border rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all resize-none ${err ? 'border-red-500' : 'border-gray-700'}`}
            />
            {err && <p className="text-red-400 text-xs mt-1">{err}</p>}
          </div>
          <div className="px-5 py-4 border-t border-gray-800 flex gap-3 justify-end bg-gray-900/80">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 transition-all">
              Cancel
            </button>
            <button type="submit" disabled={busy} className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 transition-all shadow-lg ${toneBtn}`}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── My Queue card ────────────────────────────────────────────────────────────

function QueueCard({ instance, onApprove, onReject, acting }) {
  const { current, idx, total } = stepInfo(instance)
  const busy = acting === instance.id
  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 border-l-4 border-l-yellow-500 p-4 hover:border-gray-600 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm truncate">{instance.definition_name}</p>
          <p className="text-gray-400 text-xs mt-0.5 truncate">
            {instance.entity_label || `${instance.entity_type}${instance.entity_id ? ` #${instance.entity_id}` : ''}`}
            <span className="text-gray-600"> · {instance.entity_type}</span>
          </p>
        </div>
        <StatusBadge status={instance.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <span className="inline-flex items-center gap-1.5 text-gray-300">
          <ListChecks className="w-3.5 h-3.5 text-orange-400" />
          {current?.name || 'Approval'} <span className="text-gray-500">(step {idx + 1} of {total})</span>
        </span>
        {current?.approver_role && (
          <span className="inline-flex items-center gap-1 text-gray-400">
            <User className="w-3.5 h-3.5" /> {ROLE_LABEL[current.approver_role] || current.approver_role}
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-gray-500">
          <Clock className="w-3.5 h-3.5" /> waiting {relativeTime(instance.step_started_at) || '—'}
        </span>
      </div>

      <div className="mt-4 pt-3 border-t border-gray-700/60 flex gap-2 justify-end">
        <button
          onClick={() => onReject(instance)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 disabled:opacity-50 transition-all"
        >
          <ThumbsDown className="w-3.5 h-3.5" /> Reject
        </button>
        <button
          onClick={() => onApprove(instance)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 disabled:opacity-50 transition-all shadow-lg shadow-green-500/15"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ThumbsUp className="w-3.5 h-3.5" />} Approve
        </button>
      </div>
    </div>
  )
}

// ─── Instance timeline ────────────────────────────────────────────────────────

function InstanceTimeline({ instanceId, cache, setCache }) {
  const entry = cache[instanceId]

  useEffect(() => {
    if (entry) return
    let alive = true
    ;(async () => {
      try {
        const events = await workflows.listStepEvents(instanceId)
        if (alive) setCache(c => ({ ...c, [instanceId]: { events: events || [] } }))
      } catch (err) {
        if (alive) setCache(c => ({ ...c, [instanceId]: { error: err.message || 'Failed to load timeline' } }))
      }
    })()
    return () => { alive = false }
  }, [instanceId, entry, setCache])

  if (!entry) return <div className="py-3 flex justify-center"><Loader2 className="w-4 h-4 text-orange-500 animate-spin" /></div>
  if (entry.error) return <p className="text-red-400 text-xs py-2">{entry.error}</p>
  if (entry.events.length === 0) return <p className="text-gray-500 text-xs py-2">No timeline events recorded.</p>

  return (
    <ol className="space-y-2 py-1">
      {entry.events.map(ev => {
        const meta = ACTION_META[ev.action] || { label: ev.action, color: 'text-gray-400' }
        return (
          <li key={ev.id} className="flex items-start gap-2.5 text-xs">
            <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${meta.color.replace('text-', 'bg-')}`} />
            <div className="min-w-0">
              <p className="text-gray-300">
                <span className={`font-semibold ${meta.color}`}>{meta.label}</span>
                {ev.step_name && <span className="text-gray-400"> — {ev.step_name}</span>}
                <span className="text-gray-600"> · {formatDateTime(ev.created_at)}</span>
              </p>
              {ev.comment && <p className="text-gray-500 mt-0.5 italic">&ldquo;{ev.comment}&rdquo;</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Approvals() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('queue')          // 'queue' | 'all'
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  // My queue
  const [queue, setQueue] = useState([])
  const [queueLoading, setQueueLoading] = useState(true)
  const [acting, setActing] = useState(null)       // instance id being acted on
  const [modal, setModal] = useState(null)         // { kind: 'reject'|'cancel', instance }
  const [modalBusy, setModalBusy] = useState(false)

  // All instances
  const [instances, setInstances] = useState([])
  const [count, setCount] = useState(0)
  const [instLoading, setInstLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState(null)
  const [timelineCache, setTimelineCache] = useState({})

  const fetchQueue = useCallback(async () => {
    setQueueLoading(true)
    setError(null)
    try {
      const rows = await workflows.myPendingApprovals()
      setQueue(rows || [])
    } catch (err) { setError(err.message || 'Failed to load approval queue') }
    finally { setQueueLoading(false) }
  }, [])

  const fetchInstances = useCallback(async () => {
    setInstLoading(true)
    setError(null)
    try {
      const { rows, count: total } = await workflows.listWorkflowInstances({
        status: statusFilter === 'all' ? null : statusFilter,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      setInstances(rows || [])
      setCount(total || 0)
    } catch (err) { setError(err.message || 'Failed to load workflow instances') }
    finally { setInstLoading(false) }
  }, [statusFilter, page])

  useEffect(() => { fetchQueue() }, [fetchQueue])
  useEffect(() => { if (tab === 'all') fetchInstances() }, [tab, fetchInstances])

  function refetchAll() {
    setTimelineCache({})
    fetchQueue()
    if (tab === 'all') fetchInstances()
  }

  async function handleApprove(instance) {
    setActing(instance.id)
    setError(null)
    try {
      await workflows.actOnWorkflow(instance.id, 'approve', null)
      refetchAll()
    } catch (err) { setError(err.message || 'Approve failed') }
    finally { setActing(null) }
  }

  async function handleModalConfirm(comment) {
    if (!modal) return
    setModalBusy(true)
    setError(null)
    try {
      if (modal.kind === 'reject') await workflows.actOnWorkflow(modal.instance.id, 'reject', comment)
      else await workflows.cancelWorkflow(modal.instance.id, comment)
      setModal(null)
      refetchAll()
    } catch (err) { setError(err.message || 'Action failed') }
    finally { setModalBusy(false) }
  }

  const q = search.trim().toLowerCase()
  const matches = i => !q
    || (i.definition_name || '').toLowerCase().includes(q)
    || (i.entity_label || '').toLowerCase().includes(q)
    || (i.entity_type || '').toLowerCase().includes(q)
  const visibleQueue = queue.filter(matches)
  const visibleInstances = instances.filter(matches)
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))

  return (
    <div className="text-white space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-2 rounded-lg bg-orange-500/20">
              <CheckSquare className="w-5 h-5 text-orange-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Approvals</h1>
            {queue.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-[11px] font-bold border border-yellow-500/30">
                {queue.length} waiting
              </span>
            )}
          </div>
          <p className="text-gray-400 text-sm ml-11">Multi-step approval workflows waiting on your decision</p>
        </div>
      </div>

      {/* ── Tabs + search ── */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex gap-1 bg-gray-800 border border-gray-700 rounded-xl p-1 self-start">
          {[
            { key: 'queue', label: `My Queue${queue.length ? ` (${queue.length})` : ''}` },
            { key: 'all',   label: 'All Instances' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                tab === t.key ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' : 'text-gray-400 hover:text-white border border-transparent'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search workflows..."
            className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-9 pr-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white" aria-label="Clear search">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2.5 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={() => { tab === 'queue' ? fetchQueue() : fetchInstances() }}
            className="ml-auto shrink-0 px-3 py-1 text-xs font-semibold text-red-300 bg-red-500/15 hover:bg-red-500/25 rounded-lg border border-red-500/30 transition-all"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── My Queue ── */}
      {tab === 'queue' && (
        queueLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-36 rounded-xl bg-gray-800 border border-gray-700 animate-pulse" />)}
          </div>
        ) : visibleQueue.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-16 h-16 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
              <CheckCircle className="w-7 h-7 text-green-500" />
            </div>
            <div className="text-center">
              <p className="text-gray-300 text-sm font-medium">
                {q ? 'Nothing in your queue matches the search' : 'Your approval queue is clear'}
              </p>
              <p className="text-gray-500 text-xs mt-1">
                {q ? 'Try a different search term.' : 'When a workflow reaches a step assigned to your role, it will appear here.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visibleQueue.map(i => (
              <QueueCard
                key={i.id}
                instance={i}
                acting={acting}
                onApprove={handleApprove}
                onReject={inst => setModal({ kind: 'reject', instance: inst })}
              />
            ))}
          </div>
        )
      )}

      {/* ── All Instances ── */}
      {tab === 'all' && (
        <>
          {/* Status chips */}
          <div className="flex flex-wrap gap-2">
            {['all', 'pending', 'approved', 'rejected', 'cancelled'].map(s => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setPage(0) }}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  statusFilter === s
                    ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                    : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white hover:border-gray-600'
                }`}
              >
                {s === 'all' ? 'All' : STATUS_META[s].label}
              </button>
            ))}
          </div>

          {instLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-gray-800 border border-gray-700 animate-pulse" />)}
            </div>
          ) : visibleInstances.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-16 h-16 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
                <Inbox className="w-7 h-7 text-gray-500" />
              </div>
              <div className="text-center">
                <p className="text-gray-300 text-sm font-medium">No workflow instances found</p>
                <p className="text-gray-500 text-xs mt-1">
                  {statusFilter !== 'all' || q
                    ? 'Try a different status filter or search term.'
                    : 'Instances start automatically from trigger events or manually from records. Configure chains in Approval Workflows.'}
                </p>
                {(statusFilter !== 'all' || q) && (
                  <button onClick={() => { setStatusFilter('all'); setSearch(''); setPage(0) }} className="mt-3 text-orange-400 text-xs hover:text-orange-300 transition-colors inline-flex items-center gap-1">
                    <Filter className="w-3 h-3" /> Clear filters
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleInstances.map(inst => {
                const { current, idx, total } = stepInfo(inst)
                const isOpen = expanded === inst.id
                const canCancel = inst.status === 'pending' && inst.started_by && inst.started_by === profile?.id
                return (
                  <div key={inst.id} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden hover:border-gray-600 transition-all">
                    <button
                      onClick={() => setExpanded(isOpen ? null : inst.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left"
                    >
                      {isOpen ? <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">{inst.definition_name}</p>
                        <p className="text-gray-500 text-xs truncate">
                          {inst.entity_label || inst.entity_type}
                          {inst.status === 'pending' && current && (
                            <span className="text-gray-400"> · <ArrowRight className="w-3 h-3 inline" /> {current.name} ({idx + 1}/{total})</span>
                          )}
                        </p>
                      </div>
                      <span className="hidden sm:block text-gray-600 text-xs whitespace-nowrap">{relativeTime(inst.started_at)}</span>
                      <StatusBadge status={inst.status} />
                    </button>

                    {isOpen && (
                      <div className="px-11 pb-4 border-t border-gray-700/60 pt-3">
                        <InstanceTimeline instanceId={inst.id} cache={timelineCache} setCache={setTimelineCache} />
                        {canCancel && (
                          <div className="mt-2 flex justify-end">
                            <button
                              onClick={() => setModal({ kind: 'cancel', instance: inst })}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 border border-gray-600 transition-all"
                            >
                              <Ban className="w-3.5 h-3.5" /> Cancel workflow
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Pagination */}
              {count > PAGE_SIZE && (
                <div className="pt-2 flex items-center justify-between gap-3">
                  <p className="text-gray-500 text-xs">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, count)} of {count.toLocaleString()}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 transition-all"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" /> Prev
                    </button>
                    <span className="text-gray-500 text-xs">Page {page + 1} / {totalPages}</span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 transition-all"
                    >
                      Next <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Modals ── */}
      {modal?.kind === 'reject' && (
        <CommentModal
          title={`Reject "${modal.instance.definition_name}"`}
          confirmLabel="Reject"
          tone="red"
          requireComment
          busy={modalBusy}
          onConfirm={handleModalConfirm}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'cancel' && (
        <CommentModal
          title={`Cancel "${modal.instance.definition_name}"`}
          confirmLabel="Cancel workflow"
          tone="red"
          requireComment={false}
          busy={modalBusy}
          onConfirm={handleModalConfirm}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
